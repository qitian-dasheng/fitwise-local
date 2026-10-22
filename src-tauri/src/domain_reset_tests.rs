//! 重置命令（reset_domain_records）的自动化覆盖：
//! 保留规则、失效引用处置、事务回滚、重启一致性、重置后可保存性。

use crate::domain_store::{
    ensure_repository_schema, load_envelope, persist_envelope,
    reset_domain_records_with_connection, STORAGE_NAME,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn connection() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .unwrap();
    ensure_repository_schema(&connection).unwrap();
    connection
}

fn nutrition_facts() -> Value {
    let metric = |value: f64| json!({"state":"known","value":value,"unit":"kcal","source":"personal","confidence":"high"});
    json!({
        "calories": metric(165.0),
        "protein": metric(20.0),
        "carbohydrates": metric(6.0),
        "fat": metric(8.0),
        "fiber": metric(0.5),
        "sugar": metric(1.0),
        "sodium": metric(300.0),
    })
}

fn version(id: &str, food_id: &str) -> Value {
    json!({
        "id": id,
        "foodId": food_id,
        "version": 1,
        "basis": {"quantity": 100.0, "unit": "g"},
        "energyUnit": "kcal",
        "labelNutrients": {},
        "conversions": [],
        "nutrition": nutrition_facts(),
        "source": "personal",
        "confirmedBy": "测试",
        "confirmedAt": "2026-10-23T00:00:00+08:00",
    })
}

/// 造一个带完整业务记录的 0.9.0 形态状态：2 食材 / 3 版本（1 孤儿）/ 2 菜谱（1 失效）/ 全套测试记录。
fn seeded_state() -> String {
    json!({
        "state": {
            "profile": {
                "name": "真实用户",
                "sex": "male",
                "age": 22,
                "heightCm": 172,
                "startWeightKg": 83,
                "targetWeightKg": 74,
                "timezone": "Asia/Shanghai",
                "dailyCalories": {"min": 1950, "target": 2000, "max": 2050},
                "proteinTargetG": 160,
                "fiberTargetG": 25,
                "equipment": ["电磁炉", "基础锅具"],
            },
            "foodDefinitions": [
                {"id": "food-a", "name": "测试食材甲", "measurementBasis": "raw", "activeVersionId": "v-a1", "favorite": false, "createdAt": "2026-10-01T00:00:00+08:00"},
                {"id": "food-b", "name": "测试食材乙", "measurementBasis": "raw", "activeVersionId": "v-b1", "favorite": false, "createdAt": "2026-10-01T00:00:00+08:00"},
            ],
            "foodDefinitionVersions": [
                version("v-a1", "food-a"),
                version("v-b1", "food-b"),
                version("v-orphan", "food-missing"),
            ],
            "meals": [
                {"id": "meal-1", "date": "2026-10-20", "type": "lunch", "name": "测试午餐"},
                {"id": "meal-2", "date": "2026-10-21", "type": "dinner", "name": "测试晚餐"},
            ],
            "checkIns": [{"date": "2026-10-20", "complete": true}],
            "measurements": [{"id": "weight-1", "date": "2026-10-20", "weightKg": 83.8, "status": "active"}],
            "workouts": [{"id": "workout-1", "date": "2026-10-20", "durationMinutes": 22, "caloriesKcal": 169, "status": "active"}],
            "recipes": [
                {
                    "id": "recipe-valid-1", "recipeId": "recipe-valid", "name": "有效菜谱", "version": 1,
                    "ingredients": [{"foodId": "food-a", "name": "测试食材甲", "amount": 300, "unit": "g", "measurementBasis": "raw", "foodVersionId": "v-a1"}],
                    "nutrition": {"calories": {"state": "known", "value": 495.0, "unit": "kcal"}},
                    "totalMinutes": 30, "equipment": ["电磁炉"], "source": "personal",
                    "createdAt": "2026-10-02T00:00:00+08:00",
                },
                {
                    "id": "recipe-dangling-1", "recipeId": "recipe-dangling", "name": "失效菜谱", "version": 1,
                    "ingredients": [{"foodId": "food-x", "name": "不存在的食材", "amount": 100, "unit": "g", "measurementBasis": "raw", "foodVersionId": "v-none"}],
                    "nutrition": {"calories": {"state": "known", "value": 100.0, "unit": "kcal"}},
                    "totalMinutes": 10, "equipment": ["电磁炉"], "source": "personal",
                    "createdAt": "2026-10-02T00:00:00+08:00",
                },
            ],
            "auditEvents": [{"id": "audit-1", "eventType": "add_meal", "entityType": "meal", "payload": {}, "createdAt": "2026-10-20T00:00:00+08:00"}],
        },
        "version": 4,
    })
    .to_string()
}

