use crate::domain_store::{
    ensure_repository_schema, load_envelope, open_database, write_transaction, STORAGE_NAME,
};
use chrono::{FixedOffset, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainCommandRequest {
    command_id: String,
    kind: String,
    payload: Value,
    bootstrap_state: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainCommandResponse {
    applied: bool,
    replayed: bool,
    revision: i64,
    result: Value,
    state: Value,
}

pub(crate) struct CommandMutation {
    pub(crate) applied: bool,
    pub(crate) result: Value,
}

pub(crate) fn now_and_date() -> (String, String) {
    let now = Utc::now();
    let timezone = FixedOffset::east_opt(8 * 60 * 60).expect("valid Shanghai offset");
    (
        now.to_rfc3339(),
        now.with_timezone(&timezone).format("%Y-%m-%d").to_string(),
    )
}

pub(crate) fn payload_str<'a>(payload: &'a Value, key: &str) -> Result<&'a str, String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("命令缺少 {key}。"))
}

pub(crate) fn payload_number(payload: &Value, key: &str) -> Result<f64, String> {
    payload
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| format!("命令中的 {key} 无效。"))
}

pub(crate) fn array<'a>(
    state: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Vec<Value>, String> {
    state
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("领域状态缺少 {key} 集合。"))
}

pub(crate) fn array_mut<'a>(
    state: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Vec<Value>, String> {
    state
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("领域状态缺少 {key} 集合。"))
}

fn round_ratio(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn revision(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT revision FROM domain_state_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(0))
        .map_err(|error| error.to_string())
}

fn parse_envelope(raw: &str) -> Result<(i64, Map<String, Value>), String> {
    let raw = crate::domain_store::normalize_legacy_envelope(raw)?;
    let envelope: Value =
        serde_json::from_str(&raw).map_err(|error| format!("领域状态 JSON 无效：{error}"))?;
    let version = envelope
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "领域状态缺少版本。".to_string())?;
    let state = envelope
        .get("state")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| "领域状态缺少 state。".to_string())?;
    Ok((version, state))
}

fn load_command_state(
    connection: &Connection,
    bootstrap_state: Option<&str>,
) -> Result<(i64, Map<String, Value>), String> {
    if let Some(raw) = load_envelope(connection)? {
        return parse_envelope(&raw);
    }
    let legacy: Option<String> = connection
        .query_row(
            "SELECT value FROM app_kv WHERE key = ?1",
            [STORAGE_NAME],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let raw = legacy
        .as_deref()
        .or(bootstrap_state)
        .ok_or_else(|| "领域仓库尚未初始化，且没有可用的启动状态。".to_string())?;
    parse_envelope(raw)
}

pub(crate) fn prepare_recipe(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let recipe_id = payload_str(payload, "recipeVersionId")?;
    let recipe = array(state, "recipes")?
        .iter()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(recipe_id))
        .cloned()
        .ok_or_else(|| "找不到菜谱版本。".to_string())?;
    let recipe_name = recipe
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("未命名菜谱")
        .to_owned();
    let ingredients = recipe
        .get("ingredients")
        .and_then(Value::as_array)
        .ok_or_else(|| "菜谱原料无效。".to_string())?;

    let (_, today) = now_and_date();
    let usable = |lot: &Value, unit: &str| {
        lot.get("unit").and_then(Value::as_str) == Some(unit)
            && lot
                .get("expiresAt")
                .and_then(Value::as_str)
                .is_none_or(|value| value >= today.as_str())
    };
    let mut requirements: Vec<(String, String, String, f64)> = Vec::new();
    for ingredient in ingredients {
        let food_id = payload_str(ingredient, "foodId")?.to_owned();
        let name = payload_str(ingredient, "name")?.to_owned();
        let unit = payload_str(ingredient, "unit")?.to_owned();
        let amount = payload_number(ingredient, "amount")?;
        if amount <= 0.0 {
            return Err("菜谱原料数量必须大于 0。".into());
        }
        if let Some(existing) = requirements.iter_mut().find(|item| item.0 == food_id) {
            if existing.2 != unit {
                return Err("同一食材的计量单位不一致。".into());
            }
            existing.3 += amount;
        } else {
            requirements.push((food_id, name, unit, amount));
        }
    }

    let inventory = array(state, "inventory")?;
    let shortages: Vec<String> = requirements
        .iter()
        .filter_map(|(food_id, name, unit, required)| {
            let available: f64 = inventory
                .iter()
                .filter(|lot| lot.get("foodId").and_then(Value::as_str) == Some(food_id))
                .filter(|lot| usable(lot, unit))
                .filter_map(|lot| lot.get("remainingAmount").and_then(Value::as_f64))
                .sum();
            (available + 0.0001 < *required)
                .then(|| format!("{name} 缺 {:.2}{unit}", (required - available).max(0.0)))
        })
        .collect();
    if !shortages.is_empty() {
        return Ok(CommandMutation {
            applied: false,
            result: json!({ "shortage": shortages }),
        });
    }

    let (now, date) = now_and_date();
    let batch_id = format!("batch-{command_id}");
    let mut movements = Vec::new();
    {
        let inventory = array_mut(state, "inventory")?;
        for (food_id, _, unit, required) in &requirements {
            let mut candidates: Vec<usize> = inventory
                .iter()
                .enumerate()
                .filter(|(_, lot)| {
                    lot.get("foodId").and_then(Value::as_str) == Some(food_id)
                        && usable(lot, unit)
                        && lot
                            .get("remainingAmount")
                            .and_then(Value::as_f64)
                            .unwrap_or(0.0)
                            > 0.0
                })
                .map(|(index, _)| index)
                .collect();
            candidates.sort_by(|left, right| {
                let left_lot = &inventory[*left];
                let right_lot = &inventory[*right];
                let opened = right_lot
                    .get("opened")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    .cmp(
                        &left_lot
                            .get("opened")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    );
                if opened != Ordering::Equal {
                    return opened;
                }
                left_lot
                    .get("expiresAt")
                    .and_then(Value::as_str)
                    .unwrap_or("9999-12-31")
                    .cmp(
                        right_lot
                            .get("expiresAt")
                            .and_then(Value::as_str)
                            .unwrap_or("9999-12-31"),
                    )
                    .then_with(|| {
                        left_lot
                            .get("purchasedAt")
                            .and_then(Value::as_str)
                            .unwrap_or("9999-12-31")
                            .cmp(
                                right_lot
                                    .get("purchasedAt")
                                    .and_then(Value::as_str)
                                    .unwrap_or("9999-12-31"),
                            )
                    })
            });
            let mut remaining = *required;
            for index in candidates {
                if remaining <= 0.0001 {
                    break;
                }
                let lot = inventory[index]
                    .as_object_mut()
                    .ok_or_else(|| "库存批次格式无效。".to_string())?;
                let current = lot
                    .get("remainingAmount")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let deducted = current.min(remaining);
                lot.insert(
                    "remainingAmount".into(),
                    json!(round_ratio(current - deducted)),
                );
                let lot_id = lot
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "库存批次缺少标识。".to_string())?;
                movements.push(json!({
                    "id": format!("{command_id}:movement:{}", movements.len()),
                    "lotId": lot_id,
                    "type": "cooking",
                    "amount": -deducted,
                    "reason": recipe_name,
                    "createdAt": now,
                }));
                remaining -= deducted;
            }
        }
    }

    array_mut(state, "inventoryMovements")?.extend(movements);
    array_mut(state, "batches")?.push(json!({
        "id": batch_id,
        "recipeVersionId": recipe_id,
        "date": date,
        "inventoryDeducted": true,
        "consumedRatio": 0,
        "wastedRatio": 0,
        "remainingRatio": 1,
        "status": "open",
        "ratioIsEstimated": false,
        "createdAt": now,
    }));
    array_mut(state, "auditEvents")?.push(json!({
        "id": format!("{command_id}:audit"),
        "eventType": "prepared_batch_created",
        "entityType": "prepared_batch",
        "entityId": batch_id,
        "payload": { "recipeVersionId": recipe_id, "commandId": command_id },
        "createdAt": now,
    }));
    Ok(CommandMutation {
        applied: true,
        result: json!({ "shortage": [], "batchId": batch_id }),
    })
}

