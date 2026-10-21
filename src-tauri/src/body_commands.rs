//! 体重记录：同日可多次称重，支持更正、作废与手动指定当日代表值。
//!
//! 与 `meal_corrections` / `batch_corrections` 同一套口径：旧行留证（superseded / void），
//! 新行 active，改动都必须写原因并落审计事件。

use crate::domain_commands::{
    array, array_mut, now_and_date, payload_number, payload_str, CommandMutation,
};
use crate::record_commands::{audit, date as payload_date};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde_json::{json, Map, Value};

const WEIGHT_MIN_KG: f64 = 20.0;
const WEIGHT_MAX_KG: f64 = 400.0;
const TEXT_LIMIT: usize = 200;

/// 腰围与体脂都是可选字段：缺失就写不进去，绝不用 0 顶替。
const WAIST_MIN_CM: f64 = 40.0;
const WAIST_MAX_CM: f64 = 200.0;
const BODY_FAT_MIN_PERCENT: f64 = 3.0;
const BODY_FAT_MAX_PERCENT: f64 = 70.0;

/// 有效记录白名单：缺失 status 或显式 active。禁止写成「不等于 superseded」。
fn is_active(item: &Value) -> bool {
    matches!(item["status"].as_str(), None | Some("active"))
}

/// 排序时间戳：优先 measuredAt，其次 createdAt。两种时区写法都按真实时刻比较。
fn timestamp(item: &Value) -> i64 {
    item["measuredAt"]
        .as_str()
        .or_else(|| item["createdAt"].as_str())
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

fn sort_measurements(state: &mut Map<String, Value>) -> Result<(), String> {
    array_mut(state, "measurements")?.sort_by_key(order_key);
    Ok(())
}

fn parse_weight(payload: &Value) -> Result<f64, String> {
    let value = payload_number(payload, "weightKg")?;
    if !(WEIGHT_MIN_KG..=WEIGHT_MAX_KG).contains(&value) {
        return Err(format!(
            "体重需在 {WEIGHT_MIN_KG:.0}–{WEIGHT_MAX_KG:.0} kg 之间。"
        ));
    }
    let scaled = value * 100.0;
    if (scaled - scaled.round()).abs() > 1e-6 {
        return Err("体重最多保留两位小数。".into());
    }
    Ok(scaled.round() / 100.0)
}

fn parse_measured_at(payload: &Value, date: &str) -> Result<Option<String>, String> {
    let Some(raw) = payload.get("measuredAt").and_then(Value::as_str) else {
        // 缺省时不伪造时刻：留空即「未标注」，排序回退到入库时间。
        return Ok(None);
    };
    let raw = raw.trim();
    let format_error = || "称重时刻格式应为 YYYY-MM-DDTHH:mm:ss+08:00。".to_string();
    if raw.len() != 25 || !raw.is_ascii() {
        return Err(format_error());
    }
    let bytes = raw.as_bytes();
    if bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || !raw.ends_with("+08:00")
        || NaiveDate::parse_from_str(&raw[..10], "%Y-%m-%d").is_err()
        || NaiveTime::parse_from_str(&raw[11..19], "%H:%M:%S").is_err()
    {
        return Err(format_error());
    }
    if &raw[..10] != date {
        return Err("称重时刻必须与称重日期是同一天。".into());
    }
    let parsed = DateTime::parse_from_rfc3339(raw).map_err(|_| format_error())?;
    // 允许 2 分钟时钟误差，避免刚录完就被判成未来时间。
    if parsed.timestamp() > Utc::now().timestamp() + 120 {
        return Err("称重时刻不能晚于当前时间。".into());
    }
    Ok(Some(raw.to_string()))
}

/// 可选的十进制字段：缺失/null/空串都表示「这次没量」，返回 None。
/// 一旦给了值就必须落在区间内且小数位不超过一位——留空不能变成 0。
fn parse_optional_decimal(
    payload: &Value,
    key: &str,
    label: &str,
    min: f64,
    max: f64,
    range: &str,
) -> Result<Option<f64>, String> {
    let value = match payload.get(key) {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Number(number)) => number
            .as_f64()
            .ok_or_else(|| format!("{label}只能是数字。"))?,
        Some(_) => return Err(format!("{label}只能是数字。")),
    };
    if !value.is_finite() || value < min || value > max {
        return Err(format!("{label}需在 {range} 之间。"));
    }
    let scaled = value * 10.0;
    if (scaled - scaled.round()).abs() > 1e-6 {
        return Err(format!("{label}最多保留一位小数。"));
    }
    Ok(Some(scaled.round() / 10.0))
}

