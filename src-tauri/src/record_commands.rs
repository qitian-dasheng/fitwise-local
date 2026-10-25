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

/// 有效餐食白名单：缺失 status 或显式 active。禁止写成「不等于 superseded」。
fn meal_is_active(entry: &Value) -> bool {
    matches!(entry["status"].as_str(), None | Some("active"))
}

fn meal_label(meal_type: &str) -> &'static str {
    match meal_type {
        "breakfast" => "早餐",
        "lunch" => "午餐",
        "dinner" => "晚餐",
        _ => "加餐",
    }
}

/// 照搬时只认「目标日期之前、同餐次、仍然有效」的记录，取最近的一天。
fn latest_meal_source(meals: &[Value], meal_type: &str, before: &str) -> Result<String, String> {
    meals
        .iter()
        .filter(|entry| entry["type"].as_str() == Some(meal_type) && meal_is_active(entry))
        .filter_map(|entry| entry["date"].as_str())
        .filter(|date| *date < before)
        .max()
        .map(str::to_string)
        .ok_or_else(|| format!("之前还没有{}记录，先记一次再照搬。", meal_label(meal_type)))
}

/// 复制一条餐食：保留名称/份量/营养/食材版本快照，换掉身份与日期，
/// 丢掉「属于来源那一天那口锅」的批次与消耗事件，也丢掉旧行的修订链。
pub(crate) fn copy_entry(
    entry: &Value,
    new_id: &str,
    date: &str,
    now: &str,
) -> Result<Value, String> {
    let mut copy = entry.clone();
    let object = copy.as_object_mut().ok_or("餐食记录格式无效。")?;
    object.insert("id".into(), json!(new_id));
    object.insert("date".into(), json!(date));
    object.insert("status".into(), json!("active"));
    object.insert("createdAt".into(), json!(now));
    object.insert("copiedFromId".into(), json!(entry["id"]));
    for key in [
        "supersedesId",
        "supersededBy",
        "correctedAt",
        "correctionReason",
        // 批次与消耗事件属于来源那一天的那口锅，抄过来会指向不存在的制作记录。
        "preparedBatchId",
        "consumptionEventId",
    ] {
        object.remove(key);
    }
    Ok(copy)
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
        // 照搬上次：把之前某天同一餐次的记录整组复制到今天。
        // 只复制快照（名称、份量、营养、食材版本），批次与消耗事件属于那一天的锅，不跟过来。
        "copy_meal" => {
            let date = date(payload)?;
            let meal_type = choice(payload, "type", &["breakfast", "lunch", "dinner", "snack"])?;
            let (_, today) = now_and_date();
            if date > today {
                return Err("不能照搬到未来的日期。".into());
            }

            let (source_date, source_entries) = {
                let meals = array(state, "meals")?;
                // 目标餐次必须还空着：已有记录时静默追加会变成重复计热量。
                if meals.iter().any(|entry| {
                    entry["date"].as_str() == Some(date.as_str())
                        && entry["type"].as_str() == Some(meal_type)
                        && meal_is_active(entry)
                }) {
                    return Err(format!(
                        "{}已有记录，先编辑或作废再照搬。",
                        meal_label(meal_type)
                    ));
                }
                let source_date = match payload.get("sourceDate").and_then(Value::as_str) {
                    Some(raw) => {
                        if raw.len() != 10 || NaiveDate::parse_from_str(raw, "%Y-%m-%d").is_err() {
                            return Err("来源日期必须为有效的 YYYY-MM-DD。".into());
                        }
                        raw.to_string()
                    }
                    None => latest_meal_source(meals, meal_type, &date)?,
                };
                let entries: Vec<Value> = meals
                    .iter()
                    .filter(|entry| {
                        entry["date"].as_str() == Some(source_date.as_str())
                            && entry["type"].as_str() == Some(meal_type)
                            && meal_is_active(entry)
                    })
                    .cloned()
                    .collect();
                if entries.is_empty() {
                    return Err(format!("{source_date} 没有{}记录。", meal_label(meal_type)));
                }
                (source_date, entries)
            };

            let mut created: Vec<String> = Vec::with_capacity(source_entries.len());
            for (index, entry) in source_entries.iter().enumerate() {
                let new_id = format!("{id}-{index}");
                let copy = copy_entry(entry, &new_id, &date, &now)?;
                array_mut(state, "meals")?.push(copy);
                created.push(new_id);
            }

            audit(
                state,
                command_id,
                "meals_copied",
                "meal",
                &format!("{date}:{meal_type}"),
                json!({
                    "date":&date, "type":meal_type, "sourceDate":&source_date,
                    "count":created.len(), "entryIds":&created,
                }),
            )?;
            return Ok(CommandMutation {
                applied: true,
                result: json!({
                    "date":&date, "type":meal_type, "sourceDate":&source_date,
                    "count":created.len(), "entryIds":&created,
                }),
            });
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
        // 目标是「当前有效配置」，不是历史事实：直接更新 profile 单例，
        // 旧值完整进审计事件；趋势与达标判定始终用当前目标计算，不做回溯重算。
        "set_target_profile" => {
            let daily = payload
                .get("dailyCalories")
                .and_then(Value::as_object)
                .ok_or("命令缺少 dailyCalories。")?;
            let min = daily
                .get("min")
                .and_then(Value::as_f64)
                .ok_or("热量区间缺少 min。")?;
            let target = daily
                .get("target")
                .and_then(Value::as_f64)
                .ok_or("热量区间缺少 target。")?;
            let max = daily
                .get("max")
                .and_then(Value::as_f64)
                .ok_or("热量区间缺少 max。")?;
            for (label, value) in [("热量下限", min), ("热量目标", target), ("热量上限", max)]
            {
                if !value.is_finite() || !(500.0..=8000.0).contains(&value) {
                    return Err(format!("{label}需在 500–8000 kcal 之间。"));
                }
            }
            if !(min <= target && target <= max) {
                return Err("热量区间需满足：下限 ≤ 目标 ≤ 上限。".into());
            }
            let protein = payload_number(payload, "proteinTargetG")?;
            if !(1.0..=500.0).contains(&protein) {
                return Err("蛋白质目标需在 1–500 g 之间。".into());
            }
            let fiber = payload_number(payload, "fiberTargetG")?;
            if !(0.0..=200.0).contains(&fiber) {
                return Err("纤维目标需在 0–200 g 之间。".into());
            }
            let weight = payload_number(payload, "targetWeightKg")?;
            if !(20.0..=400.0).contains(&weight) {
                return Err("目标体重需在 20–400 kg 之间。".into());
            }
            if (weight * 100.0 - (weight * 100.0).round()).abs() > 1e-6 {
                return Err("目标体重最多保留两位小数。".into());
            }
            let before = {
                let profile = state
                    .get("profile")
                    .and_then(Value::as_object)
                    .ok_or("领域状态缺少 profile 单例。")?;
                json!({
                    "dailyCalories": profile.get("dailyCalories"),
                    "proteinTargetG": profile.get("proteinTargetG"),
                    "fiberTargetG": profile.get("fiberTargetG"),
                    "targetWeightKg": profile.get("targetWeightKg"),
                })
            };
            {
                let profile = state
                    .get_mut("profile")
                    .and_then(Value::as_object_mut)
                    .ok_or("领域状态缺少 profile 单例。")?;
                profile.insert(
                    "dailyCalories".into(),
                    json!({"min": min, "target": target, "max": max}),
                );
                profile.insert("proteinTargetG".into(), json!(protein));
                profile.insert("fiberTargetG".into(), json!(fiber));
                profile.insert("targetWeightKg".into(), json!(weight));
            }
            let after = json!({
                "dailyCalories": {"min": min, "target": target, "max": max},
                "proteinTargetG": protein, "fiberTargetG": fiber, "targetWeightKg": weight,
            });
            audit(
                state,
                command_id,
                "target_profile_updated",
                "profile",
                "profile",
                json!({"before": before, "after": after}),
            )?;
            return Ok(CommandMutation {
                applied: true,
                result: json!({"profile": state["profile"].clone()}),
            });
        }
        _ => return Err("未知的领域命令。".into()),
    }
    Ok(CommandMutation {
        applied: true,
        result,
    })
}
