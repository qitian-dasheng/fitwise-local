use crate::domain_commands::{
    array, array_mut, now_and_date, payload_number, payload_str, CommandMutation,
};
use chrono::NaiveDate;
use serde_json::{json, Map, Value};

fn optional_number(payload: &Value, key: &str) -> Result<Option<f64>, String> {
    match payload.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => payload_number(payload, key).map(Some),
    }
}

pub(crate) fn date(payload: &Value) -> Result<String, String> {
    let value = payload
        .get("date")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| now_and_date().1);
    if value.len() != 10 || NaiveDate::parse_from_str(&value, "%Y-%m-%d").is_err() {
        return Err("日期必须为有效的 YYYY-MM-DD。".into());
    }
    Ok(value)
}

fn choice<'a>(payload: &'a Value, key: &str, choices: &[&str]) -> Result<&'a str, String> {
    let value = payload_str(payload, key)?;
    choices
        .contains(&value)
        .then_some(value)
        .ok_or_else(|| format!("{key} 选项无效。"))
}

fn positive(payload: &Value, key: &str) -> Result<f64, String> {
    let value = payload_number(payload, key)?;
    if value <= 0.0 {
        return Err(format!("{key} 必须大于 0。"));
    }
    Ok(value)
}

fn nonnegative(payload: &Value, key: &str) -> Result<f64, String> {
    let value = payload_number(payload, key)?;
    if value < 0.0 {
        return Err(format!("{key} 不能小于 0。"));
    }
    Ok(value)
}

fn nutrient(value: Option<f64>, unit: &str) -> Value {
    match value {
        Some(value) => {
            json!({"state": if value == 0.0 {"zero"} else {"known"}, "value":value, "unit":unit, "source":"manual", "confidence":"high"})
        }
        None => json!({"state":"unknown", "unit":unit, "source":"manual", "confidence":"low"}),
    }
}