fn parse_waist(payload: &Value) -> Result<Option<f64>, String> {
    parse_optional_decimal(
        payload,
        "waistCm",
        "腰围",
        WAIST_MIN_CM,
        WAIST_MAX_CM,
        "40–200 cm",
    )
}

fn parse_body_fat(payload: &Value) -> Result<Option<f64>, String> {
    parse_optional_decimal(
        payload,
        "bodyFatPercent",
        "体脂率",
        BODY_FAT_MIN_PERCENT,
        BODY_FAT_MAX_PERCENT,
        "3%–70%",
    )
}

fn parse_condition(payload: &Value) -> Result<Option<String>, String> {
    match payload.get("condition") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(raw)) => match raw.as_str() {
            "morning" | "other" => Ok(Some(raw.clone())),
            _ => Err("称重条件只能是「晨起」或「其他」。".into()),
        },
        Some(_) => Err("称重条件只能是「晨起」或「其他」。".into()),
    }
}

fn parse_note(payload: &Value) -> Result<Option<String>, String> {
    match payload.get("note") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(raw)) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if trimmed.chars().count() > TEXT_LIMIT {
                return Err(format!("备注不能超过 {TEXT_LIMIT} 字。"));
            }
            Ok(Some(trimmed.to_string()))
        }
        Some(_) => Err("备注必须是文本。".into()),
    }
}

fn ensure_not_future(date: &str, today: &str) -> Result<(), String> {
    if date > today {
        return Err("称重日期不能晚于今天。".into());
    }
    Ok(())
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

fn find_measurement(state: &Map<String, Value>, id: &str) -> Result<Value, String> {
    array(state, "measurements")?
        .iter()
        .find(|item| item["id"].as_str() == Some(id))
        .cloned()
        .ok_or_else(|| "找不到这条体重记录。".to_string())
}

fn require_active_measurement(state: &Map<String, Value>, id: &str) -> Result<Value, String> {
    let existing = find_measurement(state, id)?;
    if !is_active(&existing) {
        return Err("这条体重已修订或作废，请刷新后操作最新记录。".into());
    }
    Ok(existing)
}

/// 与「该日期之前（含当日）最近一条有效记录」比较，差值超过 3 kg 视为异常波动。
fn is_outlier(state: &Map<String, Value>, date: &str, weight: f64, exclude: &[&str]) -> bool {
    let Ok(measurements) = array(state, "measurements") else {
        return false;
    };
    let latest = measurements
        .iter()
        .filter(|item| is_active(item))
        .filter(|item| !exclude.iter().any(|id| item["id"].as_str() == Some(*id)))
        .filter(|item| item["date"].as_str().is_some_and(|value| value <= date))
        .max_by(|a, b| order_key(a).cmp(&order_key(b)));
    latest
        .and_then(|item| item["weightKg"].as_f64())
        .is_some_and(|previous| (previous - weight).abs() > 3.0)
}

fn set_status(
    item: &mut Value,
    status: &str,
    reason: &str,
    stamp_key: &str,
    now: &str,
) -> Result<(), String> {
    let object = item.as_object_mut().ok_or("体重记录格式无效。")?;
    object.insert("status".into(), json!(status));
    object.insert(stamp_key.into(), json!(now));
    object.insert("correctionReason".into(), json!(reason));
    object.insert("dayRepresentative".into(), json!(false));
    Ok(())
}

/// 一次称重的公共字段：构造新记录与写审计共用同一份，避免两边参数表各写一遍。
struct Draft<'a> {
    date: &'a str,
    weight: f64,
    measured_at: Option<&'a String>,
    condition: Option<&'a String>,
    note: Option<&'a String>,
    waist: Option<f64>,
    body_fat: Option<f64>,
    outlier: bool,
}

