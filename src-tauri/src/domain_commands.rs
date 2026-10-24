use crate::domain_store::{
    ensure_repository_schema, load_envelope, open_database, write_transaction, STORAGE_NAME,
};
use chrono::{FixedOffset, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
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

#[derive(Debug)]
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
            | "set_food_archived"
            | "delete_food"
            | "correct_food_identity"
            | "record_food_meal"
            | "save_recipe_version"
            | "record_recipe_meal"
            | "revise_meal"
            | "void_meal"
            | "add_meal"
            | "copy_meal"
            | "add_weight"
            | "revise_weight"
            | "void_weight"
            | "set_weight_representative"
            | "add_workout"
            | "revise_workout"
            | "void_workout"
            | "undo_workout_correction"
            | "restore_voided_workout"
            | "set_checkin"
            | "set_day_complete"
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
        "revise_meal" | "void_meal" => crate::meal_corrections::apply(
            &mut state,
            &request.kind,
            &request.payload,
            &request.command_id,
        )?,
        "save_recipe_version" => {
            crate::recipes::apply(&mut state, &request.payload, &request.command_id)?
        }
        "record_recipe_meal" => {
            crate::recipe_meal_commands::apply(&mut state, &request.payload, &request.command_id)?
        }
        "save_food_definition"
        | "revise_food_definition"
        | "set_food_favorite"
        | "set_food_archived"
        | "delete_food"
        | "correct_food_identity"
        | "record_food_meal" => crate::food_library::apply(
            &mut state,
            &request.kind,
            &request.payload,
            &request.command_id,
        )?,
        "add_weight" | "revise_weight" | "void_weight" | "set_weight_representative" => {
            crate::body_commands::apply(
                &mut state,
                &request.kind,
                &request.payload,
                &request.command_id,
            )?
        }
        // 运动更正必须显式匹配：留到 `_ =>` 兜底会落到 record_commands，
        // 那里只认 add_workout，其余 kind 会被当成未知命令拒绝。
        // 新增的撤销/恢复同理，白名单与分发必须同一次改。
        "revise_workout"
        | "void_workout"
        | "undo_workout_correction"
        | "restore_voided_workout" => crate::workout_commands::apply(
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

    // A completed diary is a reviewed snapshot, not a permanent flag. Later food
    // changes require another explicit confirmation before joining weekly averages.
    if matches!(
        request.kind.as_str(),
        "add_meal" | "copy_meal" | "record_food_meal" | "record_recipe_meal"
    ) {
        let date = crate::record_commands::date(&request.payload)?;
        let mut reopened = false;
        for item in array_mut(&mut state, "checkIns")? {
            if item["date"].as_str() == Some(&date) && item["complete"] == true {
                let item = item.as_object_mut().ok_or("每日状态格式无效。")?;
                item.insert("complete".into(), json!(false));
                item.remove("completedAt");
                reopened = true;
            }
        }
        if reopened {
            array_mut(&mut state, "auditEvents")?.push(json!({
                "id": format!("{}:reopen", request.command_id), "eventType": "diet_day_reopened",
                "entityType": "diary", "payload": { "date": date, "commandId": request.command_id },
                "createdAt": Utc::now().to_rfc3339(),
            }));
        }
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
    include!("body_command_tests.rs");
    include!("meal_copy_tests.rs");
    include!("workout_command_tests.rs");
    include!("recipe_meal_command_tests.rs");
    include!("food_management_command_tests.rs");
    include!("upgrade_compat_command_tests.rs");

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

    #[test]
    fn historical_recipe_copy_pins_old_food_and_keeps_independent_identity_and_audit_source() {
        let mut c = connection();
        execute_with_connection(
            &mut c,
            request(
                "recipe-food",
                "save_food_definition",
                food_payload(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let original = execute_with_connection(
            &mut c,
            request(
                "ledger-recipe-original",
                "save_recipe_version",
                recipe_payload(1.0),
                None,
            ),
        )
        .unwrap();
        let original_recipe = original.state["recipes"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()
            .clone();
        let mut revision = food_payload();
        revision["foodId"] = json!("food-recipe-food");
        revision["expectedVersionId"] = json!("food-version-recipe-food");
        revision["input"]["nutrients"]["calories"] = json!(800);
        execute_with_connection(
            &mut c,
            request(
                "ledger-food-revision",
                "revise_food_definition",
                revision,
                None,
            ),
        )
        .unwrap();
        let mut newer = recipe_payload(2.0);
        newer["recipeId"] = original_recipe["recipeId"].clone();
        newer["expectedVersionId"] = original_recipe["id"].clone();
        execute_with_connection(
            &mut c,
            request("ledger-recipe-newer", "save_recipe_version", newer, None),
        )
        .unwrap();
        let mut copy = recipe_payload(1.0);
        copy["name"] = json!("旧配方另存");
        copy["copiedFromVersionId"] = original_recipe["id"].clone();
        let copied = execute_with_connection(
            &mut c,
            request(
                "ledger-recipe-copy",
                "save_recipe_version",
                copy.clone(),
                None,
            ),
        )
        .unwrap();
        let r = copied.state["recipes"].as_array().unwrap().last().unwrap();
        assert_ne!(r["recipeId"], original_recipe["recipeId"]);
        assert_eq!(r["version"], 1);
        assert_eq!(r["copiedFromVersionId"], original_recipe["id"]);
        assert_eq!(r["nutrition"], original_recipe["nutrition"]);
        assert_eq!(r["ingredients"], original_recipe["ingredients"]);
        assert!(copied.state["recipes"]
            .as_array()
            .unwrap()
            .contains(&original_recipe));
        assert_eq!(copied.state["meals"], original.state["meals"]);
        assert!(
            execute_with_connection(
                &mut c,
                request("ledger-recipe-copy", "save_recipe_version", copy, None)
            )
            .unwrap()
            .replayed
        );
    }

    fn food_payload() -> Value {
        json!({"input":{"name":"燕麦","brand":"example","measurementBasis":"packaged","basis":{"quantity":100,"unit":"g"},"energyUnit":"kcal","nutrients":{"calories":400,"protein":12,"fat":0},"conversions":[{"unit":"package","quantity":1,"basisQuantity":200}],"source":"label"}})
    }

    #[test]
    fn manual_meal_corrections_keep_originals_reopen_both_dates_and_project_only_active_rows() {
        let mut c = connection();
        let today = now_and_date().1;
        let yesterday = (chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap()
            - chrono::Days::new(1))
        .to_string();
        let first=execute_with_connection(&mut c,request("correction-first","add_meal",json!({"name":"外食","date":yesterday,"type":"lunch","amountLabel":"误记一份","calories":200,"protein":10}),Some(bootstrap()))).unwrap();
        let id = first.state["meals"][0]["id"].clone();
        let original_nutrition = first.state["meals"][0]["nutrition"].clone();
        for (key, date) in [("complete-old", &yesterday), ("complete-new", &today)] {
            execute_with_connection(
                &mut c,
                request(
                    key,
                    "set_day_complete",
                    json!({"date":date,"complete":true}),
                    None,
                ),
            )
            .unwrap();
        }
        let input = json!({"mealId":id,"reason":"日期与热量误记","date":today,"type":"dinner","name":"更正外食","amountLabel":"半份","nutrients":{"calories":100,"protein":0}});
        let changed = execute_with_connection(
            &mut c,
            request("correction-second", "revise_meal", input.clone(), None),
        )
        .unwrap();
        assert_eq!(changed.state["meals"][0]["nutrition"], original_nutrition);
        assert_eq!(changed.state["meals"][0]["status"], "superseded");
        assert_eq!(
            changed.state["meals"][1]["nutrition"]["protein"]["state"],
            "zero"
        );
        assert_eq!(
            changed.state["meals"][1]["nutrition"]["fiber"]["state"],
            "unknown"
        );
        assert!(changed.state["checkIns"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["complete"] == false));
        let summary = crate::domain_queries::period_summary(&c, &yesterday, &today).unwrap();
        assert_eq!(summary["days"][0]["mealCount"], 0);
        assert_eq!(summary["days"][1]["totals"]["calories"], 100.0);
        assert!(
            execute_with_connection(
                &mut c,
                request("correction-second", "revise_meal", input.clone(), None)
            )
            .unwrap()
            .replayed
        );
        let before = load_envelope(&c).unwrap();
        assert!(execute_with_connection(
            &mut c,
            request("correction-stale", "revise_meal", input, None)
        )
        .is_err());
        assert_eq!(load_envelope(&c).unwrap(), before);
        let new_id = changed.result["mealId"].clone();
        execute_with_connection(
            &mut c,
            request(
                "correction-void",
                "void_meal",
                json!({"mealId":new_id,"reason":"重复录入"}),
                None,
            ),
        )
        .unwrap();
        let summary = crate::domain_queries::period_summary(&c, &today, &today).unwrap();
        assert_eq!(summary["days"][0]["mealCount"], 0);
        assert!(summary["completedDayCalorieAverage"].is_null());
    }

    #[test]
    fn portion_correction_uses_the_original_food_version_even_after_library_revision() {
        let mut c = connection();
        let today = now_and_date().1;
        execute_with_connection(
            &mut c,
            request(
                "correct-food",
                "save_food_definition",
                food_payload(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let first=execute_with_connection(&mut c,request("correct-food-meal","record_food_meal",json!({"date":today,"type":"breakfast","entries":[{"foodVersionId":"food-version-correct-food","quantity":500,"unit":"g"}]}),None)).unwrap();
        let original = first.state["meals"][0].clone();
        let mut revision = food_payload();
        revision["foodId"] = json!("food-correct-food");
        revision["expectedVersionId"] = json!("food-version-correct-food");
        revision["input"]["nutrients"]["calories"] = json!(800);
        execute_with_connection(
            &mut c,
            request(
                "correct-food-new-version",
                "revise_food_definition",
                revision,
                None,
            ),
        )
        .unwrap();
        let result=execute_with_connection(&mut c,request("correct-food-portion","revise_meal",json!({"mealId":original["id"],"reason":"500 克误录，应为 50 克","date":today,"type":"breakfast","quantity":50,"unit":"g"}),None)).unwrap();
        assert_eq!(
            result.state["meals"][0]["foodSnapshot"],
            original["foodSnapshot"]
        );
        assert_eq!(
            result.state["meals"][1]["nutrition"]["calories"]["value"],
            200.0
        );
        assert_eq!(
            result.state["meals"][1]["foodSnapshot"]["version"]["id"],
            "food-version-correct-food"
        );
        assert_eq!(
            result.state["meals"][1]["foodSnapshot"]["definition"],
            original["foodSnapshot"]["definition"]
        );
        // OBS-011：纠错文案的单位必须是中文，历史 "50 g" 写法不再产生新记录。
        assert_eq!(
            result.state["meals"][1]["amountLabel"],
            "50 克 · 已纠错（沿用原营养版本）"
        );
        assert_eq!(
            crate::domain_queries::period_summary(&c, &today, &today).unwrap()["days"][0]["totals"]
                ["calories"],
            200.0
        );
    }

    fn recipe_payload(quantity: f64) -> Value {
        json!({"name":"自制燕麦","totalMinutes":10,"equipment":["电磁炉"],"ingredients":[{"foodVersionId":"food-version-recipe-food","quantity":quantity,"unit":"package"}]})
    }

    #[test]
    fn schema_8_upgrade_and_restart_keep_originals_and_correction_request_identity() {
        let directory =
            std::env::temp_dir().join(format!("fitwise-corrections-v9-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("fitwise.db");
        let mut c = Connection::open(&path).unwrap();
        let today = now_and_date().1;
        let first=execute_with_connection(&mut c,request("restart-meal-first","add_meal",json!({"name":"早餐","date":today,"type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),Some(bootstrap()))).unwrap();
        let id = first.state["meals"][0]["id"].clone();
        let before = load_envelope(&c).unwrap();
        // 模拟 0.8.x 旧库：视图缺失 + user_version 回退到 8，让 upgrade() 重放 0001–0013 再跑 0014。
        c.execute_batch("DROP VIEW domain_active_meal_projection; PRAGMA user_version = 8; INSERT INTO domain_upgrade_reports(version,report_json,created_at) VALUES(8,'{}','old');").unwrap();
        crate::domain_upgrade::upgrade(&mut c, &path).unwrap();
        assert_eq!(load_envelope(&c).unwrap(), before);
        assert!(c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM domain_upgrade_reports WHERE version=12)",
                [],
                |r| r.get::<_, bool>(0)
            )
            .unwrap());
        assert_eq!(
            std::fs::read_dir(directory.join("upgrade-backups"))
                .unwrap()
                .count(),
            1
        );
        let correction = json!({"mealId":id,"reason":"多记一倍","date":today,"type":"breakfast","name":"早餐","amountLabel":"半份","nutrients":{"calories":150,"protein":5}});
        let changed = execute_with_connection(
            &mut c,
            request(
                "restart-meal-revised",
                "revise_meal",
                correction.clone(),
                None,
            ),
        )
        .unwrap();
        let new_id = changed.result["mealId"].clone();
        drop(c);
        let mut c = Connection::open(&path).unwrap();
        assert!(
            execute_with_connection(
                &mut c,
                request("restart-meal-revised", "revise_meal", correction, None)
            )
            .unwrap()
            .replayed
        );
        assert_eq!(
            crate::domain_queries::period_summary(&c, &today, &today).unwrap()["days"][0]["totals"]
                ["calories"],
            150.0
        );
        let result = execute_with_connection(
            &mut c,
            request(
                "restart-meal-voided",
                "void_meal",
                json!({"mealId":new_id,"reason":"误录"}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(result.state["meals"].as_array().unwrap().len(), 2);
        drop(c);
        let c = Connection::open(&path).unwrap();
        let loaded: Value = serde_json::from_str(&load_envelope(&c).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["state"]["meals"][0]["status"], "superseded");
        assert_eq!(loaded["state"]["meals"][1]["status"], "void");
        assert_eq!(
            crate::domain_queries::period_summary(&c, &today, &today).unwrap()["days"][0]
                ["mealCount"],
            0
        );
        drop(c);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unknown_ingredient_nutrition_is_not_promoted_to_known_recipe_total() {
        let mut c = connection();
        execute_with_connection(
            &mut c,
            request(
                "recipe-food",
                "save_food_definition",
                food_payload(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let mut unknown = food_payload();
        unknown["input"]["nutrients"] = json!({"protein":0,"fiber":0});
        execute_with_connection(
            &mut c,
            request("recipe-unknown-food", "save_food_definition", unknown, None),
        )
        .unwrap();
        let mut input = recipe_payload(0.25);
        input["ingredients"].as_array_mut().unwrap().push(
            json!({"foodVersionId":"food-version-recipe-unknown-food","quantity":10,"unit":"g"}),
        );
        let saved = execute_with_connection(
            &mut c,
            request("recipe-unknown-total", "save_recipe_version", input, None),
        )
        .unwrap();
        let recipe = &saved.state["recipes"][1];
        assert_eq!(recipe["nutrition"]["calories"]["state"], "unknown");
        assert!(recipe["nutrition"]["calories"].get("value").is_none());
        assert_eq!(recipe["nutrition"]["protein"]["value"], 6.0);
        assert_eq!(recipe["nutrition"]["fiber"]["state"], "unknown");
    }

    #[test]
    fn custom_recipe_converts_portions_pins_versions_and_rejects_stale_edits() {
        let mut c = connection();
        execute_with_connection(
            &mut c,
            request(
                "recipe-food",
                "save_food_definition",
                food_payload(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let recipe = execute_with_connection(
            &mut c,
            request(
                "custom-recipe-first",
                "save_recipe_version",
                recipe_payload(0.25),
                None,
            ),
        )
        .unwrap();
        let version_id = recipe.result["recipeVersionId"].clone();
        let recipe_id = recipe.result["recipeId"].clone();
        let saved = recipe.state["recipes"][1].clone();
        assert_eq!(saved["ingredients"][0]["nutritionQuantity"], 0.25);
        assert_eq!(saved["ingredients"][0]["nutritionUnit"], "package");
        assert_eq!(saved["nutrition"]["calories"]["value"], 200.0);
        assert_eq!(saved["nutrition"]["fat"]["state"], "zero");
        assert_eq!(saved["nutrition"]["fiber"]["state"], "unknown");
        let mut revised = recipe_payload(0.5);
        revised["recipeId"] = recipe_id;
        revised["expectedVersionId"] = version_id.clone();
        let result = execute_with_connection(
            &mut c,
            request(
                "custom-recipe-second",
                "save_recipe_version",
                revised.clone(),
                None,
            ),
        )
        .unwrap();
        assert_eq!(result.state["recipes"][1], saved);
        assert_eq!(result.state["recipes"][2]["version"], 2);
        assert_eq!(
            result.state["recipes"][2]["nutrition"]["calories"]["value"],
            400.0
        );
        let before = load_envelope(&c).unwrap();
        assert!(execute_with_connection(
            &mut c,
            request("custom-recipe-stale", "save_recipe_version", revised, None)
        )
        .is_err());
        assert_eq!(load_envelope(&c).unwrap(), before);
        assert!(
            execute_with_connection(
                &mut c,
                request(
                    "custom-recipe-first",
                    "save_recipe_version",
                    recipe_payload(0.25),
                    None
                )
            )
            .unwrap()
            .replayed
        );
    }

    #[test]
    fn recipe_invalid_units_or_versions_roll_back_entire_operation() {
        let mut c = connection();
        execute_with_connection(
            &mut c,
            request(
                "recipe-food",
                "save_food_definition",
                food_payload(),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        execute_with_connection(
            &mut c,
            request(
                "recipe-other-food",
                "save_food_definition",
                food_payload(),
                None,
            ),
        )
        .unwrap();
        let before = load_envelope(&c).unwrap();
        for (id, field, value) in [
            ("recipe-bad-unit", "unit", json!("ml")),
            (
                "recipe-bad-version",
                "foodVersionId",
                json!("food-version-missing"),
            ),
            ("recipe-bad-quantity", "quantity", json!(0)),
        ] {
            let mut input = recipe_payload(0.25);
            input["ingredients"][0][field] = value;
            assert!(execute_with_connection(
                &mut c,
                request(id, "save_recipe_version", input, None)
            )
            .is_err());
            assert_eq!(load_envelope(&c).unwrap(), before);
        }
    }

    #[test]
    fn food_library_reopens_and_replays_without_changing_history() {
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

    fn bootstrap() -> String {
        let mut state = Map::new();
        state.insert("profile".into(), json!({"name":"test"}));
        for collection in [
            "foodDefinitions",
            "foodDefinitionVersions",
            "meals",
            "checkIns",
            "measurements",
            "workouts",
            "recipes",
            "auditEvents",
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
        assert!(first.applied);
        assert_eq!(second.state["measurements"].as_array().unwrap().len(), 2);
        assert_eq!(
            second.state["measurements"][0]["status"], "active",
            "同日第二次称重不再把旧值标成已修订"
        );
        assert_eq!(second.state["measurements"][1]["status"], "active");
        assert!(
            second.state["measurements"][0]
                .get("supersedesId")
                .is_none(),
            "同日多条互不覆盖"
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
    fn manual_meal_accepts_optional_macros_and_keeps_missing_ones_unknown() {
        let mut c = connection();
        let full = execute_with_connection(
            &mut c,
            request(
                "manual-meal-full",
                "add_meal",
                json!({
                    "name":"外食套餐","type":"lunch","amountLabel":"一份",
                    "calories":650,"protein":30,"fiber":6,
                    "carbohydrates":80,"fat":22,"sugar":9,"sodium":1200
                }),
                Some(bootstrap()),
            ),
        )
        .unwrap();
        let nutrition = &full.state["meals"][0]["nutrition"];
        for (key, value) in [
            ("carbohydrates", 80.0),
            ("fat", 22.0),
            ("sugar", 9.0),
            ("sodium", 1200.0),
        ] {
            assert_eq!(nutrition[key]["state"], "known", "{key} 应落为 known");
            assert_eq!(
                nutrition[key]["value"].as_f64(),
                Some(value),
                "{key} 数值不符"
            );
        }
        assert_eq!(nutrition["sodium"]["unit"], "mg");
        assert_eq!(
            full.state["meals"][0]["source"], "manual",
            "手记餐来源应为 manual"
        );

        let sparse = execute_with_connection(
            &mut c,
            request(
                "manual-meal-sparse",
                "add_meal",
                json!({"name":"只记热量","type":"snack","amountLabel":"一份","calories":120,"protein":4}),
                None,
            ),
        )
        .unwrap();
        let sparse_nutrition = &sparse.state["meals"][1]["nutrition"];
        for key in ["carbohydrates", "fat", "sugar", "sodium", "fiber"] {
            assert_eq!(
                sparse_nutrition[key]["state"], "unknown",
                "{key} 缺省必须是 unknown，不能当 0"
            );
            assert!(
                sparse_nutrition[key].get("value").is_none(),
                "{key} 缺省不能带 value"
            );
        }

        let zero = execute_with_connection(
            &mut c,
            request(
                "manual-meal-zero",
                "add_meal",
                json!({"name":"零糖饮料","type":"snack","amountLabel":"一瓶","calories":0,"protein":0,"sugar":0}),
                None,
            ),
        )
        .unwrap();
        assert_eq!(
            zero.state["meals"][2]["nutrition"]["sugar"]["state"],
            "zero"
        );

        let negative = execute_with_connection(
            &mut c,
            request(
                "manual-meal-negative",
                "add_meal",
                json!({"name":"错值","type":"lunch","amountLabel":"一份","calories":300,"protein":10,"sodium":-1}),
                None,
            ),
        );
        let error = negative.unwrap_err();
        assert!(
            error.contains("钠不能小于 0"),
            "负数营养必须被拒绝，实际：{error}"
        );
        let stored: Value = serde_json::from_str(&load_envelope(&c).unwrap().unwrap()).unwrap();
        assert_eq!(
            stored["state"]["meals"].as_array().unwrap().len(),
            3,
            "被拒绝的提交不能落库"
        );
    }
}
