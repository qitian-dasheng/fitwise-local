use crate::domain_commands::{
    array, array_mut, now_and_date, payload_number, payload_str, CommandMutation,
};
use serde_json::{json, Map, Value};

fn active(value: &Value) -> bool {
    value["status"].as_str().is_none_or(|v| v == "active")
}
fn round(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let id = payload_str(payload, "mealId")?;
    let reason = payload_str(payload, "reason")?.trim();
    if reason.chars().count() > 500 {
        return Err("修改原因最多 500 字。".into());
    }
    let index = array(state, "meals")?
        .iter()
        .position(|v| v["id"] == id)
        .ok_or("餐食不存在。")?;
    let old = array(state, "meals")?[index].clone();
    if !active(&old) {
        return Err("这条餐食已修订或作废，请刷新后操作最新记录。".into());
    }
    let void = kind == "void_meal";
    let (now, today) = now_and_date();
    let new_id = format!("{command_id}:meal");
    let mut next = old.clone();
    let new_date = if void {
        old["date"].as_str().ok_or("旧餐食日期缺失。")?.to_owned()
    } else {
        crate::record_commands::date(payload)?
    };
    if !void && new_date > today {
        return Err("实际进食日期不能晚于今天。".into());
    }
    if !void {
        let meal_type = payload_str(payload, "type")?;
        if !["breakfast", "lunch", "dinner", "snack"].contains(&meal_type) {
            return Err("餐次无效。".into());
        }
        next["id"] = json!(new_id);
        next["date"] = json!(new_date);
        next["type"] = json!(meal_type);
        next["status"] = json!("active");
        next["supersedesId"] = json!(id);
        next["createdAt"] = json!(now);
        next["correctedAt"] = json!(now);
        next["correctionReason"] = json!(reason);
        if let Some(map) = next.as_object_mut() {
            map.remove("supersededBy");
        }
    }
    let mut changed_batch = Value::Null;
    if let Some(batch_id) = old["preparedBatchId"].as_str() {
        let batch_index = array(state, "batches")?
            .iter()
            .position(|v| v["id"] == batch_id)
            .ok_or("熟食批次缺失，不能孤立修改日记。")?;
        let batch = array(state, "batches")?[batch_index].clone();
        crate::batch_corrections::validate_balance(state, &batch)?;
        if new_date.as_str() < batch["date"].as_str().ok_or("制作日期缺失。")? {
            return Err("进食日期不能早于制作日。".into());
        }
        let event_id = old["consumptionEventId"]
            .as_str()
            .ok_or("进食事件缺失，不能单独改日记。")?;
        let event_index = array(state, "consumptionEvents")?
            .iter()
            .position(|v| v["id"] == event_id && active(v))
            .ok_or("关联进食事件不存在或已失效。")?;
        let old_ratio = old["consumedRatio"].as_f64().ok_or("旧比例缺失。")?;
        let event = array(state, "consumptionEvents")?[event_index].clone();
        if event["batchId"] != batch_id
            || event["date"] != old["date"]
            || event["mealType"] != old["type"]
            || (event["ratio"].as_f64().unwrap_or(-1.0) - old_ratio).abs() > 1e-8
        {
            return Err("日记与进食事件不一致，请停止并核对。".into());
        }
        let ratio = if void {
            0.0
        } else {
            payload_number(payload, "ratio")?
        };
        if !void && (ratio <= 0.0 || ratio > 1.0 || (round(ratio) - ratio).abs() > 1e-8) {
            return Err("比例须大于 0、不超过 100%，最多百分比两位小数。".into());
        }
        let consumed = batch["consumedRatio"].as_f64().ok_or("批次比例缺失。")?;
        let remaining = batch["remainingRatio"].as_f64().ok_or("批次余量缺失。")?;
        let wasted = batch["wastedRatio"].as_f64().ok_or("浪费比例缺失。")?;
        let active_consumed: f64 = array(state, "consumptionEvents")?
            .iter()
            .filter(|e| e["batchId"] == batch_id && active(e))
            .map(|e| e["ratio"].as_f64().unwrap_or(f64::NAN))
            .sum();
        if !active_consumed.is_finite() || (active_consumed - consumed).abs() > 1e-6 {
            return Err("批次总量与有效进食事件不一致，请停止并核对。".into());
        }
        if (consumed + remaining + wasted - 1.0).abs() > 1e-6 || consumed + 1e-8 < old_ratio {
            return Err("熟食比例不守恒，不能继续修改。".into());
        }
        let next_remaining = round(remaining + old_ratio - ratio);
        if next_remaining < -1e-8 {
            return Err("修改后的进食超过当前可分配余量，不能占用已丢弃或其他餐食的比例。".into());
        }
        let b = &mut array_mut(state, "batches")?[batch_index];
        b["consumedRatio"] = json!(round(consumed - old_ratio + ratio));
        b["remainingRatio"] = json!(next_remaining.max(0.0));
        b["status"] = json!(if next_remaining > 0.0 {
            "open"
        } else {
            "closed"
        });
        if next_remaining > 0.0 {
            b.as_object_mut().ok_or("批次无效。")?.remove("closedAt");
        } else {
            b["closedAt"] = json!(now);
        }
        changed_batch = b.clone();
        array_mut(state, "consumptionEvents")?[event_index]["status"] =
            json!(if void { "void" } else { "superseded" });
        if !void {
            let new_event_id = format!("{command_id}:consumption");
            array_mut(state,"consumptionEvents")?.push(json!({"id":new_event_id,"batchId":batch_id,"date":new_date,"mealType":next["type"],"ratio":ratio,"ratioIsEstimated":old["confidence"] != "high","status":"active","supersedesId":event_id,"createdAt":now}));
            next["consumptionEventId"] = json!(new_event_id);
            next["consumedRatio"] = json!(ratio);
            next["amountLabel"] = json!(format!(
                "整锅的 {}%（已纠错）",
                (ratio * 10000.0).round() / 100.0
            ));
        }
    } else if !void {
        if let Some(version_id) = old["foodVersionId"].as_str() {
            if old["foodSnapshot"]["version"]["id"] != version_id {
                return Err("原餐食营养快照缺失或不一致，不能自动修订。".into());
            }
            let quantity = payload_number(payload, "quantity")?;
            let unit = payload_str(payload, "unit")?;
            let snapshot =
                crate::food_library::historical_portion(state, version_id, quantity, unit)?;
            next["nutrition"] = snapshot["nutrition"].clone();
            next["consumedRatio"] = json!(1);
            // Preserve the original identity metadata as well as the fixed nutrient version.
            let mut fixed_snapshot = old["foodSnapshot"].clone();
            for key in ["quantity", "unit", "factor", "basisQuantity"] {
                fixed_snapshot[key] = snapshot[key].clone();
            }
            next["foodSnapshot"] = fixed_snapshot;
            next["amountLabel"] = json!(format!("{quantity} {unit} · 已纠错（沿用原营养版本）"));
        } else {
            let name = payload_str(payload, "name")?.trim();
            let amount = payload_str(payload, "amountLabel")?.trim();
            if name.chars().count() > 160 || amount.chars().count() > 300 {
                return Err("名称或份量说明过长。".into());
            }
            let values = payload["nutrients"]
                .as_object()
                .ok_or("请核对营养值；空白保持未知。")?;
            let mut nutrition = Map::new();
            for key in [
                "calories",
                "protein",
                "fat",
                "carbohydrates",
                "fiber",
                "sugar",
                "sodium",
            ] {
                let value = match values.get(key) {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(
                        v.as_f64()
                            .filter(|n| n.is_finite() && *n >= 0.0)
                            .ok_or("营养值须为非负有限数值。")?,
                    ),
                };
                let unit = if key == "calories" {
                    "kcal"
                } else if key == "sodium" {
                    "mg"
                } else {
                    "g"
                };
                let mut metric = json!({"state":if value==Some(0.0){"zero"}else if value.is_some(){"known"}else{"unknown"},"unit":unit,"source":"manual","confidence":if value.is_some(){"high"}else{"low"}});
                if let Some(value) = value {
                    metric["value"] = json!(value);
                }
                nutrition.insert(key.into(), metric);
            }
            next["name"] = json!(name);
            next["amountLabel"] = json!(amount);
            next["nutrition"] = Value::Object(nutrition);
            next["consumedRatio"] = json!(1);
            next["source"] = json!("manual");
        }
    }
    let current = &mut array_mut(state, "meals")?[index];
    current["status"] = json!(if void { "void" } else { "superseded" });
    current["correctedAt"] = json!(now);
    current["correctionReason"] = json!(reason);
    if !void {
        current["supersededBy"] = json!(new_id);
        array_mut(state, "meals")?.push(next.clone());
    }
    for check in array_mut(state, "checkIns")? {
        if check["date"] == old["date"] || check["date"] == new_date {
            check["complete"] = json!(false);
            check
                .as_object_mut()
                .ok_or("每日状态无效。")?
                .remove("completedAt");
        }
    }
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:audit"),"eventType":kind,"entityType":"meal","entityId":id,"createdAt":now,"payload":{"reason":reason,"before":old,"after":if void{Value::Null}else{next},"batchAfter":changed_batch,"commandId":command_id}}));
    Ok(CommandMutation {
        applied: true,
        result: json!({"mealId":if void{Value::Null}else{json!(new_id)},"date":new_date}),
    })
}