fn consume_batch(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let batch_id = payload_str(payload, "batchId")?.to_owned();
    let meal_type = payload_str(payload, "mealType")?.to_owned();
    if !matches!(
        meal_type.as_str(),
        "breakfast" | "lunch" | "dinner" | "snack"
    ) {
        return Err("餐次无效。".into());
    }
    let ratio = payload_number(payload, "ratio")?;
    if ratio <= 0.0 || ratio > 1.0 {
        return Err("进食比例必须大于 0 且不超过 1。".into());
    }
    let ratio_is_estimated = payload
        .get("ratioIsEstimated")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let batch_index = array(state, "batches")?
        .iter()
        .position(|value| value.get("id").and_then(Value::as_str) == Some(&batch_id))
        .ok_or_else(|| "这个批次不存在。".to_string())?;
    let batch_snapshot = array(state, "batches")?[batch_index].clone();
    if batch_snapshot.get("status").and_then(Value::as_str) == Some("closed") {
        return Err("这个批次已经结束。".into());
    }
    let remaining = batch_snapshot
        .get("remainingRatio")
        .and_then(Value::as_f64)
        .unwrap_or_else(|| {
            1.0 - batch_snapshot
                .get("consumedRatio")
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                - batch_snapshot
                    .get("wastedRatio")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
        });
    if ratio > remaining + 0.0001 {
        return Err(format!(
            "最多只能记录剩余整锅的 {}%。",
            (remaining * 100.0).round()
        ));
    }
    let recipe_id = batch_snapshot
        .get("recipeVersionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "批次缺少菜谱版本。".to_string())?;
    let recipe = array(state, "recipes")?
        .iter()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(recipe_id))
        .cloned()
        .ok_or_else(|| "找不到批次对应的菜谱版本。".to_string())?;
    let recipe_name = recipe
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("未命名菜谱");
    let (now, date) = now_and_date();
    let next_remaining = round_ratio((remaining - ratio).max(0.0));
    let event_id = format!("{command_id}:consumption");
    let meal_id = format!("{command_id}:meal");

    {
        let batch = array_mut(state, "batches")?[batch_index]
            .as_object_mut()
            .ok_or_else(|| "批次格式无效。".to_string())?;
        let consumed = batch
            .get("consumedRatio")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let previously_estimated = batch
            .get("ratioIsEstimated")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        batch.insert("consumedRatio".into(), json!(round_ratio(consumed + ratio)));
        batch.insert("remainingRatio".into(), json!(next_remaining));
        batch.insert(
            "ratioIsEstimated".into(),
            json!(previously_estimated || ratio_is_estimated),
        );
        if next_remaining <= 0.0001 {
            batch.insert("status".into(), json!("closed"));
            batch.insert("closedAt".into(), json!(now));
        }
    }
    array_mut(state, "consumptionEvents")?.push(json!({
        "id": event_id,
        "batchId": batch_id,
        "date": date,
        "mealType": meal_type,
        "ratio": ratio,
        "ratioIsEstimated": ratio_is_estimated,
        "createdAt": now,
    }));
    array_mut(state, "meals")?.push(json!({
        "id": meal_id,
        "date": date,
        "type": meal_type,
        "name": recipe_name,
        "amountLabel": format!("整锅的 {}%{}", (ratio * 100.0).round(), if ratio_is_estimated { "（估算）" } else { "" }),
        "nutrition": recipe.get("nutrition").cloned().unwrap_or_else(|| json!({})),
        "consumedRatio": ratio,
        "source": recipe.get("source").cloned().unwrap_or_else(|| json!("manual")),
        "confidence": if ratio_is_estimated { "medium" } else { "high" },
        "preparedBatchId": batch_id,
        "consumptionEventId": event_id,
        "createdAt": now,
    }));
    array_mut(state, "auditEvents")?.push(json!({
        "id": format!("{command_id}:audit"),
        "eventType": "batch_consumption_recorded",
        "entityType": "consumption_event",
        "entityId": event_id,
        "payload": { "batchId": batch_id, "mealId": meal_id, "mealType": meal_type, "ratio": ratio, "ratioIsEstimated": ratio_is_estimated, "commandId": command_id },
        "createdAt": now,
    }));
    Ok(CommandMutation {
        applied: true,
        result: json!({}),
    })
}