fn seed(connection: &mut Connection) {
    persist_envelope(connection, STORAGE_NAME, &seeded_state()).unwrap();
    connection
        .execute(
            "INSERT INTO domain_command_receipts (command_id, command_kind, result_json, applied_revision, created_at) VALUES ('cmd-1', 'add_meal', '{}', 1, 'now')",
            params![],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO domain_command_payloads (command_id, request_sha256) VALUES ('cmd-1', 'hash-1')",
            params![],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO domain_upgrade_reports (version, report_json, created_at) VALUES (14, '{\"reconciled\":true}', 'now')",
            params![],
        )
        .unwrap();
}

fn count(connection: &Connection, sql: &str) -> i64 {
    connection.query_row(sql, [], |row| row.get(0)).unwrap()
}

#[test]
fn reset_keeps_valid_library_recipes_and_profile_and_clears_records() {
    let mut connection = connection();
    seed(&mut connection);

    let result = reset_domain_records_with_connection(&mut connection).unwrap();
    let state = result.state.as_object().unwrap();
    let summary = &result.summary;

    // 业务记录全部清空。
    for key in [
        "meals",
        "checkIns",
        "measurements",
        "workouts",
        "auditEvents",
    ] {
        assert_eq!(state[key], json!([]), "{key} 应被清空");
    }
    // 食材库与有效营养版本完整保留，孤儿版本剔除。
    assert_eq!(state["foodDefinitions"].as_array().unwrap().len(), 2);
    let versions = state["foodDefinitionVersions"].as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert!(versions.iter().all(|item| item["foodId"] != "food-missing"));
    // 菜谱：有效保留、失效剔除并记名。
    let recipes = state["recipes"].as_array().unwrap();
    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0]["name"], "有效菜谱");
    assert_eq!(summary.dropped_recipes, vec!["失效菜谱".to_string()]);
    assert_eq!(summary.dropped_food_versions, 1);
    // 个人目标原样保留。
    assert_eq!(state["profile"]["name"], "真实用户");
    assert_eq!(state["profile"]["targetWeightKg"], 74);
    assert_eq!(state["profile"]["dailyCalories"]["target"], 2000);
    // 摘要计数。
    assert_eq!(summary.kept_food_definitions, 2);
    assert_eq!(summary.kept_food_definition_versions, 2);
    assert_eq!(summary.kept_recipes, 1);
    assert_eq!(summary.cleared_meals, 2);
    assert_eq!(summary.cleared_check_ins, 1);
    assert_eq!(summary.cleared_measurements, 1);
    assert_eq!(summary.cleared_workouts, 1);
    assert_eq!(summary.cleared_audit_events, 1);
    assert_eq!(summary.cleared_command_receipts, 1);

    // 数据库侧：回执/负载清空，升级诊断保留，迁移版本不动。
    assert_eq!(
        count(&connection, "SELECT COUNT(*) FROM domain_command_receipts"),
        0
    );
    assert_eq!(
        count(&connection, "SELECT COUNT(*) FROM domain_command_payloads"),
        0
    );
    assert_eq!(
        count(&connection, "SELECT COUNT(*) FROM domain_upgrade_reports"),
        1
    );
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM app_kv"), 0);
    assert_eq!(count(&connection, "PRAGMA user_version"), 14);
    // 信封可往返，修订号继续递增。
    let loaded = load_envelope(&connection).unwrap().unwrap();
    let loaded: Value = serde_json::from_str(&loaded).unwrap();
    assert_eq!(loaded["version"], 4);
    assert_eq!(loaded["state"]["meals"], json!([]));
    let revision: i64 = connection
        .query_row(
            "SELECT revision FROM domain_state_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(revision > 1);
}

