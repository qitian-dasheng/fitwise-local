//! 运动记录：支持更正与作废。
//!
//! 与 `body_commands` / `meal_corrections` 同一套口径：旧行留证（superseded / void），
//! 新行 active，改动都必须写原因并落审计事件。
//!
//! 与体重不同的是，运动没有「同日代表值」概念：一天练两次就是两条互相独立的事实，
//! 只有明确改错或作废时才需要留证。

use crate::domain_commands::{array, array_mut, now_and_date, CommandMutation};
use crate::record_commands::{audit, date as payload_date};
use chrono::DateTime;
use serde_json::{json, Map, Value};

const DURATION_MAX_MINUTES: f64 = 1440.0;
const CALORIES_MAX: f64 = 5000.0;
const LOAD_MAX: f64 = 1000.0;
const HEART_MIN: f64 = 30.0;
const HEART_MAX: f64 = 250.0;
const NAME_LIMIT: usize = 80;
const TYPE_LIMIT: usize = 40;
const TEXT_LIMIT: usize = 200;

/// 有效记录白名单：缺失 status 或显式 active。禁止写成「不等于 superseded」。
fn is_active(item: &Value) -> bool {
    matches!(item["status"].as_str(), None | Some("active"))
}

fn timestamp(item: &Value) -> i64 {
    item["createdAt"]
        .as_str()
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|value| value.timestamp())
        .unwrap_or(0)
}

fn order_key(item: &Value) -> (String, i64, String) {
    (
        item["date"].as_str().unwrap_or_default().to_string(),
        timestamp(item),
        item["id"].as_str().unwrap_or_default().to_string(),
    )
}

fn sort_workouts(state: &mut Map<String, Value>) -> Result<(), String> {
    array_mut(state, "workouts")?.sort_by_key(order_key);
    Ok(())
}

/// 缺省与显式 null 都当「没填」，与 `record_commands::optional_number` 同义。
fn optional_number(payload: &Value, key: &str) -> Result<Option<f64>, String> {
    match payload.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => crate::domain_commands::payload_number(payload, key).map(Some),
    }
}

fn parse_duration(payload: &Value) -> Result<f64, String> {
    let value = crate::domain_commands::payload_number(payload, "durationMinutes")?;
    if !(1.0..=DURATION_MAX_MINUTES).contains(&value) {
        return Err("运动时长需在 1–1440 分钟之间。".into());
    }
    if (value - value.round()).abs() > 1e-6 {
        return Err("运动时长按整分钟记录。".into());
    }
    Ok(value.round())
}

fn parse_calories(payload: &Value) -> Result<Option<f64>, String> {
    let Some(value) = optional_number(payload, "caloriesKcal")? else {
        return Ok(None);
    };
    if !(0.0..=CALORIES_MAX).contains(&value) {
        return Err(format!("运动消耗需在 0–{CALORIES_MAX:.0} kcal 之间。"));
    }
    Ok(Some(value.round()))
}

fn parse_load(payload: &Value) -> Result<Option<f64>, String> {
    let Some(value) = optional_number(payload, "load")? else {
        return Ok(None);
    };
    if !(0.0..=LOAD_MAX).contains(&value) {
        return Err(format!("运动负荷需在 0–{LOAD_MAX:.0} 之间。"));
    }
    Ok(Some(value))
}

fn parse_heart(payload: &Value, key: &str, label: &str) -> Result<Option<f64>, String> {
    let Some(value) = optional_number(payload, key)? else {
        return Ok(None);
    };
    if !(HEART_MIN..=HEART_MAX).contains(&value) {
        return Err(format!(
            "{label}需在 {HEART_MIN:.0}–{HEART_MAX:.0} 次/分之间；没有测量请留空。"
        ));
    }
    Ok(Some(value.round()))
}

fn parse_name(payload: &Value) -> Result<String, String> {
    // 自己取值而不是用 payload_str：后者会返回「命令缺少 name。」，
    // 那是给开发看的内部分键名，不该出现在用户界面。
    let value = payload
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if value.is_empty() {
        return Err("请填写课程或训练名称。".into());
    }
    if value.chars().count() > NAME_LIMIT {
        return Err(format!("训练名称不能超过 {NAME_LIMIT} 字。"));
    }
    Ok(value.to_string())
}

fn parse_type(payload: &Value) -> Result<String, String> {
    let value = payload
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if value.is_empty() {
        return Err("请填写运动类型。".into());
    }
    if value.chars().count() > TYPE_LIMIT {
        return Err(format!("运动类型不能超过 {TYPE_LIMIT} 字。"));
    }
    Ok(value.to_string())
}

fn ensure_not_future(date: &str, today: &str) -> Result<(), String> {
    if date > today {
        return Err("运动日期不能晚于今天。".into());
    }
    Ok(())
}