fn discard_batch(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let batch_id = payload_str(payload, "batchId")?.to_owned();
    let reason = payload
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("discarded");
    if !matches!(reason, "discarded" | "spoiled" | "other") {
        return Err("熟食丢弃原因无效。".into());
    }
    let batch_index = array(state, "batches")?
        .iter()
        .position(|value| value.get("id").and_then(Value::as_str) == Some(&batch_id))
        .ok_or_else(|| "这个批次不存在。".to_string())?;
    let snapshot = array(state, "batches")?[batch_index].clone();
    if snapshot.get("status").and_then(Value::as_str) == Some("closed") {
        return Err("这个批次已经结束。".into());
    }
    let remaining = snapshot
        .get("remainingRatio")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if remaining <= 0.0001 {
        return Err("这个批次已经没有剩余。".into());
    }
    let wasted = snapshot
        .get("wastedRatio")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let (now, date) = now_and_date();
    let event_id = format!("{command_id}:waste");
    {
        let batch = array_mut(state, "batches")?[batch_index]
            .as_object_mut()
            .ok_or_else(|| "批次格式无效。".to_string())?;
        batch.insert("wastedRatio".into(), json!(round_ratio(wasted + remaining)));
        batch.insert("remainingRatio".into(), json!(0));
        batch.insert("status".into(), json!("closed"));
        batch.insert("closedAt".into(), json!(now));
    }
    array_mut(state, "wasteEvents")?.push(json!({
        "id": event_id,
        "batchId": batch_id,
        "date": date,
        "ratio": remaining,
        "reason": reason,
        "createdAt": now,
    }));
    array_mut(state, "auditEvents")?.push(json!({
        "id": format!("{command_id}:audit"),
        "eventType": "batch_remainder_discarded",
        "entityType": "waste_event",
        "entityId": event_id,
        "payload": { "batchId": batch_id, "ratio": remaining, "reason": reason, "commandId": command_id },
        "createdAt": now,
    }));
    Ok(CommandMutation {
        applied: true,
        result: json!({}),
    })
}

fn receive_purchase(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    crate::inventory_ops::apply(state, "receive_purchase", payload, command_id)
}

fn adjust_inventory(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    crate::inventory_ops::apply(state, "adjust_inventory", payload, command_id)
}