fn build_measurement(id: &str, draft: &Draft, now: &str) -> Value {
    let Draft {
        date,
        weight,
        measured_at,
        condition,
        note,
        waist,
        body_fat,
        outlier,
    } = *draft;
    let mut measurement = json!({
        "id":id, "date":date, "weightKg":weight,
        "source":"manual", "status":"active", "isOutlier":outlier, "createdAt":now,
    });
    if let Some(measured_at) = measured_at {
        measurement["measuredAt"] = json!(measured_at);
    }
    if let Some(condition) = condition {
        measurement["condition"] = json!(condition);
    }
    if let Some(note) = note {
        measurement["note"] = json!(note);
    }
    if let Some(waist) = waist {
        measurement["waistCm"] = json!(waist);
    }
    if let Some(body_fat) = body_fat {
        measurement["bodyFatPercent"] = json!(body_fat);
    }
    measurement
}

fn measurement_details(draft: &Draft) -> Value {
    let Draft {
        date,
        weight,
        measured_at,
        condition,
        note,
        waist,
        body_fat,
        outlier,
    } = *draft;
    let mut details = json!({
        "date":date, "weightKg":weight, "measuredAt":measured_at,
        "condition":condition, "note":note,
        "waistCm":waist, "bodyFatPercent":body_fat, "isOutlier":outlier,
    });
    if let Some(object) = details.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }
    details
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, today) = now_and_date();
    let id = format!("{kind}-{command_id}");
    let mut result = json!({});
    let mut applied = true;

    match kind {
        "add_weight" => {
            let weight = parse_weight(payload)?;
            let date = payload_date(payload)?;
            ensure_not_future(&date, &today)?;
            let measured_at = parse_measured_at(payload, &date)?;
            let condition = parse_condition(payload)?;
            let note = parse_note(payload)?;
            let waist = parse_waist(payload)?;
            let body_fat = parse_body_fat(payload)?;
            let outlier = is_outlier(state, &date, weight, &[]);
            let draft = Draft {
                date: &date,
                weight,
                measured_at: measured_at.as_ref(),
                condition: condition.as_ref(),
                note: note.as_ref(),
                waist,
                body_fat,
                outlier,
            };
            let measurement = build_measurement(&id, &draft, &now);
            array_mut(state, "measurements")?.push(measurement);
            sort_measurements(state)?;
            audit(
                state,
                command_id,
                "body_measurement_created",
                "body_measurement",
                &id,
                measurement_details(&draft),
            )?;
            result = json!({"isOutlier":outlier, "weightKg":weight});
        }
        "revise_weight" => {
            let target_id = payload_str(payload, "measurementId")?.to_string();
            let reason = require_reason(payload)?;
            let weight = parse_weight(payload)?;
            let date = payload_date(payload)?;
            ensure_not_future(&date, &today)?;
            let measured_at = parse_measured_at(payload, &date)?;
            let condition = parse_condition(payload)?;
            let note = parse_note(payload)?;
            let waist = parse_waist(payload)?;
            let body_fat = parse_body_fat(payload)?;

            let existing = require_active_measurement(state, &target_id)?;
            let was_representative = existing["dayRepresentative"] == json!(true);
            let outlier = is_outlier(state, &date, weight, &[target_id.as_str()]);

            for item in array_mut(state, "measurements")? {
                if item["id"].as_str() == Some(target_id.as_str()) {
                    let object = item.as_object_mut().ok_or("体重记录格式无效。")?;
                    object.insert("status".into(), json!("superseded"));
                    object.insert("supersededBy".into(), json!(id));
                    object.insert("correctedAt".into(), json!(now));
                    object.insert("correctionReason".into(), json!(reason));
                    object.insert("dayRepresentative".into(), json!(false));
                }
            }

            let draft = Draft {
                date: &date,
                weight,
                measured_at: measured_at.as_ref(),
                condition: condition.as_ref(),
                note: note.as_ref(),
                waist,
                body_fat,
                outlier,
            };
            let mut measurement = build_measurement(&id, &draft, &now);
            measurement["supersedesId"] = json!(target_id);
            if was_representative {
                measurement["dayRepresentative"] = json!(true);
            }
            array_mut(state, "measurements")?.push(measurement);
            sort_measurements(state)?;
            audit(
                state,
                command_id,
                "body_measurement_revised",
                "body_measurement",
                &id,
                json!({
                    "before": existing,
                    "after": measurement_details(&draft),
                    "reason": reason,
                }),
            )?;
            result = json!({"measurementId":id, "date":date, "weightKg":weight});
        }
        "void_weight" => {
            let target_id = payload_str(payload, "measurementId")?.to_string();
            let reason = require_reason(payload)?;
            let existing = require_active_measurement(state, &target_id)?;

            for item in array_mut(state, "measurements")? {
                if item["id"].as_str() == Some(target_id.as_str()) {
                    set_status(item, "void", &reason, "voidedAt", &now)?;
                }
            }
            sort_measurements(state)?;
            audit(
                state,
                command_id,
                "body_measurement_voided",
                "body_measurement",
                &target_id,
                json!({"before": existing, "reason": reason}),
            )?;
            result = json!({"measurementId":target_id});
        }
        "set_weight_representative" => {
            let target_id = payload_str(payload, "measurementId")?.to_string();
            let existing = require_active_measurement(state, &target_id)?;
            let date = existing["date"].as_str().unwrap_or_default().to_string();

            let siblings: Vec<Value> = array(state, "measurements")?
                .iter()
                .filter(|item| item["date"].as_str() == Some(date.as_str()) && is_active(item))
                .cloned()
                .collect();
            let already_set = siblings.iter().all(|item| {
                if item["id"].as_str() == Some(target_id.as_str()) {
                    item["dayRepresentative"] == json!(true)
                } else {
                    item["dayRepresentative"] != json!(true)
                }
            });
            if already_set {
                // 重复指定同一条不再产生审计噪音。
                applied = false;
                result = json!({"unchanged":true, "measurementId":target_id});
            } else {
                let previous = siblings
                    .iter()
                    .find(|item| item["dayRepresentative"] == json!(true))
                    .and_then(|item| item["id"].as_str())
                    .map(str::to_string);
                for item in array_mut(state, "measurements")? {
                    if item["date"].as_str() != Some(date.as_str()) || !is_active(item) {
                        continue;
                    }
                    let is_target = item["id"].as_str() == Some(target_id.as_str());
                    let object = item.as_object_mut().ok_or("体重记录格式无效。")?;
                    if is_target {
                        object.insert("dayRepresentative".into(), json!(true));
                    } else {
                        object.remove("dayRepresentative");
                    }
                }
                sort_measurements(state)?;
                audit(
                    state,
                    command_id,
                    "body_measurement_representative_changed",
                    "body_measurement",
                    &target_id,
                    json!({"date":date, "measurementId":target_id, "previousId":previous}),
                )?;
                result = json!({"measurementId":target_id, "previousId":previous});
            }
        }
        other => return Err(format!("未知的体重命令：{other}")),
    }

    Ok(CommandMutation { applied, result })
}
