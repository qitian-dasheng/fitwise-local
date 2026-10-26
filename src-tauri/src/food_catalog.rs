//! 内置食材目录（0.11.0 常见食材库）：应用启动时把权威营养数据并入领域信封。
//!
//! 数据来源：`resources/food-catalog.json`（编译期嵌入，构建脚本
//! scripts/build-food-catalog/ 从 USDA FoodData Central SR Legacy 生成，
//! 所有数值为数据原文，缺失标 unknown，禁止推算）。
//!
//! 合并语义（幂等）：
//! - 按 app_kv 的目录版本号判断，只在新目录版本时合并一次；
//! - 同 catalogId 的定义已存在 → 跳过（用户的修改不覆盖）；
//! - 曾被用户删除的 catalogId 记入「目录墓碑」，升级不复活；
//! - 直连信封插入（definition + version，确定性 id `catalog-<catalogId>`），
//!   **不写审计事件**（应用内置内容不是用户操作）；
//! - 合并失败不阻塞启动：错误原样返回由调用方记日志。
//!
//! 用户修改目录食材 = 走既有 save_food_definition 生成新版本（catalogId 保留，
//! 版本号递增），目录升级只看「定义是否存在」，不与用户版本竞争。

use crate::domain_store::{load_envelope, write_transaction, COLLECTIONS};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// 嵌入的目录数据（编译期拷贝进二进制，离线可用）。
pub(crate) const FOOD_CATALOG_JSON: &str = include_str!("../resources/food-catalog.json");
const CATALOG_MERGE_KEY: &str = "catalog-merged-version";

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
struct CatalogItem {
    #[serde(rename = "catalogId")]
    catalog_id: String,
    category: String,
    name: String,
    #[serde(rename = "sourceRef")]
    #[allow(dead_code)]
    source_ref: Value,
    definition: Value,
    version: Value,
}

fn parse_catalog() -> Result<(i64, Vec<CatalogItem>), String> {
    parse_catalog_str(FOOD_CATALOG_JSON)
}

fn parse_catalog_str(raw: &str) -> Result<(i64, Vec<CatalogItem>), String> {
    let catalog: Value =
        serde_json::from_str(raw).map_err(|error| format!("内置目录 JSON 无效：{error}"))?;
    let version = catalog
        .get("catalogVersion")
        .and_then(Value::as_i64)
        .ok_or("内置目录缺少版本号。")?;
    let items: Vec<CatalogItem> = serde_json::from_value(catalog["items"].clone())
        .map_err(|error| format!("内置目录条目无效：{error}"))?;
    Ok((version, items))
}