fn execute_with_connection(
    connection: &mut Connection,
    request: DomainCommandRequest,
) -> Result<DomainCommandResponse, String> {
    ensure_repository_schema(connection)?;
    if request.command_id.len() < 8 || request.command_id.len() > 160 {
        return Err("commandId 长度无效。".into());
    }
    if !matches!(
        request.kind.as_str(),
        "save_food_definition"
            | "revise_food_definition"
            | "set_food_favorite"
            | "record_food_meal"
            | "add_meal"
            | "add_weight"
            | "add_workout"
            | "set_checkin"
            | "set_day_complete"
            | "add_purchase"
            | "revise_purchase"
            | "close_purchase"
            | "update_purchase_payment"
            | "dispose_inventory"
            | "select_plan"
            | "add_inbox_item"
            | "set_inbox_status"
            | "set_ai_settings"
            | "record_ai_usage"
            | "prepare_recipe"
            | "consume_batch"
            | "discard_batch"
            | "receive_purchase"
            | "adjust_inventory"
    ) {
        return Err("未知的领域命令。".into());
    }

    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("无法开始领域命令事务：{error}"))?;
    let receipt: Option<(String, String, i64)> = transaction
        .query_row(
            "SELECT command_kind, result_json, applied_revision FROM domain_command_receipts WHERE command_id = ?1",
            [&request.command_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let request_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&request.payload).map_err(|error| error.to_string())?)
    );
    if let Some((stored_kind, stored_result, applied_revision)) = receipt {
        if stored_kind != request.kind {
            return Err("同一 commandId 不能用于不同命令。".into());
        }
        let stored_hash: Option<String> = transaction
            .query_row(
                "SELECT request_sha256 FROM domain_command_payloads WHERE command_id = ?1",
                [&request.command_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if stored_hash.as_deref() != Some(&request_hash) {
            return Err(
                "命令内容与原提交不同或属于旧版回执，请先核对已保存记录后重新发起。".into(),
            );
        }
        let (_, state) = load_command_state(&transaction, request.bootstrap_state.as_deref())?;
        return Ok(DomainCommandResponse {
            applied: true,
            replayed: true,
            revision: revision(&transaction)?.max(applied_revision),
            result: serde_json::from_str(&stored_result).map_err(|error| error.to_string())?,
            state: Value::Object(state),
        });
    }

    let (version, mut state) =
        load_command_state(&transaction, request.bootstrap_state.as_deref())?;
    let mutation = match request.kind.as_str() {
        "save_food_definition"
        | "revise_food_definition"
        | "set_food_favorite"
        | "record_food_meal" => crate::food_library::apply(
            &mut state,
            &request.kind,
            &request.payload,
            &request.command_id,
        )?,
        "prepare_recipe" => prepare_recipe(&mut state, &request.payload, &request.command_id)?,
        "consume_batch" => consume_batch(&mut state, &request.payload, &request.command_id)?,
        "discard_batch" => discard_batch(&mut state, &request.payload, &request.command_id)?,
        "receive_purchase" => receive_purchase(&mut state, &request.payload, &request.command_id)?,
        "adjust_inventory" => adjust_inventory(&mut state, &request.payload, &request.command_id)?,
        "add_purchase"
        | "revise_purchase"
        | "close_purchase"
        | "update_purchase_payment"
        | "dispose_inventory" => crate::inventory_ops::apply(
            &mut state,
            &request.kind,
            &request.payload,
            &request.command_id,
        )?,
        _ => crate::record_commands::apply(
            &mut state,
            &request.kind,
            &request.payload,
            &request.command_id,
        )?,
    };
    if !mutation.applied {
        return Ok(DomainCommandResponse {
            applied: false,
            replayed: false,
            revision: revision(&transaction)?,
            result: mutation.result,
            state: Value::Object(state),
        });
    }

    let envelope = serde_json::to_string(&json!({
        "state": Value::Object(state.clone()),
        "version": version,
    }))
    .map_err(|error| error.to_string())?;
    let hash = format!("{:x}", Sha256::digest(envelope.as_bytes()));
    let now = Utc::now().to_rfc3339();
    write_transaction(&transaction, &state, version, &hash, &now)?;
    let applied_revision = revision(&transaction)?;
    let result_json = serde_json::to_string(&mutation.result).map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO domain_command_receipts (command_id, command_kind, result_json, applied_revision, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![request.command_id, request.kind, result_json, applied_revision, now],
        )
        .map_err(|error| format!("保存命令回执失败：{error}"))?;
    transaction
        .execute(
            "INSERT INTO domain_command_payloads (command_id, request_sha256) VALUES (?1, ?2)",
            params![request.command_id, request_hash],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .map_err(|error| format!("提交领域命令失败：{error}"))?;
    Ok(DomainCommandResponse {
        applied: true,
        replayed: false,
        revision: applied_revision,
        result: mutation.result,
        state: Value::Object(state),
    })
}

#[tauri::command]
pub fn execute_domain_command(
    app: AppHandle,
    request: DomainCommandRequest,
) -> Result<DomainCommandResponse, String> {
    let mut connection = open_database(&app)?;
    execute_with_connection(&mut connection, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain_store::ensure_repository_schema;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
            )
            .unwrap();
        ensure_repository_schema(&connection).unwrap();
        connection
    }

    fn food_payload() -> Value {
        json!({"input":{"name":"燕麦","brand":"example","measurementBasis":"packaged","basis":{"quantity":100,"unit":"g"},"energyUnit":"kcal","nutrients":{"calories":400,"protein":12,"fat":0},"conversions":[{"unit":"package","quantity":1,"basisQuantity":200}],"source":"label"}})
    }

    #[test]
    fn food_library_reopens_and_replays_without_changing_history_or_inventory() {
        let directory = std::env::temp_dir().join(format!(
            "fitwise-food-integration-{}",
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("fitwise.db");
        let mut connection = Connection::open(&path).unwrap();
        let food = execute_with_connection(
            &mut connection,
            request(
                "food-command-01",
                "save_food_definition",
                food_payload(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        assert_eq!(food.state["meals"], json!([]));
        assert_eq!(food.state["inventoryMovements"], json!([]));
        let inventory = food.state["inventory"].clone();
        let recipe = food.state["recipes"].clone();
        let replay = execute_with_connection(
            &mut connection,
            request(
                "food-command-01",
                "save_food_definition",
                food_payload(),
                None,
            ),
        )
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.state["foodDefinitions"].as_array().unwrap().len(), 1);
        execute_with_connection(
            &mut connection,
            request(
                "favorite-command-01",
                "set_food_favorite",
                json!({"foodId":"food-food-command-01","favorite":true}),
                None,
            ),
        )
        .unwrap();
        let meal_input = json!({"date":"2026-10-20","type":"breakfast","entries":[{"foodVersionId":"food-version-food-command-01","quantity":50,"unit":"g"},{"foodVersionId":"food-version-food-command-01","quantity":0.25,"unit":"package"}]});
        let first = execute_with_connection(
            &mut connection,
            request(
                "food-meal-command-01",
                "record_food_meal",
                meal_input.clone(),
                None,
            ),
        )
        .unwrap();
        assert_eq!(
            first.state["meals"][0]["nutrition"]["calories"]["value"],
            200.0
        );
        assert_eq!(
            first.state["meals"][1]["nutrition"]["calories"]["value"],
            200.0
        );
        assert_eq!(first.state["inventory"], inventory);
        drop(connection);
        let mut connection = Connection::open(&path).unwrap();
        let replay = execute_with_connection(
            &mut connection,
            request("food-meal-command-01", "record_food_meal", meal_input, None),
        )
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.state["meals"].as_array().unwrap().len(), 2);
        assert_eq!(
            crate::food_library::search_state(
                replay.state.as_object().unwrap(),
                "example",
                "favorites"
            )
            .unwrap()
            .len(),
            1
        );
        assert_eq!(
            crate::food_library::search_state(replay.state.as_object().unwrap(), "", "recent")
                .unwrap()
                .len(),
            1
        );
        let mut revised = food_payload();
        revised["foodId"] = json!("food-food-command-01");
        revised["expectedVersionId"] = json!("food-version-food-command-01");
        revised["input"]["nutrients"]["calories"] = json!(450);
        let result = execute_with_connection(
            &mut connection,
            request(
                "revision-command-01",
                "revise_food_definition",
                revised,
                None,
            ),
        )
        .unwrap();
        assert_eq!(result.state["meals"], first.state["meals"]);
        assert_eq!(result.state["recipes"], recipe);
        assert_eq!(result.state["inventory"], inventory);
        let envelope: Value =
            serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
        assert_eq!(envelope["version"], 4);
        assert_eq!(
            envelope["state"]["foodDefinitionVersions"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        drop(connection);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn food_batch_failure_is_atomic_and_changed_replay_is_rejected() {
        let mut connection = connection();
        execute_with_connection(
            &mut connection,
            request(
                "food-command-01",
                "save_food_definition",
                food_payload(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let before = load_envelope(&connection).unwrap();
        let bad_input = json!({"date":"2026-10-20","type":"lunch","entries":[{"foodVersionId":"food-version-food-command-01","quantity":50,"unit":"g"},{"foodVersionId":"food-version-food-command-01","quantity":10,"unit":"ml"}]});
        assert!(execute_with_connection(
            &mut connection,
            request("food-meal-failed-01", "record_food_meal", bad_input, None)
        )
        .unwrap_err()
        .contains("换算"));
        assert_eq!(load_envelope(&connection).unwrap(), before);
        let mut changed = food_payload();
        changed["input"]["nutrients"]["calories"] = json!(999);
        assert!(execute_with_connection(
            &mut connection,
            request("food-command-01", "save_food_definition", changed, None)
        )
        .unwrap_err()
        .contains("命令内容"));
        let good_input = json!({"date":"2026-10-20","type":"lunch","entries":[{"foodVersionId":"food-version-food-command-01","quantity":50,"unit":"g"}]});
        assert!(
            execute_with_connection(
                &mut connection,
                request("food-meal-failed-01", "record_food_meal", good_input, None)
            )
            .unwrap()
            .applied
        );
    }

    #[test]
    fn packaged_purchase_partial_receipt_close_refund_and_count_are_transactional() {
        let mut connection = connection();
        let input = json!({"name":"测试酸奶","platform":"pinduoduo","amount":1,"unit":"pack","packaging":{"count":2,"container":"bag","contentAmount":1,"contentUnit":"kg"},"packagingConfirmed":true,"priceCny":18.78,"paidCny":0,"orderedAt":"2026-10-19T18:17:31+08:00","expectedArrival":"2026-10-22","status":"ordered","confidence":"high"});
        let first = execute_with_connection(
            &mut connection,
            request(
                "order-spec-001",
                "add_purchase",
                input.clone(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let id = first.state["purchases"][0]["id"].as_str().unwrap();
        assert_eq!(
            first.state["purchases"][0]["orderedAt"],
            "2026-10-19T10:17:31+00:00"
        );
        assert_eq!(first.state["purchases"][0]["paidCny"], 0.0);
        assert_eq!(first.state["inventory"].as_array().unwrap().len(), 2);
        assert!(
            execute_with_connection(
                &mut connection,
                request("order-spec-001", "add_purchase", input, None)
            )
            .unwrap()
            .replayed
        );
        let receipt = json!({"purchaseId":id,"quantity":0.5,"actualAmount":980,"costCny":9.39,"receivedAt":now_and_date().1,"expiresAt":"2099-01-01","final":false,"reason":"实称 980 克"});
        let received = execute_with_connection(
            &mut connection,
            request(
                "receipt-spec-001",
                "receive_purchase",
                receipt.clone(),
                None,
            ),
        )
        .unwrap();
        assert_eq!(
            received.state["purchases"][0]["status"],
            "partially_received"
        );
        assert_eq!(received.state["inventory"][2]["remainingAmount"], 980.0);
        assert_eq!(received.state["inventory"][2]["unit"], "g");
        assert_eq!(received.state["inventory"][2]["purchaseId"], id);
        assert!(received.state["inventory"][2]["specification"]
            .as_str()
            .unwrap()
            .contains("袋"));
        assert!(
            execute_with_connection(
                &mut connection,
                request("receipt-spec-001", "receive_purchase", receipt, None)
            )
            .unwrap()
            .replayed
        );
        let closed = execute_with_connection(
            &mut connection,
            request(
                "close-spec-001",
                "close_purchase",
                json!({"purchaseId":id,"reason":"缺货，不再补发"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(closed.state["purchases"][0]["closedQuantity"], 0.5);
        assert_eq!(closed.state["inventory"].as_array().unwrap().len(), 3);
        execute_with_connection(
            &mut connection,
            request(
                "payment-spec-001",
                "update_purchase_payment",
                json!({"purchaseId":id,"paidCny":18.78,"refundedCny":0,"reason":"已核对扣款"}),
                None,
            ),
        )
        .unwrap();
        let loss = json!({"lotId":"lot-receipt-spec-001","amount":200,"kind":"return","refundCny":1.88,"reason":"已退回且退款到账"});
        let returned = execute_with_connection(
            &mut connection,
            request("return-spec-001", "dispose_inventory", loss.clone(), None),
        )
        .unwrap();
        assert_eq!(returned.state["inventory"][2]["remainingAmount"], 780.0);
        assert_eq!(returned.state["purchases"][0]["refundedCny"], 1.88);
        assert!(
            execute_with_connection(
                &mut connection,
                request("return-spec-001", "dispose_inventory", loss, None)
            )
            .unwrap()
            .replayed
        );
        let before = load_envelope(&connection).unwrap();
        assert!(execute_with_connection(&mut connection,request("count-spec-bad","adjust_inventory",json!({"lotId":"lot-receipt-spec-001","remainingAmount":981,"reason":"不能补回退货"}),None)).is_err());
        assert_eq!(load_envelope(&connection).unwrap(), before);
        let counted=execute_with_connection(&mut connection,request("count-spec-001","adjust_inventory",json!({"lotId":"lot-receipt-spec-001","remainingAmount":750,"opened":true,"expiresAt":null,"reason":"重新称重盘点"}),None)).unwrap();
        assert_eq!(counted.state["inventory"][2]["remainingAmount"], 750.0);
        assert_eq!(counted.state["inventory"][2]["opened"], true);
        assert!(counted.state["inventory"][2].get("expiresAt").is_none());
        assert!(counted.state["inventory"][2]["lastCountedAt"].is_string());
        let summary = crate::domain_queries::inventory_summary(&connection).unwrap();
        assert!(summary["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["purchaseId"] == id && v["lastCountedAt"].is_string()));
        assert_eq!(counted.state["meals"], first.state["meals"]);
        assert_eq!(counted.state["recipes"], first.state["recipes"]);
    }

    #[test]
    fn legacy_order_revision_and_failed_refund_do_not_lose_data_or_mutate_stock() {
        let mut connection = connection();
        let mut legacy: Value = serde_json::from_str(&bootstrap()).unwrap();
        legacy["state"]["purchases"] = json!([{"id":"legacy-order","name":"酸奶","foodId":"food-legacy-order","platform":"online","amount":2000,"unit":"g","priceCny":18.78,"status":"ordered","confidence":"high"}]);
        let revised = json!({"purchaseId":"legacy-order","name":"酸奶","foodId":"food-legacy-order","platform":"pinduoduo","amount":1,"unit":"pack","packaging":{"count":2,"container":"bag","contentAmount":1,"contentUnit":"kg"},"packagingConfirmed":true,"priceCny":18.78,"orderedAt":"2026-10-19T10:17:31Z","status":"ordered","confidence":"high"});
        let edit = execute_with_connection(
            &mut connection,
            request(
                "revise-legacy-001",
                "revise_purchase",
                revised,
                Some(legacy.to_string()),
            ),
        )
        .unwrap();
        assert_eq!(edit.state["purchases"][0]["platform"], "pinduoduo");
        assert!(edit.state["purchases"][0].get("paidCny").is_none());
        let recv = execute_with_connection(
            &mut connection,
            request(
                "recv-legacy-001",
                "receive_purchase",
                json!({"purchaseId":"legacy-order"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(recv.state["inventory"][2]["purchasedAmount"], 2000.0);
        let before = load_envelope(&connection).unwrap();
        assert!(execute_with_connection(&mut connection,request("bad-refund-001","dispose_inventory",json!({"lotId":"lot-recv-legacy-001","amount":10,"kind":"return","refundCny":1,"reason":"付款未知不能记退款"}),None)).is_err());
        assert_eq!(load_envelope(&connection).unwrap(), before);
        let waste = execute_with_connection(
            &mut connection,
            request(
                "waste-legacy-001",
                "dispose_inventory",
                json!({"lotId":"lot-recv-legacy-001","amount":100,"kind":"waste","reason":"腐坏"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(waste.state["inventory"][2]["remainingAmount"], 1900.0);
        assert!(waste.state["purchases"][0].get("paidCny").is_none());
    }

    #[test]
    fn packaged_400g_cooks_300g_and_preserves_100g_without_double_deduction() {
        let mut connection = connection();
        let mut initial: Value = serde_json::from_str(&bootstrap()).unwrap();
        initial["state"]["inventory"] = json!([]);
        let input = json!({"name":"豆腐","foodId":"tofu","platform":"jd","amount":1,"unit":"bag","packaging":{"count":1,"container":"bag","contentAmount":400,"contentUnit":"g"},"packagingConfirmed":true,"priceCny":4,"status":"ordered","confidence":"high"});
        let order = execute_with_connection(
            &mut connection,
            request(
                "400g-order-01",
                "add_purchase",
                input,
                Some(initial.to_string()),
            ),
        )
        .unwrap();
        let id = order.state["purchases"][0]["id"].as_str().unwrap();
        execute_with_connection(
            &mut connection,
            request(
                "400g-receive-01",
                "receive_purchase",
                json!({"purchaseId":id}),
                None,
            ),
        )
        .unwrap();
        let prepared = execute_with_connection(
            &mut connection,
            request(
                "400g-cooking-01",
                "prepare_recipe",
                json!({"recipeVersionId":"recipe-1"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(prepared.state["inventory"][0]["remainingAmount"], 100.0);
        assert_eq!(prepared.state["meals"], json!([]));
        let summary = crate::domain_queries::inventory_summary(&connection).unwrap();
        assert_eq!(summary["remainingCostCny"], 1.0);
        let replay = execute_with_connection(
            &mut connection,
            request(
                "400g-cooking-01",
                "prepare_recipe",
                json!({"recipeVersionId":"recipe-1"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(replay.state["inventory"][0]["remainingAmount"], 100.0);
    }

    fn bootstrap() -> String {
        let mut state = Map::new();
        state.insert("profile".into(), json!({"name":"test"}));
        state.insert("aiSettings".into(), json!({"provider":"openai"}));
        for collection in [
            "meals",
            "checkIns",
            "measurements",
            "workouts",
            "batches",
            "consumptionEvents",
            "wasteEvents",
            "auditEvents",
            "inventoryMovements",
            "purchases",
            "inbox",
            "plans",
        ] {
            state.insert(collection.into(), json!([]));
        }
        state.insert(
            "recipes".into(),
            json!([{
                "id":"recipe-1", "name":"豆腐锅", "source":"personal",
                "nutrition":{"calories":{"state":"known","value":800,"unit":"kcal","source":"personal","confidence":"high"}},
                "ingredients":[{"foodId":"tofu","name":"豆腐","amount":300,"unit":"g"}]
            }]),
        );
        state.insert(
            "inventory".into(),
            json!([
                {"id":"lot-late-open","foodId":"tofu","name":"豆腐","unit":"g","purchasedAmount":200,"purchasePriceCny":2,"remainingAmount":200,"opened":true,"expiresAt":"2099-10-25","purchasedAt":"2026-10-10"},
                {"id":"lot-early","foodId":"tofu","name":"豆腐","unit":"g","purchasedAmount":200,"purchasePriceCny":2,"remainingAmount":200,"opened":false,"expiresAt":"2099-10-21","purchasedAt":"2026-10-11"}
            ]),
        );
        serde_json::to_string(&json!({"state":state,"version":3})).unwrap()
    }

    fn request(
        id: &str,
        kind: &str,
        payload: Value,
        bootstrap_state: Option<String>,
    ) -> DomainCommandRequest {
        DomainCommandRequest {
            command_id: id.into(),
            kind: kind.into(),
            payload,
            bootstrap_state,
        }
    }

    #[test]
    fn prepare_is_idempotent_and_deducts_fefo_once() {
        let mut connection = connection();
        let first = execute_with_connection(
            &mut connection,
            request(
                "prepare-0001",
                "prepare_recipe",
                json!({"recipeVersionId":"recipe-1"}),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let replay = execute_with_connection(
            &mut connection,
            request(
                "prepare-0001",
                "prepare_recipe",
                json!({"recipeVersionId":"recipe-1"}),
                None,
            ),
        )
        .unwrap();
        assert!(first.applied);
        assert!(replay.replayed);
        assert_eq!(first.revision, replay.revision);
        let state = replay.state.as_object().unwrap();
        assert_eq!(state["batches"].as_array().unwrap().len(), 1);
        assert_eq!(state["inventoryMovements"].as_array().unwrap().len(), 2);
        assert_eq!(state["inventory"][0]["remainingAmount"].as_f64(), Some(0.0));
        assert_eq!(
            state["inventory"][1]["remainingAmount"].as_f64(),
            Some(100.0)
        );
    }

    #[test]
    fn concurrent_file_commands_and_restart_preserve_every_write() {
        let directory =
            std::env::temp_dir().join(format!("fitwise-command-file-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("fitwise.db");
        let mut connection = Connection::open(&path).unwrap();
        ensure_repository_schema(&connection).unwrap();
        execute_with_connection(
            &mut connection,
            request(
                "file-initial-001",
                "set_checkin",
                json!({"date":"2026-10-20","energy":3}),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        drop(connection);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_>=(0..2).map(|index|{
            let path=path.clone();let barrier=barrier.clone();
            std::thread::spawn(move||{
                let mut connection=Connection::open(path).unwrap();
                connection.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
                barrier.wait();
                execute_with_connection(&mut connection,request(&format!("file-workout-{index}"),"add_workout",json!({"date":"2026-10-20","name":"有氧","type":"有氧","durationMinutes":22}),None)).unwrap();
            })
        }).collect();
        for handle in handles {
            handle.join().unwrap();
        }
        let mut restarted = Connection::open(&path).unwrap();
        let replay = execute_with_connection(
            &mut restarted,
            request(
                "file-workout-0",
                "add_workout",
                json!({"date":"2026-10-20","name":"有氧","type":"有氧","durationMinutes":22}),
                None,
            ),
        )
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.state["workouts"].as_array().unwrap().len(), 2);
        assert_eq!(
            crate::domain_queries::period_summary(&restarted, "2026-10-20", "2026-10-20").unwrap()
                ["workoutMinutes"],
            44.0
        );
        drop(restarted);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn expired_or_wrong_unit_stock_cannot_be_used_or_confirmed_as_plan() {
        let mut connection = connection();
        let mut envelope: Value = serde_json::from_str(&bootstrap()).unwrap();
        envelope["state"]["inventory"][0]["expiresAt"] = json!("2000-01-01");
        envelope["state"]["inventory"][1]["unit"] = json!("ml");
        envelope["state"]["plans"] = json!([{"id":"plan-1","recipeVersionId":"recipe-1","date":"2026-10-21","inventoryCoverage":100,"missingIngredients":[],"status":"candidate"}]);
        let raw = envelope.to_string();
        let prepare = execute_with_connection(
            &mut connection,
            request(
                "expired-prepare1",
                "prepare_recipe",
                json!({"recipeVersionId":"recipe-1"}),
                Some(raw.clone()),
            ),
        )
        .unwrap();
        assert!(!prepare.applied);
        assert_eq!(prepare.state["inventory"][0]["remainingAmount"], 200);
        assert!(execute_with_connection(
            &mut connection,
            request(
                "expired-select-1",
                "select_plan",
                json!({"planId":"plan-1"}),
                Some(raw)
            )
        )
        .is_err());
        assert_eq!(revision(&connection).unwrap(), 0);
    }

    #[test]
    fn record_commands_keep_revisions_and_request_identity() {
        let mut connection = connection();
        let first = execute_with_connection(
            &mut connection,
            request(
                "weight-first-01",
                "add_weight",
                json!({"weightKg":83,"date":"2026-10-20"}),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let second = execute_with_connection(
            &mut connection,
            request(
                "weight-next-001",
                "add_weight",
                json!({"weightKg":82.6,"date":"2026-10-20"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(second.state["measurements"].as_array().unwrap().len(), 2);
        assert_eq!(second.state["measurements"][0]["status"], "superseded");
        assert_eq!(
            second.state["measurements"][1]["supersedesId"],
            first.state["measurements"][0]["id"]
        );
        let replay = execute_with_connection(
            &mut connection,
            request(
                "weight-next-001",
                "add_weight",
                json!({"date":"2026-10-20","weightKg":82.6}),
                None,
            ),
        )
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.revision, second.revision);
        let changed = execute_with_connection(
            &mut connection,
            request(
                "weight-next-001",
                "add_weight",
                json!({"weightKg":81,"date":"2026-10-20"}),
                None,
            ),
        );
        assert!(changed.unwrap_err().contains("命令内容"));
        let abnormal = execute_with_connection(
            &mut connection,
            request(
                "weight-outlier01",
                "add_weight",
                json!({"weightKg":95,"date":"2026-10-21"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(abnormal.result["isOutlier"], true);
        assert_eq!(abnormal.state["measurements"][2]["weightKg"], 95.0);
    }

    #[test]
    fn period_projection_uses_calendar_days_complete_records_and_date_filtered_workouts() {
        let mut connection = connection();
        for (index, date, weight) in [
            (0, "2026-09-01", 100),
            (1, "2026-10-19", 84),
            (2, "2026-10-20", 82),
        ] {
            execute_with_connection(
                &mut connection,
                request(
                    &format!("weight-query-{index}"),
                    "add_weight",
                    json!({"weightKg":weight,"date":date}),
                    Some(bootstrap()),
                ),
            )
            .unwrap();
        }
        for (index, date, calories) in [(0, "2026-10-20", 1800), (1, "2026-10-21", 600)] {
            execute_with_connection(&mut connection,request(&format!("meal-query-{index}"),"add_meal",json!({"name":"测试餐","type":"lunch","amountLabel":"一份","calories":calories,"protein":100,"date":date}),None)).unwrap();
        }
        execute_with_connection(
            &mut connection,
            request(
                "complete-query-01",
                "set_day_complete",
                json!({"date":"2026-10-20","complete":true}),
                None,
            ),
        )
        .unwrap();
        for (index, date, duration) in [(0, "2026-09-01", 120), (1, "2026-10-20", 22)] {
            execute_with_connection(
                &mut connection,
                request(
                    &format!("workout-query-{index}"),
                    "add_workout",
                    json!({"date":date,"name":"有氧","type":"低冲击","durationMinutes":duration}),
                    None,
                ),
            )
            .unwrap();
        }
        let summary =
            crate::domain_queries::period_summary(&connection, "2026-10-18", "2026-10-24").unwrap();
        assert_eq!(summary["completedDayCalorieAverage"], 1800.0);
        assert_eq!(summary["workoutMinutes"], 22.0);
        assert_eq!(summary["measurements"][1]["average"], 83.0);
        assert_eq!(summary["days"][2]["coverage"]["fiber"], 0.0);
        assert_eq!(summary["days"].as_array().unwrap().len(), 7);
    }

    #[test]
    fn workout_fingerprint_and_completion_retries_do_not_duplicate_or_toggle() {
        let mut connection = connection();
        let payload = json!({"date":"2026-10-20","name":"Keep","type":"有氧","durationMinutes":22,"sourceFingerprint":"same-session"});
        let first = execute_with_connection(
            &mut connection,
            request(
                "workout-dedupe01",
                "add_workout",
                payload.clone(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let duplicate = execute_with_connection(
            &mut connection,
            request("workout-dedupe02", "add_workout", payload, None),
        )
        .unwrap();
        assert!(!duplicate.applied);
        assert_eq!(duplicate.result["duplicate"], true);
        assert_eq!(duplicate.revision, first.revision);
        let payload = json!({"date":"2026-10-20","complete":true});
        execute_with_connection(
            &mut connection,
            request(
                "complete-dedupe1",
                "set_day_complete",
                payload.clone(),
                None,
            ),
        )
        .unwrap();
        let replay = execute_with_connection(
            &mut connection,
            request("complete-dedupe1", "set_day_complete", payload, None),
        )
        .unwrap();
        assert_eq!(replay.state["checkIns"][0]["complete"], true);
        assert_eq!(replay.state["workouts"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn purchase_replenishes_existing_food_and_invalid_commands_roll_back() {
        let mut connection = connection();
        let ordered = execute_with_connection(&mut connection,request("purchase-link-01","add_purchase",json!({"name":"豆腐","foodId":"tofu","amount":500,"unit":"g","priceCny":6,"platform":"duoduo","status":"ordered","confidence":"high"}),Some(bootstrap()))).unwrap();
        assert_eq!(ordered.state["inventory"].as_array().unwrap().len(), 2);
        let received = execute_with_connection(
            &mut connection,
            request(
                "receive-link-001",
                "receive_purchase",
                json!({"purchaseId":ordered.state["purchases"][0]["id"]}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(received.state["inventory"][2]["foodId"], "tofu");
        let invalid = execute_with_connection(
            &mut connection,
            request("invalid-rating01", "set_checkin", json!({"hunger":6}), None),
        );
        assert!(invalid.is_err());
        assert_eq!(revision(&connection).unwrap(), received.revision);
    }

    #[test]
    fn inbox_and_settings_use_commands_without_accepting_confirmation_or_usage_overwrite() {
        let mut connection = connection();
        let item = execute_with_connection(
            &mut connection,
            request(
                "inbox-created-01",
                "add_inbox_item",
                json!({"kind":"text","title":"测试","preview":"一餐"}),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let item_id = item.state["inbox"][0]["id"].clone();
        assert!(execute_with_connection(
            &mut connection,
            request(
                "inbox-forbidden1",
                "set_inbox_status",
                json!({"id":item_id,"status":"confirmed"}),
                None
            )
        )
        .is_err());
        let drafted = execute_with_connection(
            &mut connection,
            request(
                "inbox-drafted-01",
                "set_inbox_status",
                json!({"id":item_id,"status":"drafted"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(drafted.state["inbox"][0]["status"], "drafted");
        execute_with_connection(
            &mut connection,
            request(
                "settings-config1",
                "set_ai_settings",
                json!({"monthlyLimitCny":20}),
                None,
            ),
        )
        .unwrap();
        let settings = execute_with_connection(
            &mut connection,
            request(
                "settings-config2",
                "set_ai_settings",
                json!({"monthlyLimitCny":null}),
                None,
            ),
        )
        .unwrap();
        assert!(settings.state["aiSettings"]
            .get("monthlyLimitCny")
            .is_none());
        assert!(execute_with_connection(
            &mut connection,
            request(
                "settings-illegal",
                "set_ai_settings",
                json!({"estimatedSpendCny":0}),
                None
            )
        )
        .is_err());
        assert!(execute_with_connection(
            &mut connection,
            request(
                "settings-url-bad",
                "set_ai_settings",
                json!({"baseUrl":"http://example.com"}),
                None
            )
        )
        .is_err());
    }

    #[test]
    fn consumption_and_discard_preserve_batch_ratio_conservation() {
        let mut connection = connection();
        let prepared = execute_with_connection(
            &mut connection,
            request(
                "prepare-0002",
                "prepare_recipe",
                json!({"recipeVersionId":"recipe-1"}),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let batch_id = prepared.result["batchId"].as_str().unwrap();
        execute_with_connection(
            &mut connection,
            request(
                "consume-0002",
                "consume_batch",
                json!({"batchId":batch_id,"mealType":"lunch","ratio":0.75,"ratioIsEstimated":true}),
                None,
            ),
        )
        .unwrap();
        let discarded = execute_with_connection(
            &mut connection,
            request(
                "discard-0002",
                "discard_batch",
                json!({"batchId":batch_id,"reason":"discarded"}),
                None,
            ),
        )
        .unwrap();
        let batch = &discarded.state["batches"][0];
        let total = batch["consumedRatio"].as_f64().unwrap()
            + batch["wastedRatio"].as_f64().unwrap()
            + batch["remainingRatio"].as_f64().unwrap();
        assert!((total - 1.0).abs() < 0.0001);
        assert_eq!(batch["status"], "closed");
        assert_eq!(discarded.state["meals"].as_array().unwrap().len(), 1);
        assert_eq!(discarded.state["wasteEvents"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn rejected_overconsumption_does_not_advance_revision() {
        let mut connection = connection();
        let prepared = execute_with_connection(
            &mut connection,
            request(
                "prepare-0003",
                "prepare_recipe",
                json!({"recipeVersionId":"recipe-1"}),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let result = execute_with_connection(
            &mut connection,
            request(
                "consume-0003",
                "consume_batch",
                json!({"batchId":prepared.result["batchId"],"mealType":"dinner","ratio":1.2,"ratioIsEstimated":true}),
                None,
            ),
        );
        assert!(result.is_err());
        assert_eq!(revision(&connection).unwrap(), prepared.revision);
        let receipts: i64 = connection
            .query_row("SELECT COUNT(*) FROM domain_command_receipts", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(receipts, 1);
    }

    #[test]
    fn receive_and_inventory_adjustment_are_idempotent() {
        let mut connection = connection();
        let mut envelope: Value = serde_json::from_str(&bootstrap()).unwrap();
        envelope["state"]["purchases"] = json!([{
            "id":"purchase-1", "name":"鸡胸肉", "platform":"duoduo",
            "amount":500, "unit":"g", "priceCny":18.8,
            "status":"ordered", "confidence":"high"
        }]);
        let bootstrap_state = serde_json::to_string(&envelope).unwrap();
        let received = execute_with_connection(
            &mut connection,
            request(
                "receive-0001",
                "receive_purchase",
                json!({"purchaseId":"purchase-1"}),
                Some(bootstrap_state),
            ),
        )
        .unwrap();
        let lot_id = received.result["lotId"].as_str().unwrap().to_owned();
        let replay = execute_with_connection(
            &mut connection,
            request(
                "receive-0001",
                "receive_purchase",
                json!({"purchaseId":"purchase-1"}),
                None,
            ),
        )
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.state["inventory"].as_array().unwrap().len(), 3);

        let adjusted = execute_with_connection(
            &mut connection,
            request(
                "adjust-0001",
                "adjust_inventory",
                json!({"lotId":lot_id,"remainingAmount":420,"reason":"称重盘点"}),
                None,
            ),
        )
        .unwrap();
        let adjusted_replay = execute_with_connection(
            &mut connection,
            request(
                "adjust-0001",
                "adjust_inventory",
                json!({"lotId":lot_id,"remainingAmount":420,"reason":"称重盘点"}),
                None,
            ),
        )
        .unwrap();
        assert!(adjusted_replay.replayed);
        let lot = adjusted.state["inventory"]
            .as_array()
            .unwrap()
            .iter()
            .find(|value| value["id"] == lot_id)
            .unwrap();
        assert_eq!(lot["remainingAmount"].as_f64(), Some(420.0));
        let adjustment_count = adjusted_replay.state["inventoryMovements"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|value| value["type"] == "adjustment")
            .count();
        assert_eq!(adjustment_count, 1);
    }
}
