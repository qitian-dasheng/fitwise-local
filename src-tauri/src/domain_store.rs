use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) const STORAGE_NAME: &str = "fitwise-app-state-v1";
const SINGLETONS: [&str; 1] = ["profile"];
const COLLECTIONS: [&str; 9] = [
    "foodDefinitions",
    "foodDefinitionVersions",
    "meals",
    "checkIns",
    "measurements",
    "workouts",
    "recipes",
    "auditEvents",
    // 0.9.4 食物柜（库存轻量版）：只回答「家里还有什么、快没了没」，与饮食记录解耦。
    "pantryItems",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainStorageStatus {
    initialized: bool,
    persist_version: Option<i64>,
    revision: Option<i64>,
    entity_count: i64,
    command_count: i64,
    updated_at: Option<String>,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(directory.join("fitwise.db"))
}

pub(crate) fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let mut connection =
        Connection::open(&path).map_err(|error| format!("无法打开领域数据库：{error}"))?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
        .map_err(|error| format!("无法配置领域数据库：{error}"))?;
    crate::domain_upgrade::upgrade(&mut connection, &path)?;
    // 确保 0014 精简迁移在连接建立时必然执行（不依赖第一个业务命令才触发）。
    ensure_repository_schema(&connection)?;
    Ok(connection)
}

pub(crate) fn ensure_repository_schema(connection: &Connection) -> Result<(), String> {
    // 必须用 IMMEDIATE：0011 会 DROP + 重建测量投影视图，需要写锁。
    // DEFERRED 事务在并发命令下会「读到一半再升级写锁」而直接以 BUSY 失败，绕开 busy_timeout。
    let transaction =
        rusqlite::Transaction::new_unchecked(connection, rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
    apply_repository_schema(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn apply_repository_schema(connection: &Connection) -> Result<(), String> {
    // PRAGMA user_version 门闩：0.8.1 及更早的库 user_version 恒为 0。
    // 历史迁移（0001–0013）只重放一次（保持 IF NOT EXISTS 幂等），
    // 0014 精简迁移执行一次后置 user_version=14，后续启动不再重放、废弃表不复活。
    let schema_version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if schema_version < 13 {
        connection
            .execute_batch(include_str!("../migrations/0001_schema.sql"))
            .map_err(|error| error.to_string())?;
        // 0002 的 ALTER 不可幂等重放：只有 prepared_batches 表真实存在且缺列时才跑。
        // 0014 之后该表已被删除，此时 0002 的批次事件迁移已无对象，跳过即可。
        let has_batches_table: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prepared_batches')", [], |row| row.get(0)
        ).map_err(|error| error.to_string())?;
        let has_batch_status: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('prepared_batches') WHERE name = 'remaining_ratio')", [], |row| row.get(0)
        ).map_err(|error| error.to_string())?;
        if has_batches_table && !has_batch_status {
            connection
                .execute_batch(include_str!("../migrations/0002_batch_events.sql"))
                .map_err(|error| error.to_string())?;
        }
        for sql in [
            include_str!("../migrations/0003_domain_entity_store.sql"),
            include_str!("../migrations/0004_domain_commands.sql"),
            include_str!("../migrations/0005_queries_and_request_identity.sql"),
            include_str!("../migrations/0006_food_library.sql"),
            include_str!("../migrations/0007_inventory_operations.sql"),
            include_str!("../migrations/0008_input_artifacts.sql"),
            include_str!("../migrations/0009_meal_corrections.sql"),
            include_str!("../migrations/0010_label_drafts.sql"),
            include_str!("../migrations/0011_measurement_conditions.sql"),
            include_str!("../migrations/0012_workout_corrections.sql"),
            include_str!("../migrations/0013_menu_drafts.sql"),
        ] {
            connection
                .execute_batch(sql)
                .map_err(|error| format!("无法初始化领域仓库：{error}"))?;
        }
        connection
            .execute_batch("PRAGMA user_version = 13")
            .map_err(|error| error.to_string())?;
    }
    if schema_version < 14 {
        connection
            .execute_batch(include_str!("../migrations/0014_drop_deprecated.sql"))
            .map_err(|error| format!("无法执行 0014 精简迁移：{error}"))?;
        connection
            .execute_batch("PRAGMA user_version = 14")
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn entity_id(collection: &str, value: &Value) -> Result<String, String> {
    value
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| {
            (collection == "checkIns")
                .then(|| value.get("date").and_then(Value::as_str))
                .flatten()
        })
        .map(str::to_owned)
        .ok_or_else(|| format!("{collection} 中存在缺少稳定标识的实体。"))
}

pub(crate) fn persist_envelope(
    connection: &mut Connection,
    name: &str,
    raw: &str,
) -> Result<(), String> {
    if name != STORAGE_NAME {
        return Err("未知的领域存储名称。".into());
    }
    let mut envelope: Value =
        serde_json::from_str(raw).map_err(|error| format!("状态 JSON 无效：{error}"))?;
    // 0.9.4 兼容：旧启动状态/旧快照缺 pantryItems 时补空数组——新集合不能卡死旧状态的写入路径。
    if let Some(state) = envelope.get_mut("state").and_then(Value::as_object_mut) {
        for collection in COLLECTIONS {
            state
                .entry((*collection).to_owned())
                .or_insert_with(|| Value::Array(Vec::new()));
        }
    }
    let persist_version = envelope
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "状态缺少持久化版本。".to_string())?;
    let state = envelope
        .get("state")
        .and_then(Value::as_object)
        .ok_or_else(|| "状态缺少领域对象。".to_string())?;
    for key in SINGLETONS {
        if !state.contains_key(key) {
            return Err(format!("状态缺少 {key}。"));
        }
    }
    for collection in COLLECTIONS {
        if !state.get(collection).is_some_and(Value::is_array) {
            return Err(format!("状态集合 {collection} 无效。"));
        }
    }

    let normalized = serde_json::to_string(&envelope).map_err(|error| error.to_string())?;
    let hash = format!("{:x}", Sha256::digest(normalized.as_bytes()));
    let now = Utc::now().to_rfc3339();
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    write_transaction(&transaction, state, persist_version, &hash, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("提交领域事务失败：{error}"))
}