fn require_workout_id(payload: &Value) -> Result<String, String> {
    payload
        .get("workoutId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "找不到这条运动记录。".to_string())
}

fn require_reason(payload: &Value) -> Result<String, String> {
    let Some(raw) = payload.get("reason").and_then(Value::as_str) else {
        return Err("请填写修改原因。".into());
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请填写修改原因。".into());
    }
    if trimmed.chars().count() > TEXT_LIMIT {
        return Err(format!("原因不能超过 {TEXT_LIMIT} 字。"));
    }
    Ok(trimmed.to_string())
}

fn find_workout(state: &Map<String, Value>, id: &str) -> Result<Value, String> {
    array(state, "workouts")?
        .iter()
        .find(|item| item["id"].as_str() == Some(id))
        .cloned()
        .ok_or_else(|| "找不到这条运动记录。".to_string())
}

fn require_active_workout(state: &Map<String, Value>, id: &str) -> Result<Value, String> {
    let existing = find_workout(state, id)?;
    if !is_active(&existing) {
        return Err("这条运动已修订或作废，请刷新后操作最新记录。".into());
    }
    Ok(existing)
}

/// 一次运动的公共字段：构造新记录与写审计共用同一份。
struct Draft<'a> {
    date: &'a str,
    name: &'a str,
    workout_type: &'a str,
    duration: f64,
    calories: Option<f64>,
    load: Option<f64>,
    average_heart: Option<f64>,
    max_heart: Option<f64>,
}

fn build_workout(id: &str, draft: &Draft, now: &str) -> Value {
    let Draft {
        date,
        name,
        workout_type,
        duration,
        calories,
        load,
        average_heart,
        max_heart,
    } = *draft;
    let mut workout = json!({
        "id":id, "date":date, "name":name, "type":workout_type,
        "durationMinutes":duration, "status":"active", "createdAt":now,
    });
    for (key, value) in [
        ("caloriesKcal", calories),
        ("load", load),
        ("averageHeartRate", average_heart),
        ("maxHeartRate", max_heart),
    ] {
        if let Some(value) = value {
            workout[key] = json!(value);
        }
    }
    workout
}

fn workout_details(draft: &Draft) -> Value {
    let Draft {
        date,
        name,
        workout_type,
        duration,
        calories,
        load,
        average_heart,
        max_heart,
    } = *draft;
    let mut details = json!({
        "date":date, "name":name, "type":workout_type, "durationMinutes":duration,
        "caloriesKcal":calories, "load":load,
        "averageHeartRate":average_heart, "maxHeartRate":max_heart,
    });
    if let Some(object) = details.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }
    details
}

fn set_status(
    item: &mut Value,
    status: &str,
    reason: &str,
    stamp_key: &str,
    now: &str,
) -> Result<(), String> {
    let object = item.as_object_mut().ok_or("运动记录格式无效。")?;
    object.insert("status".into(), json!(status));
    object.insert(stamp_key.into(), json!(now));
    object.insert("correctionReason".into(), json!(reason));
    Ok(())
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, today) = now_and_date();
    let id = format!("{kind}-{command_id}");

    let result = match kind {
        "revise_workout" => {
            let target_id = require_workout_id(payload)?;
            let reason = require_reason(payload)?;
            let date = payload_date(payload)?;
            ensure_not_future(&date, &today)?;
            let name = parse_name(payload)?;
            let workout_type = parse_type(payload)?;
            let duration = parse_duration(payload)?;
            let calories = parse_calories(payload)?;
            let load = parse_load(payload)?;
            let average_heart = parse_heart(payload, "averageHeartRate", "平均心率")?;
            let max_heart = parse_heart(payload, "maxHeartRate", "最高心率")?;
            if let (Some(average), Some(maximum)) = (average_heart, max_heart) {
                if average > maximum {
                    return Err("平均心率不能高于最高心率。".into());
                }
            }

            let existing = require_active_workout(state, &target_id)?;

            for item in array_mut(state, "workouts")? {
                if item["id"].as_str() == Some(target_id.as_str()) {
                    let object = item.as_object_mut().ok_or("运动记录格式无效。")?;
                    object.insert("status".into(), json!("superseded"));
                    object.insert("supersededBy".into(), json!(id));
                    object.insert("correctedAt".into(), json!(now));
                    object.insert("correctionReason".into(), json!(reason));
                }
            }

            let draft = Draft {
                date: &date,
                name: &name,
                workout_type: &workout_type,
                duration,
                calories,
                load,
                average_heart,
                max_heart,
            };
            let mut workout = build_workout(&id, &draft, &now);
            workout["supersedesId"] = json!(target_id);
            array_mut(state, "workouts")?.push(workout);
            sort_workouts(state)?;
            audit(
                state,
                command_id,
                "workout_revised",
                "workout_session",
                &id,
                json!({
                    "before": existing,
                    "after": workout_details(&draft),
                    "reason": reason,
                }),
            )?;
            json!({"workoutId":id, "date":date, "supersedesId":target_id})
        }
        "void_workout" => {
            let target_id = require_workout_id(payload)?;
            let reason = require_reason(payload)?;
            let existing = require_active_workout(state, &target_id)?;

            for item in array_mut(state, "workouts")? {
                if item["id"].as_str() == Some(target_id.as_str()) {
                    set_status(item, "void", &reason, "voidedAt", &now)?;
                }
            }
            sort_workouts(state)?;
            audit(
                state,
                command_id,
                "workout_voided",
                "workout_session",
                &target_id,
                json!({"before": existing, "reason": reason}),
            )?;
            json!({"workoutId":target_id})
        }
        other => return Err(format!("未知的运动命令：{other}")),
    };

    Ok(CommandMutation {
        applied: true,
        result,
    })
}
