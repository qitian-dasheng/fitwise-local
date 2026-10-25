//! 食物柜（0.9.4 库存轻量版）：单集合 pantryItems，只回答「家里还有什么、快没了没」。
//!
//! 边界（START_HERE §11，用户 2026-10-25 批准）：不恢复成本账、采购流程、批次/熟食；
//! 入库/取出是同一条命令的正负增量；阈值/到期/备注一条更新命令；删除独立命令。
//! 与饮食记录完全解耦：只提示缺货、不自动扣减、不反推摄入。
//! 每个条目挂食材库定义（foodDefinitionId 必须存在且未归档）；增减单位必须与
//! 柜内既有条目一致——单位换算是食材库换算器的职责，这里不做隐式换算。

use crate::domain_commands::{
    array, array_mut, now_and_date, payload_number, payload_str, CommandMutation,
};
use crate::record_commands::audit;
use chrono::NaiveDate;
use serde_json::{json, Map, Value};

const QUANTITY_MAX: f64 = 1_000_000.0;
const UNIT_LIMIT: usize = 10;
const NOTE_LIMIT: usize = 80;

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn optional_text(
    payload: &Value,
    key: &str,
    limit: usize,
) -> Result<Option<Option<String>>, String> {
    match payload.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(Value::String(raw)) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(format!("{key} 不能是空白。"));
            }
            if trimmed.chars().count() > limit {
                return Err(format!("{key} 不能超过 {limit} 字。"));
            }
            Ok(Some(Some(trimmed.to_owned())))
        }
        Some(_) => Err(format!("{key} 必须是文本。")),
    }
}

fn optional_quantity(payload: &Value, key: &str) -> Result<Option<f64>, String> {
    match payload.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => {
            let value = payload_number(payload, key)?;
            if !value.is_finite() || value < 0.0 || value > QUANTITY_MAX {
                return Err(format!("{key} 需在 0–{QUANTITY_MAX} 之间。"));
            }
            Ok(Some(round2(value)))
        }
    }
}

fn optional_date(payload: &Value, key: &str) -> Result<Option<Option<String>>, String> {
    match payload.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(Value::String(raw)) => {
            NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .map_err(|_| format!("{key} 需是 YYYY-MM-DD 日期。"))?;
            Ok(Some(Some(raw.clone())))
        }
        Some(_) => Err(format!("{key} 需是日期文本。")),
    }
}

/// 食材必须存在于库且未归档：归档食材进柜会在列表里变成看不见的幽灵条目。
fn require_definition(state: &Map<String, Value>, food_definition_id: &str) -> Result<(), String> {
    let definitions = array(state, "foodDefinitions")?;
    let found = definitions
        .iter()
        .find(|item| item["id"].as_str() == Some(food_definition_id))
        .ok_or_else(|| "食材库中找不到该食材，请先在食材库建档。".to_string())?;
    if found["archived"].as_bool() == Some(true) {
        return Err("该食材已归档，先在食材库恢复后再入柜。".into());
    }
    Ok(())
}

fn find_item_mut<'a>(
    state: &'a mut Map<String, Value>,
    id: &str,
) -> Result<Option<&'a mut Value>, String> {
    Ok(array_mut(state, "pantryItems")?
        .iter_mut()
        .find(|item| item["id"].as_str() == Some(id)))
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    match kind {
        "pantry_adjust" => adjust(state, payload, command_id),
        "pantry_update_item" => update_item(state, payload, command_id),
        "pantry_delete_item" => delete_item(state, payload, command_id),
        _ => Err("未知的食物柜命令。".into()),
    }
}

