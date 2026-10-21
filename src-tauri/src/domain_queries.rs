use crate::domain_store::{import_legacy_state, load_envelope, open_database, STORAGE_NAME};
use chrono::{Days, NaiveDate, Utc};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

const NUTRIENTS: [&str; 7] = [
    "calories",
    "protein",
    "carbohydrates",
    "fat",
    "fiber",
    "sugar",
    "sodium",
];

fn validate_period(start: &str, end: &str) -> Result<(NaiveDate, NaiveDate), String> {
    let start = NaiveDate::parse_from_str(start, "%Y-%m-%d").map_err(|_| "开始日期无效。")?;
    let end = NaiveDate::parse_from_str(end, "%Y-%m-%d").map_err(|_| "结束日期无效。")?;
    if end < start || (end - start).num_days() > 3660 {
        return Err("查询时间范围无效或超过十年。".into());
    }
    Ok((start, end))
}

pub(crate) fn period_summary(
    connection: &Connection,
    start: &str,
    end: &str,
) -> Result<Value, String> {
    let (start_date, end_date) = validate_period(start, end)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let revision: Option<i64> = transaction
        .query_row(
            "SELECT revision FROM domain_state_meta WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if revision.is_none() {
        return Ok(Value::Null);
    }
    let mut days = BTreeMap::<String, Value>::new();
    let mut current = start_date;
    loop {
        days.insert(current.to_string(),json!({"date":current.to_string(),"complete":false,"mealCount":0,"totals":{},"coverage":{}}));
        if current == end_date {
            break;
        }
        current = current.checked_add_days(Days::new(1)).ok_or("日期溢出。")?;
    }
    let mut weights = BTreeMap::<String, ([f64; 7], [f64; 7], f64, usize)>::new();
    {
        let mut statement = transaction.prepare("SELECT diary_date,ratio,nutrition_json FROM domain_active_meal_projection WHERE diary_date BETWEEN ?1 AND ?2").map_err(|error|error.to_string())?;
        let rows = statement
            .query_map([start, end], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (date, ratio, nutrition) = row.map_err(|error| error.to_string())?;
            let nutrition: Value =
                serde_json::from_str(&nutrition).map_err(|error| error.to_string())?;
            let entry = weights.entry(date).or_insert(([0.0; 7], [0.0; 7], 0.0, 0));
            entry.2 += ratio;
            entry.3 += 1;
            for (index, key) in NUTRIENTS.iter().enumerate() {
                let metric = &nutrition[key];
                if matches!(metric["state"].as_str(), Some("known" | "zero")) {
                    if let Some(value) = metric["value"].as_f64() {
                        entry.0[index] += value * ratio;
                        entry.1[index] += ratio;
                    }
                }
            }
        }
    }
    for (date, day) in &mut days {
        let (totals, known, total, count) = weights
            .get(date)
            .copied()
            .unwrap_or(([0.0; 7], [0.0; 7], 0.0, 0));
        for (index, key) in NUTRIENTS.iter().enumerate() {
            day["totals"][key] = json!(totals[index]);
            day["coverage"][key] = json!(if total == 0.0 {
                0.0
            } else {
                (known[index] / total * 100.0).round()
            });
        }
        day["mealCount"] = json!(count);
    }
    {
        let mut statement = transaction.prepare("SELECT diary_date,complete FROM domain_checkin_projection WHERE diary_date BETWEEN ?1 AND ?2").map_err(|error|error.to_string())?;
        let rows = statement
            .query_map([start, end], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (date, complete) = row.map_err(|error| error.to_string())?;
            if let Some(day) = days.get_mut(&date) {
                day["complete"] = json!(complete);
            }
        }
    }
    let eligible: Vec<&Value> = days
        .values()
        .filter(|day| {
            day["complete"] == true
                && day["mealCount"].as_u64().unwrap_or(0) > 0
                && day["date"]
                    .as_str()
                    .and_then(|date| weights.get(date))
                    .is_some_and(|(_, known, total, _)| {
                        *total > 0.0 && (known[0] - total).abs() < 1e-12
                    })
        })
        .collect();
    let eligible_count = eligible.len();
    let calorie_average = if eligible.is_empty() {
        None
    } else {
        Some(
            eligible
                .iter()
                .map(|day| day["totals"]["calories"].as_f64().unwrap_or(0.0))
                .sum::<f64>()
                / eligible_count as f64,
        )
    };
    // 逐日运动：阶段复盘需要按日着色，所以除了区间总和，也把每天的量填进 days[]。
    // 视图自 0012 起已过滤 void/superseded，作废的运动不会进入这里。
    let mut workout_days = BTreeMap::<String, (f64, i64)>::new();
    let mut workout_minutes = 0.0f64;
    {
        let mut statement = transaction
            .prepare(
                "SELECT workout_date, COALESCE(duration_minutes,0) \
                 FROM domain_workout_projection WHERE workout_date BETWEEN ?1 AND ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([start, end], |row| {
                Ok((row.get::<_, Option<String>>(0)?, row.get::<_, f64>(1)?))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (date, minutes) = row.map_err(|error| error.to_string())?;
            workout_minutes += minutes;
            if let Some(date) = date {
                let entry = workout_days.entry(date).or_insert((0.0, 0));
                entry.0 += minutes;
                entry.1 += 1;
            }
        }
    }
    for (date, day) in &mut days {
        let (minutes, count) = workout_days.get(date).copied().unwrap_or((0.0, 0));
        day["workoutMinutes"] = json!(minutes);
        day["workoutCount"] = json!(count);
    }
    let mut measurements = Vec::new();
    {
        let lookback = start_date
            .checked_sub_days(Days::new(6))
            .unwrap_or(start_date)
            .to_string();
        // 同日可以多次称重：先按「当日代表值」折叠成每天一个点，再算 7 日窗口，
        // 否则一天称三次就会在均线里被加权三次。
        // 排序口径与 Rust/TS 的 dailyRepresentatives 一致：显式代表 > 时刻最新 > id。
        let mut statement = transaction
            .prepare(
                "SELECT id,measured_date,weight_kg,is_outlier \
             FROM domain_measurement_projection WHERE measured_date BETWEEN ?1 AND ?2 \
             ORDER BY measured_date, COALESCE(day_representative,0), \
               COALESCE(strftime('%s',measured_at), strftime('%s',created_at), 0), id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([lookback.as_str(), end], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, Option<bool>>(3)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut daily: BTreeMap<String, (String, String, f64, bool)> = BTreeMap::new();
        for row in rows {
            let (id, date, weight, outlier) = row.map_err(|error| error.to_string())?;
            // 升序遍历，后写入的覆盖先写入的，即保留当日最新（或显式代表）。
            daily.insert(date.clone(), (id, date, weight, outlier.unwrap_or(false)));
        }
        let points: Vec<(String, String, f64, bool)> = daily.into_values().collect();
        for (id, date, weight, outlier) in &points {
            if date.as_str() < start {
                continue;
            }
            let earliest = NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .map_err(|error| error.to_string())?
                .checked_sub_days(Days::new(6))
                .ok_or("日期无效。")?
                .to_string();
            let window: Vec<f64> = points
                .iter()
                .filter(|(_, candidate, _, _)| candidate >= &earliest && candidate <= date)
                .map(|(_, _, weight, _)| *weight)
                .collect();
            measurements.push(json!({"id":id,"date":date,"weightKg":weight,"isOutlier":outlier,"average":window.iter().sum::<f64>()/window.len() as f64}));
        }
    }
    let latest: Option<(String,f64)> = transaction.query_row("SELECT measured_date,weight_kg FROM domain_measurement_projection WHERE measured_date <= ?1 ORDER BY measured_date DESC, COALESCE(day_representative,0) DESC, COALESCE(strftime('%s',measured_at), strftime('%s',created_at), 0) DESC, id DESC LIMIT 1",[end],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|error|error.to_string())?;
    Ok(
        json!({"revision":revision,"start":start,"end":end,"days":days.into_values().collect::<Vec<_>>(),"completedDayCalorieAverage":calorie_average,"eligibleDayCount":eligible_count,"workoutMinutes":workout_minutes,"measurements":measurements,"latestWeightKg":latest.as_ref().map(|item|item.1)}),
    )
}

#[tauri::command]
pub fn query_period_summary(app: AppHandle, start: String, end: String) -> Result<Value, String> {
    let mut connection = open_database(&app)?;
    if load_envelope(&connection)?.is_none() {
        import_legacy_state(&mut connection, STORAGE_NAME)?;
    }
    period_summary(&connection, &start, &end)
}

#[tauri::command]
pub fn query_inventory_summary(app: AppHandle) -> Result<Value, String> {
    let mut connection = open_database(&app)?;
    if load_envelope(&connection)?.is_none() {
        import_legacy_state(&mut connection, STORAGE_NAME)?;
    }
    inventory_summary(&connection)
}

pub(crate) fn inventory_summary(connection: &Connection) -> Result<Value, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let initialized: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM domain_state_meta)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !initialized {
        return Ok(Value::Null);
    }
    let mut items = Vec::new();
    let mut statement = transaction.prepare("SELECT e.payload_json FROM domain_inventory_projection p JOIN domain_entities e ON e.collection='inventory' AND e.entity_id=p.id ORDER BY p.opened DESC,COALESCE(p.expires_at,'9999-12-31'),p.purchased_at,p.id").map_err(|error|error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    for row in rows {
        items.push(
            serde_json::from_str::<Value>(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?,
        );
    }
    let remaining_cost: f64 = items
        .iter()
        .map(|item| {
            let purchased = item["purchasedAmount"].as_f64().unwrap_or(0.0);
            if purchased > 0.0 {
                item["purchasePriceCny"].as_f64().unwrap_or(0.0)
                    * item["remainingAmount"].as_f64().unwrap_or(0.0)
                    / purchased
            } else {
                0.0
            }
        })
        .sum();
    Ok(json!({"items":items,"remainingCostCny":remaining_cost}))
}

#[tauri::command]
pub fn export_domain_json(app: AppHandle) -> Result<Value, String> {
    // Export must never initialize, migrate or import records as a side effect.
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("fitwise.db");
    export_domain_at_path(&path)
}

fn export_domain_at_path(path: &std::path::Path) -> Result<Value, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("只读导出无法打开数据库：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    // Capture state, label drafts and attachment manifests under the same read revision.
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let raw = load_envelope(&transaction)?
        .ok_or("数据库没有已初始化记录。请先另存当前窗口快照，不要重置或关闭窗口。")?;
    let envelope: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let mut data = envelope["state"]
        .as_object()
        .ok_or("领域仓库格式无效。")?
        .clone();
    data.insert("schemaVersion".into(), json!(12));
    data.insert(
        "labelDrafts".into(),
        crate::label_drafts::manifest(&transaction)?,
    );
    data.insert(
        "inputArtifacts".into(),
        crate::artifacts::manifest(&transaction)?,
    );
    data.insert("persistVersion".into(), envelope["version"].clone());
    data.insert("exportedAt".into(), json!(Utc::now().to_rfc3339()));
    data.insert("app".into(), json!("Fitwise Local"));
    data.insert("source".into(), json!("sqlite_domain_repository"));
    Ok(Value::Object(data))
}

#[tauri::command]
pub fn get_domain_upgrade_report(app: AppHandle) -> Result<Value, String> {
    let connection = open_database(&app)?;
    let raw: String = connection
        .query_row(
            "SELECT report_json FROM domain_upgrade_reports ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

#[cfg(test)]
mod export_tests {
    use super::*;
    #[test]
    fn export_is_read_only_never_imports_legacy_and_preserves_all_manifests() {
        let path = std::env::temp_dir().join(format!(
            "fitwise-readonly-export-{}.db",
            rand::random::<u64>()
        ));
        assert!(export_domain_at_path(&path).is_err());
        assert!(!path.exists());
        let connection = Connection::open(&path).unwrap();
        crate::domain_store::ensure_repository_schema(&connection).unwrap();
        connection.execute("INSERT INTO app_kv(key,value,updated_at) VALUES('fitwise-app-state-v1','{}','test')", []).unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(export_domain_at_path(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("INSERT INTO domain_singletons(key,payload_json,updated_at) VALUES('profile','{}','test'),('aiSettings','{}','test'); INSERT INTO domain_state_meta(id,persist_version,revision,content_sha256,updated_at) VALUES(1,4,7,'test','test'); INSERT INTO domain_entities(collection,entity_id,payload_json,sort_index,updated_at) VALUES('meals','synthetic-meal','{\"id\":\"synthetic-meal\"}',0,'test');").unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        let exported = export_domain_at_path(&path).unwrap();
        assert_eq!(exported["source"], "sqlite_domain_repository");
        assert_eq!(exported["meals"][0]["id"], "synthetic-meal");
        assert_eq!(exported["labelDrafts"], json!([]));
        assert_eq!(exported["inputArtifacts"]["binaryIncluded"], false);
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
}