pub(crate) fn write_transaction(
    transaction: &Transaction<'_>,
    state: &Map<String, Value>,
    persist_version: i64,
    hash: &str,
    now: &str,
) -> Result<(), String> {
    // 0.9.4：新集合对旧状态（重置/导入）的兼容——缺失补空，写库侧不因新增集合拒绝旧状态。
    let mut state = state.clone();
    for collection in COLLECTIONS {
        state
            .entry((*collection).to_owned())
            .or_insert_with(|| Value::Array(Vec::new()));
    }
    transaction
        .execute("DELETE FROM domain_singletons", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_entities", [])
        .map_err(|error| error.to_string())?;

    for key in SINGLETONS {
        let payload = serde_json::to_string(&state[key]).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO domain_singletons (key, payload_json, updated_at) VALUES (?1, ?2, ?3)",
                params![key, payload, now],
            )
            .map_err(|error| format!("写入 {key} 失败：{error}"))?;
    }

    for collection in COLLECTIONS {
        let values = state[collection].as_array().expect("validated collection");
        for (index, value) in values.iter().enumerate() {
            let id = entity_id(collection, value)?;
            let payload = serde_json::to_string(value).map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO domain_entities (collection, entity_id, payload_json, sort_index, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![collection, id, payload, index as i64, now],
                )
                .map_err(|error| format!("写入 {collection}/{id} 失败：{error}"))?;
        }
    }

    let revision: i64 = transaction
        .query_row(
            "SELECT revision FROM domain_state_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0)
        + 1;
    transaction
        .execute(
            "INSERT INTO domain_state_meta (id, persist_version, revision, content_sha256, updated_at) VALUES (1, ?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET persist_version = excluded.persist_version, revision = excluded.revision, content_sha256 = excluded.content_sha256, updated_at = excluded.updated_at",
            params![persist_version, revision, hash, now],
        )
        .map_err(|error| format!("更新领域仓库版本失败：{error}"))?;
    Ok(())
}

pub(crate) fn load_envelope(connection: &Connection) -> Result<Option<String>, String> {
    // Hydration and exports must see one revision even if another process writes.
    if connection.is_autocommit() {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        return read_envelope(&transaction);
    }
    read_envelope(connection)
}

fn read_envelope(connection: &Connection) -> Result<Option<String>, String> {
    let version: Option<i64> = connection
        .query_row(
            "SELECT persist_version FROM domain_state_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(version) = version else {
        return Ok(None);
    };

    let mut state = Map::new();
    for key in SINGLETONS {
        let raw: String = connection
            .query_row(
                "SELECT payload_json FROM domain_singletons WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .map_err(|error| format!("读取 {key} 失败：{error}"))?;
        state.insert(
            key.into(),
            serde_json::from_str(&raw).map_err(|error| error.to_string())?,
        );
    }
    for collection in COLLECTIONS {
        let mut statement = connection
            .prepare("SELECT payload_json FROM domain_entities WHERE collection = ?1 ORDER BY sort_index")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([collection], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let mut values = Vec::new();
        for row in rows {
            values.push(
                serde_json::from_str(&row.map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?,
            );
        }
        state.insert(collection.into(), Value::Array(values));
    }
    serde_json::to_string(&serde_json::json!({ "state": state, "version": version }))
        .map(Some)
        .map_err(|error| error.to_string())
}

pub(crate) fn import_legacy_state(
    connection: &mut Connection,
    name: &str,
) -> Result<Option<String>, String> {
    let legacy: Option<String> = connection
        .query_row("SELECT value FROM app_kv WHERE key = ?1", [name], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(raw) = legacy {
        let normalized = normalize_legacy_envelope(&raw)?;
        persist_envelope(connection, name, &normalized)?;
        return Ok(Some(normalized));
    }
    Ok(None)
}

pub(crate) fn normalize_legacy_envelope(raw: &str) -> Result<String, String> {
    let mut envelope: Value = serde_json::from_str(raw).map_err(|error| error.to_string())?;
    let version = envelope["version"].as_i64().ok_or("状态缺少版本。")?;
    // 0.9.4 新集合：旧库/旧启动状态没有 pantryItems，装载前补空数组（幂等）。
    if let Some(state) = envelope.get_mut("state").and_then(Value::as_object_mut) {
        state
            .entry("pantryItems")
            .or_insert_with(|| serde_json::json!([]));
    }
    if version == 4 {
        return serde_json::to_string(&envelope).map_err(|error| error.to_string());
    }
    if version != 2 && version != 3 {
        return Err("此持久化版本暂不受支持，请保留原数据库并检查升级路径。".into());
    }
    let state = envelope
        .get_mut("state")
        .and_then(Value::as_object_mut)
        .ok_or("旧版状态无效。")?;
    for key in ["foodDefinitions", "foodDefinitionVersions"] {
        state.entry(key).or_insert_with(|| serde_json::json!([]));
    }
    if version == 2 {
        state
            .entry("auditEvents")
            .or_insert_with(|| serde_json::json!([]));
        if let Some(measurements) = state.get_mut("measurements").and_then(Value::as_array_mut) {
            for measurement in measurements {
                if measurement.get("status").is_none() {
                    measurement["status"] = serde_json::json!("active");
                }
            }
        }
    }
    envelope["version"] = serde_json::json!(4);
    serde_json::to_string(&envelope).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn domain_storage_get(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if name != STORAGE_NAME {
        return Ok(None);
    }
    let mut connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    if let Some(value) = load_envelope(&connection)? {
        return Ok(Some(value));
    }
    import_legacy_state(&mut connection, &name)
}

#[tauri::command]
pub fn domain_storage_set(app: AppHandle, name: String, value: String) -> Result<(), String> {
    let mut connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    if load_envelope(&connection)?.is_some() {
        return Err("领域仓库已初始化，请通过业务命令保存记录。".into());
    }
    persist_envelope(&mut connection, &name, &value)
}

#[tauri::command]
pub fn domain_storage_remove(app: AppHandle, name: String) -> Result<(), String> {
    if name != STORAGE_NAME {
        return Ok(());
    }
    let mut connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_entities", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_singletons", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_state_meta", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_command_payloads", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_command_receipts", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM app_kv WHERE key = ?1", [&name])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

/// 重置结果摘要：前端据此在重置成功后准确说明保留/清除/剔除的内容。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetSummary {
    pub kept_pantry_items: i64,
    pub kept_food_definitions: i64,
    pub kept_food_definition_versions: i64,
    pub kept_recipes: i64,
    pub cleared_meals: i64,
    pub cleared_check_ins: i64,
    pub cleared_measurements: i64,
    pub cleared_workouts: i64,
    pub cleared_audit_events: i64,
    pub cleared_command_receipts: i64,
    pub dropped_food_versions: i64,
    pub dropped_recipes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetResult {
    pub state: Value,
    pub summary: ResetSummary,
}

/// 重置本地记录（方案 B）：在单个 IMMEDIATE 事务内完成保留、清理与实体重建。
/// 保留：profile 单例、食材库定义、引用了有效定义的营养版本、全部原料都引用有效版本的菜谱；
/// 清除：meals/checkIns/measurements/workouts/auditEvents 与全部命令回执/负载；
/// 不动：迁移文件与 user_version、升级诊断（domain_upgrade_reports）。
/// 任何一步失败整体回滚，库保持重置前状态。
pub(crate) fn reset_domain_records_with_connection(
    connection: &mut Connection,
) -> Result<ResetResult, String> {
    ensure_repository_schema(connection)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("无法开始重置事务：{error}"))?;
    let raw = load_envelope(&transaction)?.ok_or("领域仓库尚未初始化，没有可重置的记录。")?;
    let envelope: Value =
        serde_json::from_str(&raw).map_err(|error| format!("状态 JSON 无效：{error}"))?;
    let version = envelope
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "状态缺少持久化版本。".to_string())?;
    let state = envelope
        .get("state")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| "状态缺少领域对象。".to_string())?;

    let (retained, mut summary) = build_reset_state(&state)?;
    summary.cleared_command_receipts = transaction
        .query_row("SELECT COUNT(*) FROM domain_command_receipts", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;

    let serialized =
        serde_json::to_string(&serde_json::json!({"state": retained, "version": version}))
            .map_err(|error| error.to_string())?;
    let hash = format!("{:x}", Sha256::digest(serialized.as_bytes()));
    let now = Utc::now().to_rfc3339();
    // 重写 domain_entities/domain_singletons；投影视图建在实体表上，随之反映保留后的数据。
    write_transaction(&transaction, &retained, version, &hash, &now)?;
    transaction
        .execute("DELETE FROM domain_command_receipts", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_command_payloads", [])
        .map_err(|error| error.to_string())?;
    // 旧版 app_kv 快照同样携带已清除的记录，一并清掉，避免库内残留测试数据。
    transaction
        .execute("DELETE FROM app_kv WHERE key = ?1", params![STORAGE_NAME])
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .map_err(|error| format!("提交重置事务失败：{error}"))?;
    Ok(ResetResult {
        state: Value::Object(retained),
        summary,
    })
}

fn collection_len(state: &Map<String, Value>, key: &str) -> i64 {
    state
        .get(key)
        .and_then(Value::as_array)
        .map(|items| items.len() as i64)
        .unwrap_or(0)
}

/// 与前端 `buildResetState`（src/domain/resetState.ts）保持同一套保留口径。
/// 失效引用明确处置：孤儿营养版本与引用失效的菜谱整体剔除，菜谱在摘要中记名。
fn build_reset_state(
    state: &Map<String, Value>,
) -> Result<(Map<String, Value>, ResetSummary), String> {
    let mut next = state.clone();
    // 食物柜是「家里有什么」的库存资产，与食材库同侧保留，不随记录清除（0.9.4）。
    let kept_pantry_items = collection_len(&next, "pantryItems");
    next.entry("pantryItems".to_owned())
        .or_insert_with(|| Value::Array(Vec::new()));
    let cleared_meals = collection_len(&next, "meals");
    let cleared_check_ins = collection_len(&next, "checkIns");
    let cleared_measurements = collection_len(&next, "measurements");
    let cleared_workouts = collection_len(&next, "workouts");
    let cleared_audit_events = collection_len(&next, "auditEvents");
    for key in [
        "meals",
        "checkIns",
        "measurements",
        "workouts",
        "auditEvents",
    ] {
        next.insert(key.into(), Value::Array(Vec::new()));
    }

    // 食材库：定义全保留；营养版本只保留 foodId 仍指向有效定义的那些。
    let definition_ids: HashSet<String> = next
        .get("foodDefinitions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let original_versions = next
        .get("foodDefinitionVersions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let versions: Vec<Value> = original_versions
        .iter()
        .filter(|item| {
            item.get("foodId")
                .and_then(Value::as_str)
                .map(|id| definition_ids.contains(id))
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    let dropped_food_versions = (original_versions.len() - versions.len()) as i64;
    let version_ids: HashSet<String> = versions
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    next.insert("foodDefinitionVersions".into(), Value::Array(versions));

    // 菜谱：只保留每项原料都引用有效营养版本的菜谱；失效菜谱整体剔除并记名，
    // 避免保留无法编辑/保存的菜谱（保存路径会因找不到营养版本而拒绝）。
    let original_recipes = next
        .get("recipes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut dropped_recipes = Vec::new();
    let recipes: Vec<Value> = original_recipes
        .iter()
        .filter(|item| {
            let valid = item
                .get("ingredients")
                .and_then(Value::as_array)
                .map(|items| {
                    !items.is_empty()
                        && items.iter().all(|ingredient| {
                            ingredient
                                .get("foodVersionId")
                                .and_then(Value::as_str)
                                .map(|id| version_ids.contains(id))
                                .unwrap_or(false)
                        })
                })
                .unwrap_or(false);
            if !valid {
                dropped_recipes.push(
                    item.get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("未命名菜谱")
                        .to_owned(),
                );
            }
            valid
        })
        .cloned()
        .collect();
    next.insert("recipes".into(), Value::Array(recipes));

    let summary = ResetSummary {
        kept_pantry_items,
        kept_food_definitions: collection_len(&next, "foodDefinitions"),
        kept_food_definition_versions: collection_len(&next, "foodDefinitionVersions"),
        kept_recipes: collection_len(&next, "recipes"),
        cleared_meals,
        cleared_check_ins,
        cleared_measurements,
        cleared_workouts,
        cleared_audit_events,
        cleared_command_receipts: 0,
        dropped_food_versions,
        dropped_recipes,
    };
    Ok((next, summary))
}

#[tauri::command]
pub fn reset_domain_records(app: AppHandle) -> Result<ResetResult, String> {
    let mut connection = open_database(&app)?;
    reset_domain_records_with_connection(&mut connection)
}

#[tauri::command]
pub fn get_domain_storage_status(app: AppHandle) -> Result<DomainStorageStatus, String> {
    let connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    let tx = connection
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    read_storage_status(&tx)
}

pub(crate) fn read_storage_status(connection: &Connection) -> Result<DomainStorageStatus, String> {
    let meta: Option<(i64, i64, String)> = connection
        .query_row(
            "SELECT persist_version, revision, updated_at FROM domain_state_meta WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let entity_count = connection
        .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let command_count = connection
        .query_row("SELECT COUNT(*) FROM domain_command_receipts", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    Ok(DomainStorageStatus {
        initialized: meta.is_some(),
        persist_version: meta.as_ref().map(|value| value.0),
        revision: meta.as_ref().map(|value| value.1),
        entity_count,
        command_count,
        updated_at: meta.map(|value| value.2),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);").unwrap();
        ensure_repository_schema(&connection).unwrap();
        connection
    }

    fn envelope(version: i64, meal_name: &str) -> String {
        let mut state = Map::new();
        state.insert("profile".into(), serde_json::json!({"name":"test"}));
        for collection in COLLECTIONS {
            state.insert(collection.into(), Value::Array(vec![]));
        }
        state.insert(
            "meals".into(),
            serde_json::json!([{"id":"meal-1","name":meal_name}]),
        );
        serde_json::to_string(&serde_json::json!({"state":state,"version":version})).unwrap()
    }

    #[test]
    fn state_is_split_into_entities_and_round_trips() {
        let mut connection = connection();
        persist_envelope(&mut connection, STORAGE_NAME, &envelope(3, "tofu")).unwrap();
        let loaded: Value =
            serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["version"], 3);
        assert_eq!(loaded["state"]["meals"][0]["name"], "tofu");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn legacy_v2_is_normalized_before_desktop_hydration() {
        let mut legacy: Value = serde_json::from_str(&envelope(2, "old meal")).unwrap();
        legacy["state"]
            .as_object_mut()
            .unwrap()
            .remove("auditEvents");
        legacy["state"]["measurements"] = serde_json::json!([{"id":"weight-old","weightKg":80}]);
        let normalized: Value =
            serde_json::from_str(&normalize_legacy_envelope(&legacy.to_string()).unwrap()).unwrap();
        assert_eq!(normalized["version"], 4);
        assert_eq!(normalized["state"]["auditEvents"], serde_json::json!([]));
        assert_eq!(normalized["state"]["measurements"][0]["status"], "active");
        assert_eq!(normalized["state"]["meals"][0], legacy["state"]["meals"][0]);
    }

    #[test]
    fn invalid_update_rolls_back_to_previous_revision() {
        let mut connection = connection();
        persist_envelope(&mut connection, STORAGE_NAME, &envelope(3, "first")).unwrap();
        let duplicate = envelope(3, "second").replace(
            "[{\"id\":\"meal-1\",\"name\":\"second\"}]",
            "[{\"id\":\"meal-1\",\"name\":\"second\"},{\"id\":\"meal-1\",\"name\":\"duplicate\"}]",
        );
        assert!(persist_envelope(&mut connection, STORAGE_NAME, &duplicate).is_err());
        let loaded: Value =
            serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["state"]["meals"][0]["name"], "first");
        let revision: i64 = connection
            .query_row(
                "SELECT revision FROM domain_state_meta WHERE id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(revision, 1);
    }

    #[test]
    fn legacy_blob_is_imported_without_deleting_rollback_source() {
        let mut connection = connection();
        let legacy = envelope(3, "legacy");
        connection
            .execute(
                "INSERT INTO app_kv (key, value, updated_at) VALUES (?1, ?2, 'now')",
                params![STORAGE_NAME, legacy],
            )
            .unwrap();

        let imported = import_legacy_state(&mut connection, STORAGE_NAME)
            .unwrap()
            .unwrap();
        let imported: Value = serde_json::from_str(&imported).unwrap();
        let original: Value = serde_json::from_str(&legacy).unwrap();
        assert_eq!(imported["version"], 4);
        assert_eq!(imported["state"], original["state"]);
        let loaded: Value =
            serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["state"]["meals"][0]["name"], "legacy");
        let retained: String = connection
            .query_row(
                "SELECT value FROM app_kv WHERE key = ?1",
                [STORAGE_NAME],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, legacy);
    }
}
