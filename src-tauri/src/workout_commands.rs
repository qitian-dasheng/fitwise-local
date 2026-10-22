//! 运动记录：支持更正、作废，以及「撤销更正 / 恢复作废」。
//!
//! 与 `body_commands` / `meal_corrections` 同一套口径：旧行留证（superseded / void / reverted），
//! 新行 active，改动都必须落审计事件；更正与作废必须写原因，撤销更正与恢复作废的原因
//! 分别可选与必填（恢复会让一条作废记录重新进入统计，风险更高，所以要写明为什么）。
//!
//! 与体重不同的是，运动没有「同日代表值」概念：一天练两次就是两条互相独立的事实，
//! 只有明确改错或作废时才需要留证。
//!
//! 状态语义：`superseded` = 被更正的旧值；`reverted` = 被撤销的那次更正；
//! `void` = 本来就不该存在的记录。三种都不是有效记录，只有 `active`（或缺失 status）算数。

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

/// 撤销更正的原因可留空：撤销只是把刚做的动作退回，本身自解释。
/// 缺失 / null / 空串都当「没写」，不伪造用户意图；给了就照样校验长度。
fn optional_reason(payload: &Value) -> Result<Option<String>, String> {
    let Some(raw) = payload.get("reason") else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    let Some(text) = raw.as_str() else {
        return Err("原因格式无效。".into());
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > TEXT_LIMIT {
        return Err(format!("原因不能超过 {TEXT_LIMIT} 字。"));
    }
    Ok(Some(trimmed.to_string()))
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

/// 清掉不再成立的指针（不存在也算成功），与 `set_status` 的写入风格对称。
fn clear_keys(item: &mut Value, keys: &[&str]) -> Result<(), String> {
    let object = item.as_object_mut().ok_or("运动记录格式无效。")?;
    for key in keys {
        object.remove(*key);
    }
    Ok(())
}

/// 把一条记录标成「被撤销的更正」。保留 `supersedesId`：它必须能证明自己曾经是谁的更正。
/// 更正原因本来就写在被更正的父行上，这里不搬运、也不凭空补一个。
fn mark_reverted(item: &mut Value, now: &str, reason: Option<&str>) -> Result<(), String> {
    let object = item.as_object_mut().ok_or("运动记录格式无效。")?;
    object.insert("status".into(), json!("reverted"));
    object.insert("revertedAt".into(), json!(now));
    if let Some(reason) = reason {
        object.insert("revertedReason".into(), json!(reason));
    }
    Ok(())
}

/// 把一条记录恢复成有效：撤销更正时给父行用，恢复作废时给作废行用。
fn mark_restored(item: &mut Value, now: &str, reason: Option<&str>) -> Result<(), String> {
    let object = item.as_object_mut().ok_or("运动记录格式无效。")?;
    object.insert("status".into(), json!("active"));
    object.insert("restoredAt".into(), json!(now));
    if let Some(reason) = reason {
        object.insert("restoredReason".into(), json!(reason));
    }
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
        "undo_workout_correction" => {
            let target_id = require_workout_id(payload)?;
            let reason = optional_reason(payload)?;

            let head = find_workout(state, &target_id)?;
            if !is_active(&head) {
                return Err("这条运动记录当前不是有效记录，无法撤销更正。".into());
            }
            let Some(parent_id) = head["supersedesId"].as_str().map(str::to_string) else {
                return Err("这条运动不是更正产生的，没有可撤销的更正。".into());
            };
            let parent = find_workout(state, &parent_id)
                .map_err(|_| "找不到被更正的原始记录，无法撤销。".to_string())?;
            // 只退一步：撤销过一次之后父行已是 active，这里第二次就对不上。
            if parent["status"].as_str() != Some("superseded") {
                return Err("这条更正已经撤销过或已被改动，请刷新后重试。".into());
            }
            if parent["supersededBy"].as_str() != Some(target_id.as_str()) {
                return Err("更正记录之间的关系已不一致，请刷新后重试。".into());
            }

            for item in array_mut(state, "workouts")? {
                if item["id"].as_str() == Some(parent_id.as_str()) {
                    mark_restored(item, &now, reason.as_deref())?;
                    item["restoredCorrectionId"] = json!(target_id);
                    // 只清指向已失效对象的指针；correctionReason 留着说明当初为什么改。
                    clear_keys(item, &["supersededBy", "correctedAt"])?;
                } else if item["id"].as_str() == Some(target_id.as_str()) {
                    mark_reverted(item, &now, reason.as_deref())?;
                }
            }
            sort_workouts(state)?;

            let parent_after = find_workout(state, &parent_id)?;
            let head_after = find_workout(state, &target_id)?;
            let date = parent["date"].as_str().unwrap_or_default().to_string();
            audit(
                state,
                command_id,
                "workout_correction_undone",
                "workout_session",
                &parent_id,
                json!({
                    "before": {"head": head, "parent": parent},
                    "after": {"head": head_after, "parent": parent_after},
                    "reason": reason,
                    "restoredWorkoutId": parent_id,
                    "revertedWorkoutId": target_id,
                }),
            )?;
            json!({
                "restoredWorkoutId": parent_id,
                "revertedWorkoutId": target_id,
                "date": date,
            })
        }
        "restore_voided_workout" => {
            let target_id = require_workout_id(payload)?;
            // 与撤销相反：恢复会让一条作废记录重新进入统计，必须写明为什么。
            let reason = require_reason(payload)?;

            let existing = find_workout(state, &target_id)?;
            if existing["status"].as_str() != Some("void") {
                return Err("只有已作废的记录可以恢复。".into());
            }
            if let Some(parent_id) = existing["supersedesId"].as_str() {
                let parent = find_workout(state, parent_id)
                    .map_err(|_| "这条记录与原来的更正链不一致，请刷新后重试。".to_string())?;
                if parent["status"].as_str() != Some("superseded")
                    || parent["supersededBy"].as_str() != Some(target_id.as_str())
                {
                    return Err("这条记录与原来的更正链不一致，请刷新后重试。".into());
                }
            }

            for item in array_mut(state, "workouts")? {
                if item["id"].as_str() == Some(target_id.as_str()) {
                    mark_restored(item, &now, Some(&reason))?;
                    clear_keys(item, &["voidedAt"])?;
                }
            }
            sort_workouts(state)?;

            let restored = find_workout(state, &target_id)?;
            let date = existing["date"].as_str().unwrap_or_default().to_string();
            audit(
                state,
                command_id,
                "workout_void_restored",
                "workout_session",
                &target_id,
                json!({"before": existing, "after": restored, "reason": reason}),
            )?;
            json!({"workoutId":target_id, "date":date, "status":"active"})
        }
        other => return Err(format!("未知的运动命令：{other}")),
    };

    Ok(CommandMutation {
        applied: true,
        result,
    })
}
