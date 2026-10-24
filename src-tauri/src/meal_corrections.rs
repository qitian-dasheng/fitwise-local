use crate::domain_commands::{
    array, array_mut, now_and_date, payload_number, payload_str, CommandMutation,
};
use serde_json::{json, Map, Value};

fn active(value: &Value) -> bool {
    value["status"].as_str().is_none_or(|v| v == "active")
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
    if !void {
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
            // OBS-011：纠错文案的单位走食材库映射，历史 "50 g" 英文写法不再产生新记录。
            let unit_label = serde_json::from_value::<crate::food_library::FoodUnit>(json!(unit))
                .map(|unit| unit.label())
                .unwrap_or(unit);
            next["amountLabel"] = json!(format!("{quantity} {unit_label} · 已纠错（沿用原营养版本）"));
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
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:audit"),"eventType":kind,"entityType":"meal","entityId":id,"createdAt":now,"payload":{"reason":reason,"before":old,"after":if void{Value::Null}else{next},"commandId":command_id}}));
    Ok(CommandMutation {
        applied: true,
        result: json!({"mealId":if void{Value::Null}else{json!(new_id)},"date":new_date}),
    })
}