pub(crate) fn audit(
    state: &mut Map<String, Value>,
    command_id: &str,
    event_type: &str,
    entity_type: &str,
    entity_id: &str,
    payload: Value,
) -> Result<(), String> {
    let (now, _) = now_and_date();
    array_mut(state, "auditEvents")?.push(json!({
        "id":format!("{command_id}:audit"), "eventType":event_type, "entityType":entity_type,
        "entityId":entity_id, "payload":{"commandId":command_id,"details":payload}, "createdAt":now,
    }));
    Ok(())
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, _) = now_and_date();
    let id = format!("{kind}-{command_id}");
    let result = json!({});
    match kind {
        "add_meal" => {
            let name = payload_str(payload, "name")?;
            let meal_type = choice(payload, "type", &["breakfast", "lunch", "dinner", "snack"])?;
            let amount_label = payload_str(payload, "amountLabel")?;
            let calories = nonnegative(payload, "calories")?;
            let protein = nonnegative(payload, "protein")?;
            let fiber = optional_number(payload, "fiber")?;
            if fiber.is_some_and(|value| value < 0.0) {
                return Err("纤维不能小于 0。".into());
            }
            // 手工记餐可选补齐其余营养：缺省保持 unknown，不能当成 0。
            let carbohydrates = optional_number(payload, "carbohydrates")?;
            let fat = optional_number(payload, "fat")?;
            let sugar = optional_number(payload, "sugar")?;
            let sodium = optional_number(payload, "sodium")?;
            for (label, value) in [
                ("碳水化合物", carbohydrates),
                ("脂肪", fat),
                ("糖", sugar),
                ("钠", sodium),
            ] {
                if value.is_some_and(|number| number < 0.0) {
                    return Err(format!("{label}不能小于 0。"));
                }
            }
            let date = date(payload)?;
            array_mut(state, "meals")?.push(json!({
                "id":id,"date":date,"type":meal_type,"name":name,"amountLabel":amount_label,
                "nutrition":{
                    "calories":nutrient(Some(calories),"kcal"),"protein":nutrient(Some(protein),"g"),
                    "fiber":nutrient(fiber,"g"),
                    "carbohydrates":nutrient(carbohydrates,"g"),
                    "fat":nutrient(fat,"g"),
                    "sugar":nutrient(sugar,"g"),
                    "sodium":nutrient(sodium,"mg")
                },"consumedRatio":1,"source":"manual","confidence":"high","createdAt":now,
            }));
            audit(
                state,
                command_id,
                "meal_created",
                "meal",
                &id,
                json!({"date":date}),
            )?;
        }
        "add_workout" => {
            let date = date(payload)?;
            let name = payload_str(payload, "name")?;
            let workout_type = payload_str(payload, "type")?;
            let duration = positive(payload, "durationMinutes")?;
            if duration > 1440.0 {
                return Err("运动时长不能超过一天。".into());
            }
            let fingerprint = payload
                .get("sourceFingerprint")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty());
            if fingerprint.is_some_and(|value| {
                array(state, "workouts")
                    .is_ok_and(|items| items.iter().any(|item| item["sourceFingerprint"] == value))
            }) {
                return Ok(CommandMutation {
                    applied: false,
                    result: json!({"duplicate":true}),
                });
            }
            let mut workout = json!({"id":id,"date":date,"name":name,"type":workout_type,"durationMinutes":duration,"createdAt":now});
            for key in ["caloriesKcal", "load", "averageHeartRate", "maxHeartRate"] {
                if let Some(value) = optional_number(payload, key)? {
                    if value < 0.0 {
                        return Err(format!("{key} 不能小于 0。"));
                    }
                    workout[key] = json!(value);
                }
            }
            if let (Some(average), Some(maximum)) = (
                optional_number(payload, "averageHeartRate")?,
                optional_number(payload, "maxHeartRate")?,
            ) {
                if average > maximum {
                    return Err("平均心率不能高于最高心率。".into());
                }
            }
            if let Some(value) = fingerprint {
                workout["sourceFingerprint"] = json!(value);
            }
            array_mut(state, "workouts")?.push(workout);
            audit(
                state,
                command_id,
                "workout_created",
                "workout_session",
                &id,
                json!({"date":date}),
            )?;
        }
        "set_checkin" | "set_day_complete" => {
            let date = date(payload)?;
            let index = array(state, "checkIns")?
                .iter()
                .position(|item| item["date"] == date);
            let mut checkin = index
                .map(|index| state["checkIns"][index].clone())
                .unwrap_or_else(|| json!({"date":date,"complete":false}));
            if kind == "set_day_complete" {
                let complete = payload
                    .get("complete")
                    .and_then(Value::as_bool)
                    .ok_or("完成状态必须明确指定。")?;
                checkin["complete"] = json!(complete);
                if complete {
                    checkin["completedAt"] = json!(now);
                } else {
                    checkin
                        .as_object_mut()
                        .ok_or("打卡格式无效。")?
                        .remove("completedAt");
                }
            } else {
                for key in ["hunger", "energy"] {
                    if let Some(value) = optional_number(payload, key)? {
                        if !(1.0..=5.0).contains(&value) || value.fract() != 0.0 {
                            return Err("主观评分必须是 1–5 的整数。".into());
                        }
                        checkin[key] = json!(value);
                    }
                }
            }
            if let Some(index) = index {
                array_mut(state, "checkIns")?[index] = checkin;
            } else {
                array_mut(state, "checkIns")?.push(checkin);
            }
            audit(
                state,
                command_id,
                kind,
                "daily_checkin",
                &date,
                payload.clone(),
            )?;
        }
        "add_purchase" => {
            return crate::inventory_ops::apply(state, kind, payload, command_id);
        }
        "select_plan" => {
            let plan_id = payload_str(payload, "planId")?;
            let selected = array(state, "plans")?
                .iter()
                .find(|item| item["id"] == plan_id)
                .ok_or("找不到菜单候选。")?;
            if selected["inventoryCoverage"].as_f64().unwrap_or(0.0) < 100.0
                || selected["missingIngredients"]
                    .as_array()
                    .is_none_or(|items| !items.is_empty())
            {
                return Err("当前候选仍缺食材，实际收货并重新校验后才能确认。".into());
            }
            let selected_date = selected["date"].clone();
            let recipe_id = selected
                .get("recipeVersionId")
                .and_then(Value::as_str)
                .ok_or("候选尚未关联完整菜谱，暂不能确认。")?;
            let mut probe = state.clone();
            let validation = crate::domain_commands::prepare_recipe(
                &mut probe,
                &json!({"recipeVersionId":recipe_id}),
                "validation-only",
            )?;
            if !validation.applied {
                return Err(format!("库存校验未通过：{}", validation.result["shortage"]));
            }
            for plan in array_mut(state, "plans")? {
                if plan["id"] == plan_id {
                    plan["status"] = json!("selected");
                } else if plan["date"] == selected_date && plan["status"] == "selected" {
                    plan["status"] = json!("candidate");
                }
            }
            audit(
                state,
                command_id,
                "meal_plan_selected",
                "meal_plan",
                plan_id,
                json!({}),
            )?;
        }
        "add_inbox_item" => {
            let kind = choice(payload, "kind", &["image", "text", "link"])?;
            let title = payload_str(payload, "title")?;
            let preview = payload_str(payload, "preview")?;
            let fingerprint = payload
                .get("fingerprint")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty());
            if fingerprint.is_some_and(|value| {
                array(state, "inbox")
                    .is_ok_and(|items| items.iter().any(|item| item["fingerprint"] == value))
            }) {
                return Ok(CommandMutation {
                    applied: false,
                    result: json!({"duplicate":true}),
                });
            }
            let mut item = json!({"id":id,"kind":kind,"title":title,"preview":preview,"receivedAt":now,"status":"unreviewed"});
            for key in ["artifactPath", "fingerprint"] {
                if let Some(value) = payload
                    .get(key)
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    item[key] = json!(value);
                }
            }
            array_mut(state, "inbox")?.push(item);
            audit(
                state,
                command_id,
                "inbox_item_created",
                "input_artifact",
                &id,
                json!({"kind":kind}),
            )?;
        }
        "set_inbox_status" => {
            let item_id = payload_str(payload, "id")?;
            let status = choice(payload, "status", &["unreviewed", "drafted", "discarded"])?;
            let item = array_mut(state, "inbox")?
                .iter_mut()
                .find(|item| item["id"] == item_id)
                .ok_or("找不到收件箱项目。")?;
            item["status"] = json!(status);
            audit(
                state,
                command_id,
                "inbox_status_changed",
                "input_artifact",
                item_id,
                json!({"status":status}),
            )?;
        }
        "set_ai_settings" => {
            let settings = state
                .get_mut("aiSettings")
                .and_then(Value::as_object_mut)
                .ok_or("AI 配置格式无效。")?;
            let input = payload.as_object().ok_or("AI 配置格式无效。")?;
            for (key, value) in input {
                match key.as_str() {
                    "provider" => {
                        choice(payload, key, &["openai", "deepseek", "openai-compatible"])?;
                    }
                    "baseUrl" | "model" => {
                        payload_str(payload, key)?;
                        if key == "baseUrl" {
                            let url = tauri::Url::parse(payload_str(payload, key)?)
                                .map_err(|_| "AI 接口地址无效。")?;
                            let local = matches!(
                                url.host_str(),
                                Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
                            );
                            if !(url.scheme() == "https" || (url.scheme() == "http" && local))
                                || !url.username().is_empty()
                                || url.password().is_some()
                            {
                                return Err(
                                    "AI 接口只允许 HTTPS 或本机 HTTP，且不能在地址中携带凭据。"
                                        .into(),
                                );
                            }
                        }
                    }
                    "cloudEnabled" => {
                        value.as_bool().ok_or("云端开关无效。")?;
                    }
                    "monthlyLimitCny" => {
                        if !value.is_null() {
                            nonnegative(payload, key)?;
                        }
                    }
                    _ => return Err("此命令不允许修改费用统计。".into()),
                }
                if key == "monthlyLimitCny" && value.is_null() {
                    settings.remove(key);
                } else {
                    settings.insert(key.clone(), value.clone());
                }
            }
            audit(
                state,
                command_id,
                "ai_settings_updated",
                "ai_settings",
                "default",
                json!({}),
            )?;
        }
        "record_ai_usage" => {
            let cost = nonnegative(payload, "estimatedCostCny")?;
            let month = now_and_date().1[..7].to_owned();
            let settings = state
                .get_mut("aiSettings")
                .and_then(Value::as_object_mut)
                .ok_or("AI 配置格式无效。")?;
            let previous = if settings.get("usageMonth").and_then(Value::as_str) == Some(&month) {
                settings
                    .get("estimatedSpendCny")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
            } else {
                0.0
            };
            settings.insert("usageMonth".into(), json!(month));
            settings.insert("estimatedSpendCny".into(), json!(previous + cost));
            audit(
                state,
                command_id,
                "ai_usage_recorded",
                "ai_settings",
                "default",
                json!({"estimatedCostCny":cost}),
            )?;
        }
        _ => return Err("未知的领域命令。".into()),
    }
    Ok(CommandMutation {
        applied: true,
        result,
    })
}
