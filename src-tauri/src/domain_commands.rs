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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainCommandResponse {
    applied: bool,
    replayed: bool,
    revision: i64,
    result: Value,
    state: Value,
}

struct CommandMutation {
    applied: bool,
    result: Value,
}

fn now_and_date() -> (String, String) {
    let now = Utc::now();
    let timezone = FixedOffset::east_opt(8 * 60 * 60).expect("valid Shanghai offset");
    (
        now.to_rfc3339(),
        now.with_timezone(&timezone).format("%Y-%m-%d").to_string(),
    )
}

fn payload_str<'a>(payload: &'a Value, key: &str) -> Result<&'a str, String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("命令缺少 {key}。"))
}

fn payload_number(payload: &Value, key: &str) -> Result<f64, String> {
    payload
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| format!("命令中的 {key} 无效。"))
}

fn array<'a>(state: &'a Map<String, Value>, key: &str) -> Result<&'a Vec<Value>, String> {
    state
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("领域状态缺少 {key} 集合。"))
}

fn array_mut<'a>(
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
    let envelope: Value =
        serde_json::from_str(raw).map_err(|error| format!("领域状态 JSON 无效：{error}"))?;
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

fn prepare_recipe(
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

    let mut requirements: Vec<(String, String, String, f64)> = Vec::new();
    for ingredient in ingredients {
        let food_id = payload_str(ingredient, "foodId")?.to_owned();
        let name = payload_str(ingredient, "name")?.to_owned();
        let unit = payload_str(ingredient, "unit")?.to_owned();
        let amount = payload_number(ingredient, "amount")?;
        if let Some(existing) = requirements.iter_mut().find(|item| item.0 == food_id) {
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
        for (food_id, _, _, required) in &requirements {
            let mut candidates: Vec<usize> = inventory
                .iter()
                .enumerate()
                .filter(|(_, lot)| {
                    lot.get("foodId").and_then(Value::as_str) == Some(food_id)
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
    let purchase_id = payload_str(payload, "purchaseId")?.to_owned();
    let purchase_index = array(state, "purchases")?
        .iter()
        .position(|value| value.get("id").and_then(Value::as_str) == Some(&purchase_id))
        .ok_or_else(|| "找不到待收货采购。".to_string())?;
    let purchase = array(state, "purchases")?[purchase_index].clone();
    if purchase.get("status").and_then(Value::as_str) == Some("received") {
        return Err("这笔采购已经确认收货。".into());
    }
    if purchase.get("status").and_then(Value::as_str) == Some("cancelled") {
        return Err("已取消的采购不能确认收货。".into());
    }
    let name = purchase
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "采购缺少商品名称。".to_string())?;
    let amount = purchase
        .get("amount")
        .and_then(Value::as_f64)
        .filter(|value| *value > 0.0)
        .ok_or_else(|| "采购数量无效。".to_string())?;
    let unit = purchase
        .get("unit")
        .and_then(Value::as_str)
        .ok_or_else(|| "采购单位无效。".to_string())?;
    let price = purchase
        .get("priceCny")
        .and_then(Value::as_f64)
        .filter(|value| *value >= 0.0)
        .ok_or_else(|| "采购价格无效。".to_string())?;
    let confidence = purchase
        .get("confidence")
        .and_then(Value::as_str)
        .unwrap_or("medium");
    let platform = purchase
        .get("platform")
        .and_then(Value::as_str)
        .unwrap_or("other");
    let (now, date) = now_and_date();
    let lot_id = format!("lot-{command_id}");

    array_mut(state, "purchases")?[purchase_index]
        .as_object_mut()
        .ok_or_else(|| "采购格式无效。".to_string())?
        .insert("status".into(), json!("received"));
    array_mut(state, "inventory")?.push(json!({
        "id": lot_id,
        "foodId": format!("food-{command_id}"),
        "name": name,
        "purchasedAmount": amount,
        "remainingAmount": amount,
        "unit": unit,
        "purchasePriceCny": price,
        "purchasedAt": date,
        "receivedAt": date,
        "opened": false,
        "confidence": confidence,
        "source": platform,
    }));
    array_mut(state, "inventoryMovements")?.push(json!({
        "id": format!("{command_id}:movement"),
        "lotId": lot_id,
        "type": "purchase",
        "amount": amount,
        "reason": "确认收货",
        "createdAt": now,
    }));
    array_mut(state, "auditEvents")?.push(json!({
        "id": format!("{command_id}:audit"),
        "eventType": "purchase_received",
        "entityType": "inventory_lot",
        "entityId": lot_id,
        "payload": { "purchaseId": purchase_id, "amount": amount, "unit": unit, "commandId": command_id },
        "createdAt": now,
    }));
    Ok(CommandMutation {
        applied: true,
        result: json!({ "lotId": lot_id }),
    })
}

fn adjust_inventory(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let lot_id = payload_str(payload, "lotId")?.to_owned();
    let remaining_amount = payload_number(payload, "remainingAmount")?;
    if remaining_amount < 0.0 {
        return Err("盘点后的库存不能小于 0。".into());
    }
    let reason = payload_str(payload, "reason")?.to_owned();
    let lot_index = array(state, "inventory")?
        .iter()
        .position(|value| value.get("id").and_then(Value::as_str) == Some(&lot_id))
        .ok_or_else(|| "找不到库存批次。".to_string())?;
    let current = array(state, "inventory")?[lot_index]
        .get("remainingAmount")
        .and_then(Value::as_f64)
        .ok_or_else(|| "库存余量无效。".to_string())?;
    let delta = round_ratio(remaining_amount - current);
    let (now, _) = now_and_date();
    array_mut(state, "inventory")?[lot_index]
        .as_object_mut()
        .ok_or_else(|| "库存批次格式无效。".to_string())?
        .insert(
            "remainingAmount".into(),
            json!(round_ratio(remaining_amount)),
        );
    array_mut(state, "inventoryMovements")?.push(json!({
        "id": format!("{command_id}:movement"),
        "lotId": lot_id,
        "type": "adjustment",
        "amount": delta,
        "reason": reason,
        "createdAt": now,
    }));
    array_mut(state, "auditEvents")?.push(json!({
        "id": format!("{command_id}:audit"),
        "eventType": "inventory_adjusted",
        "entityType": "inventory_lot",
        "entityId": lot_id,
        "payload": { "previousAmount": current, "remainingAmount": remaining_amount, "delta": delta, "reason": reason, "commandId": command_id },
        "createdAt": now,
    }));
    Ok(CommandMutation {
        applied: true,
        result: json!({}),
    })
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
        "prepare_recipe"
            | "consume_batch"
            | "discard_batch"
            | "receive_purchase"
            | "adjust_inventory"
    ) {
        return Err("未知的领域命令。".into());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始领域命令事务：{error}"))?;
    let receipt: Option<(String, String, i64)> = transaction
        .query_row(
            "SELECT command_kind, result_json, applied_revision FROM domain_command_receipts WHERE command_id = ?1",
            [&request.command_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some((stored_kind, stored_result, applied_revision)) = receipt {
        if stored_kind != request.kind {
            return Err("同一 commandId 不能用于不同命令。".into());
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
        "prepare_recipe" => prepare_recipe(&mut state, &request.payload, &request.command_id)?,
        "consume_batch" => consume_batch(&mut state, &request.payload, &request.command_id)?,
        "discard_batch" => discard_batch(&mut state, &request.payload, &request.command_id)?,
        "receive_purchase" => receive_purchase(&mut state, &request.payload, &request.command_id)?,
        "adjust_inventory" => adjust_inventory(&mut state, &request.payload, &request.command_id)?,
        _ => unreachable!(),
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
                {"id":"lot-late-open","foodId":"tofu","remainingAmount":200,"opened":true,"expiresAt":"2026-10-25","purchasedAt":"2026-10-10"},
                {"id":"lot-early","foodId":"tofu","remainingAmount":200,"opened":false,"expiresAt":"2026-10-21","purchasedAt":"2026-10-11"}
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