#[test]
fn reset_failure_rolls_back_and_keeps_original_records() {
    let mut connection = connection();
    seed(&mut connection);
    // 注入一个缺少稳定标识的实体：write_transaction 的 entity_id 会失败。
    connection
        .execute(
            "INSERT INTO domain_entities (collection, entity_id, payload_json, sort_index, updated_at) VALUES ('foodDefinitions', 'food-bad', '{\"name\":\"没有ID\"}', 99, 'now')",
            params![],
        )
        .unwrap();

    assert!(reset_domain_records_with_connection(&mut connection).is_err());

    // 回滚后重置前的数据原样还在。
    let loaded = load_envelope(&connection).unwrap().unwrap();
    let loaded: Value = serde_json::from_str(&loaded).unwrap();
    assert_eq!(loaded["state"]["meals"].as_array().unwrap().len(), 2);
    assert_eq!(loaded["state"]["recipes"].as_array().unwrap().len(), 2);
    assert_eq!(
        count(&connection, "SELECT COUNT(*) FROM domain_command_receipts"),
        1
    );
    assert_eq!(
        count(&connection, "SELECT COUNT(*) FROM domain_command_payloads"),
        1
    );
    assert_eq!(count(&connection, "SELECT COUNT(*) FROM app_kv"), 0);
}

#[test]
fn reset_is_stable_after_restart_and_keeps_diagnostics() {
    let directory = std::env::temp_dir().join(format!("fitwise-reset-{}", rand::random::<u64>()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("fitwise.db");
    let after_reset = {
        let mut connection = Connection::open(&path).unwrap();
        ensure_repository_schema(&connection).unwrap();
        seed(&mut connection);
        let result = reset_domain_records_with_connection(&mut connection).unwrap();
        serde_json::to_string(&result.state).unwrap()
    };

    // 重启：重开连接 + ensure（不重放迁移），信封与重置后一致。
    let connection = Connection::open(&path).unwrap();
    ensure_repository_schema(&connection).unwrap();
    let loaded = load_envelope(&connection).unwrap().unwrap();
    let loaded: Value = serde_json::from_str(&loaded).unwrap();
    assert_eq!(
        serde_json::to_string(&loaded["state"]).unwrap(),
        after_reset
    );
    assert_eq!(
        count(&connection, "SELECT COUNT(*) FROM domain_command_receipts"),
        0
    );
    assert_eq!(
        count(&connection, "SELECT COUNT(*) FROM domain_upgrade_reports"),
        1
    );
    assert_eq!(count(&connection, "PRAGMA user_version"), 14);
    drop(connection);
    std::fs::remove_dir_all(&directory).unwrap();
}

#[test]
fn reset_result_recipes_are_savable_while_dangling_refs_are_rejected() {
    let mut connection = connection();
    seed(&mut connection);
    let result = reset_domain_records_with_connection(&mut connection).unwrap();
    let mut state = result.state.as_object().unwrap().clone();

    // 保留菜谱引用的版本可用于新菜谱保存（证明重置后菜谱仍可编辑/保存）。
    let payload = json!({
        "name": "重置后新菜谱",
        "totalMinutes": 20,
        "equipment": ["电磁炉"],
        "ingredients": [{"foodVersionId": "v-a1", "quantity": 150.0, "unit": "g"}],
    });
    let mutation = crate::recipes::apply(&mut state, &payload, "cmd-after-reset").unwrap();
    assert!(mutation.applied);
    let recipes = state["recipes"].as_array().unwrap();
    assert_eq!(recipes.len(), 2);
    assert_eq!(recipes[1]["name"], "重置后新菜谱");

    // 失效引用仍然被 Rust 拒绝——这正是重置时整体剔除失效菜谱的原因。
    let dangling = json!({
        "name": "引用失效的菜谱",
        "totalMinutes": 20,
        "equipment": ["电磁炉"],
        "ingredients": [{"foodVersionId": "v-none", "quantity": 100.0, "unit": "g"}],
    });
    let error = crate::recipes::apply(&mut state, &dangling, "cmd-dangling").unwrap_err();
    assert!(error.contains("找不到营养版本"), "实际错误：{error}");
}

#[test]
fn reset_without_initialized_repository_returns_error() {
    let mut connection = connection();
    let error = reset_domain_records_with_connection(&mut connection).unwrap_err();
    assert!(error.contains("尚未初始化"), "实际错误：{error}");
    assert!(load_envelope(&connection).unwrap().is_none());
}