/// 启动调用：目录版本比已合并版本新时执行一次合并。任何失败不阻塞启动。
pub(crate) fn merge_food_catalog(connection: &mut Connection) -> Result<String, String> {
    let (catalog_version, items) = parse_catalog()?;
    let merged: Option<i64> = connection
        .query_row(
            "SELECT value FROM app_kv WHERE key = ?1",
            [CATALOG_MERGE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .and_then(|raw| raw.parse::<i64>().ok());
    if merged.is_some_and(|version| version >= catalog_version) {
        return Ok(format!("目录 v{catalog_version} 已合并，跳过。"));
    }

    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("无法开始目录合并事务：{error}"))?;
    let Some(raw) = load_envelope(&transaction)? else {
        return Ok("领域仓库尚未初始化，跳过目录合并（首次业务命令建库后自动合并）。".into());
    };
    let envelope: Value =
        serde_json::from_str(&raw).map_err(|error| format!("状态 JSON 无效：{error}"))?;
    let persist_version = envelope["version"].as_i64().ok_or("状态缺少持久化版本。")?;
    let mut state: Map<String, Value> = envelope["state"]
        .as_object()
        .cloned()
        .ok_or("状态缺少领域对象。")?;
    // 新集合兼容：与 normalize/persist 路径同口径，缺失集合补空。
    for collection in COLLECTIONS {
        state
            .entry((*collection).to_owned())
            .or_insert_with(|| Value::Array(Vec::new()));
    }

    // 修复历史构建写入的非法 basis 形状：Rust 侧 Basis 是 deny_unknown_fields，
    // 只允许 quantity/unit；早期目录在 basis 里多写了 measurementBasis，
    // 会让食材库整页反序列化失败。已合并条目因幂等跳过不会被重写，
    // 所以必须在每次合并时原地清理一次（无非法字段时不做任何改动）。
    let mut repaired = 0usize;
    if let Some(versions) = state
        .get_mut("foodDefinitionVersions")
        .and_then(Value::as_array_mut)
    {
        for version in versions.iter_mut() {
            if let Some(basis) = version.get_mut("basis").and_then(Value::as_object_mut) {
                let before = basis.len();
                basis.retain(|key, _| key == "quantity" || key == "unit");
                if basis.len() != before {
                    repaired += 1;
                }
            }
        }
    }

    // 回填来源标记：早期合并没有写入 sourceRef，而幂等逻辑会跳过已存在条目，
    // 只能在这里按 catalogId 从目录补一次（只补缺失，不覆盖用户改动）。
    let source_by_catalog: std::collections::HashMap<&str, &Value> = items
        .iter()
        .map(|item| (item.catalog_id.as_str(), &item.source_ref))
        .collect();
    if let Some(definitions) = state
        .get_mut("foodDefinitions")
        .and_then(Value::as_array_mut)
    {
        for definition in definitions.iter_mut() {
            let Some(catalog_id) = definition["catalogId"].as_str().map(str::to_owned) else {
                continue;
            };
            if definition.get("sourceRef").is_some() {
                continue;
            }
            if let Some(source) = source_by_catalog.get(catalog_id.as_str()) {
                definition["sourceRef"] = (*source).clone();
                repaired += 1;
            }
        }
    }

    // 先收集既有 catalogId（不可变借用），再做插入（可变借用），避免借用冲突。
    let existing_catalog_ids: std::collections::HashSet<String> = state
        .get("foodDefinitions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["catalogId"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let tombstones: std::collections::HashSet<String> = state
        .get("catalogTombstones")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();

    let now = Utc::now().to_rfc3339();
    let mut inserted = 0usize;
    // 两趟插入（definitions 与 versions 各借一次），避免同时可变借用 state。
    let skipped = |item: &&CatalogItem| {
        let skip = tombstones.contains(&item.catalog_id)
            || existing_catalog_ids.contains(&item.catalog_id);
        let _ = skip;
        skip
    };
    {
        let definitions = state
            .entry("foodDefinitions".to_owned())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or("foodDefinitions 集合无效。")?;
        for item in items.iter().filter(|item| !skipped(item)) {
            let mut definition = item.definition.clone();
            let entry = definition
                .as_object_mut()
                .ok_or("目录条目 definition 无效。")?;
            entry
                .entry("brand".to_owned())
                .or_insert_with(|| Value::Null);
            entry.insert("activeVersionId".into(), json!(item.version["id"]));
            entry.insert("catalogId".into(), json!(item.catalog_id));
            entry.insert("category".into(), json!(item.category));
            // 来源出处（库名 + FDC 编号 + 英文原名）：前端悬浮提示直接读这里。
            entry.insert("sourceRef".into(), item.source_ref.clone());
            entry.insert("archived".into(), json!(false));
            entry.insert("createdAt".into(), json!(now));
            definitions.push(definition);
            inserted += 1;
        }
    }
    {
        let versions = state
            .entry("foodDefinitionVersions".to_owned())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or("foodDefinitionVersions 集合无效。")?;
        for item in items.iter().filter(|item| !skipped(item)) {
            let mut version = item.version.clone();
            let version_entry = version.as_object_mut().ok_or("目录条目 version 无效。")?;
            version_entry.insert("createdAt".into(), json!(now));
            versions.push(version);
        }
    }

    let hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_string(&json!({"state": state, "version": persist_version}))
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
    );
    write_transaction(&transaction, &state, persist_version, &hash, &now)?;
    transaction
        .execute(
            "INSERT INTO app_kv (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![CATALOG_MERGE_KEY, catalog_version.to_string(), now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .map_err(|error| format!("提交目录合并事务失败：{error}"))?;
    Ok(format!(
        "目录 v{catalog_version} 合并完成，新增 {inserted} 项，修复 {repaired} 项。"
    ))
}

/// 删除目录食材时登记墓碑（delete_food 命令调用）；重置不清理（重置保留食材库同侧）。
pub(crate) fn record_catalog_tombstone(state: &mut Map<String, Value>, catalog_id: &str) {
    let tombstones = state
        .entry("catalogTombstones".to_owned())
        .or_insert_with(|| Value::Array(Vec::new()));
    if let Some(items) = tombstones.as_array_mut() {
        if !items.iter().any(|item| item.as_str() == Some(catalog_id)) {
            items.push(json!(catalog_id));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    include!("food_catalog_tests.rs");
}