fn adjust(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let food_definition_id = payload_str(payload, "foodDefinitionId")?.to_owned();
    require_definition(state, &food_definition_id)?;
    let delta = round2(payload_number(payload, "delta")?);
    if delta == 0.0 {
        return Err("数量变化不能为 0。".into());
    }
    if !delta.is_finite() || delta.abs() > QUANTITY_MAX {
        return Err(format!("单次增减需在 ±{QUANTITY_MAX} 之间。"));
    }
    let unit = payload_str(payload, "unit")?.trim().to_owned();
    if unit.is_empty() || unit.chars().count() > UNIT_LIMIT {
        return Err(format!("单位需在 1–{UNIT_LIMIT} 字符。"));
    }
    let note = optional_text(payload, "note", NOTE_LIMIT)?;
    let expires_at = optional_date(payload, "expiresAt")?;
    let low_stock_threshold = optional_quantity(payload, "lowStockThreshold")?;
    let (now, _) = now_and_date();

    let existing_index = array(state, "pantryItems")?
        .iter()
        .position(|item| item["foodDefinitionId"].as_str() == Some(&food_definition_id));

    let (item_id, quantity) = if let Some(index) = existing_index {
        let item = &array(state, "pantryItems")?[index];
        let existing_unit = item["unit"].as_str().unwrap_or_default().to_owned();
        if existing_unit != unit {
            return Err(format!(
                "单位与柜内现有条目（{existing_unit}）不一致；请按既有单位增减，避免换算歧义。"
            ));
        }
        let before = item["quantity"].as_f64().unwrap_or(0.0);
        let after = round2(before + delta);
        if after < 0.0 {
            return Err(format!("取出量超过柜内存量（{before} {existing_unit}）。"));
        }
        if after > QUANTITY_MAX {
            return Err(format!("柜内数量不能超过 {QUANTITY_MAX}。"));
        }
        let item = &mut array_mut(state, "pantryItems")?[index];
        let item = item.as_object_mut().ok_or("柜内条目格式无效。")?;
        item.insert("quantity".into(), json!(after));
        item.insert("updatedAt".into(), json!(now));
        let item_id = item["id"].as_str().unwrap_or_default().to_owned();
        audit(
            state,
            command_id,
            "pantry_adjusted",
            "pantry_item",
            &item_id,
            json!({"foodDefinitionId": food_definition_id, "delta": delta, "before": before, "after": after, "unit": unit}),
        )?;
        (item_id, after)
    } else {
        if delta < 0.0 {
            return Err("柜内还没有这个食材，请先入库。".into());
        }
        let item_id = format!("{command_id}:pantry");
        let mut item = Map::new();
        item.insert("id".into(), json!(item_id));
        item.insert("foodDefinitionId".into(), json!(food_definition_id));
        item.insert("quantity".into(), json!(delta));
        item.insert("unit".into(), json!(unit));
        if let Some(Some(expires)) = &expires_at {
            item.insert("expiresAt".into(), json!(expires));
        }
        if let Some(threshold) = low_stock_threshold {
            item.insert("lowStockThreshold".into(), json!(threshold));
        }
        if let Some(Some(note)) = &note {
            item.insert("note".into(), json!(note));
        }
        item.insert("createdAt".into(), json!(now));
        item.insert("updatedAt".into(), json!(now));
        array_mut(state, "pantryItems")?.push(Value::Object(item));
        audit(
            state,
            command_id,
            "pantry_created",
            "pantry_item",
            &item_id,
            json!({"foodDefinitionId": food_definition_id, "quantity": delta, "unit": unit}),
        )?;
        (item_id, delta)
    };

    // 稳定排序：按食材定义顺序展示，避免同一食材的条目漂移。
    array_mut(state, "pantryItems")?.sort_by_key(|item| {
        item["foodDefinitionId"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    });

    Ok(CommandMutation {
        applied: true,
        result: json!({"pantryItemId": item_id, "quantity": quantity, "unit": unit}),
    })
}

fn update_item(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let id = payload_str(payload, "id")?.to_owned();
    let threshold = optional_quantity(payload, "lowStockThreshold")?;
    let expires_at = optional_date(payload, "expiresAt")?;
    let note = optional_text(payload, "note", NOTE_LIMIT)?;
    if threshold.is_none() && expires_at.is_none() && note.is_none() {
        return Err("没有要更新的字段（阈值 / 到期日 / 备注）。".into());
    }
    let target = find_item_mut(state, &id)?
        .ok_or_else(|| "柜内没有这个条目，可能已被删除，请刷新。".to_string())?;
    let item = target.as_object_mut().ok_or("柜内条目格式无效。")?;
    let mut changes = Map::new();
    if let Some(value) = threshold {
        changes.insert("lowStockThreshold".into(), json!(value));
        item.insert("lowStockThreshold".into(), json!(value));
    }
    match expires_at {
        Some(Some(value)) => {
            changes.insert("expiresAt".into(), json!(value));
            item.insert("expiresAt".into(), json!(value));
        }
        Some(None) => {
            changes.insert("expiresAt".into(), Value::Null);
            item.remove("expiresAt");
        }
        None => {}
    }
    match note {
        Some(Some(value)) => {
            changes.insert("note".into(), json!(value));
            item.insert("note".into(), json!(value));
        }
        Some(None) => {
            changes.insert("note".into(), Value::Null);
            item.remove("note");
        }
        None => {}
    }
    let (now, _) = now_and_date();
    item.insert("updatedAt".into(), json!(now));
    let item_id = item["id"].as_str().unwrap_or_default().to_owned();
    audit(
        state,
        command_id,
        "pantry_item_updated",
        "pantry_item",
        &item_id,
        Value::Object(changes),
    )?;
    Ok(CommandMutation {
        applied: true,
        result: json!({"pantryItemId": item_id}),
    })
}

fn delete_item(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let id = payload_str(payload, "id")?.to_owned();
    let items = array_mut(state, "pantryItems")?;
    let index = items
        .iter()
        .position(|item| item["id"].as_str() == Some(&id))
        .ok_or_else(|| "柜内没有这个条目，可能已被删除，请刷新。".to_string())?;
    let removed = items.remove(index);
    audit(
        state,
        command_id,
        "pantry_item_deleted",
        "pantry_item",
        &id,
        json!({
            "foodDefinitionId": removed["foodDefinitionId"],
            "quantity": removed["quantity"],
            "unit": removed["unit"],
        }),
    )?;
    Ok(CommandMutation {
        applied: true,
        result: json!({"pantryItemId": id, "deleted": true}),
    })
}
