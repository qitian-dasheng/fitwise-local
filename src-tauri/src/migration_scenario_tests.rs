// 0.9.0 三场景迁移验证：全新空库 / 0.8.1 旧库升级 / 升级后再次启动。
// 判据（用户 2026-10-22 确认）：
//   1. 0014 只删已废弃的表/视图/索引/集合数据，不动核心领域集合；
//   2. 旧库升级不丢核心数据，废弃集合数据被清掉；
//   3. 升级后再次启动不重放迁移、数据与命令幂等不受影响。

use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

use crate::domain_store::{ensure_repository_schema, load_envelope};

const DEPRECATED_TABLES: &[&str] = &[
    "meal_entries",
    "consumption_events",
    "waste_events",
    "inventory_movements",
    "input_receipts",
    "prepared_batches",
    "inventory_lots",
    "recipe_versions",
    "purchase_lots",
    "input_artifact_objects",
    "audit_events",
    "input_artifacts",
    "food_definitions",
    "daily_checkins",
    "body_measurements",
    "workout_sessions",
    "meal_plans",
    "preference_feedback",
    "consent_grants",
    "input_artifact_audit",
    "nutrition_label_drafts",
    "menu_drafts",
];

const DEPRECATED_VIEWS: &[&str] = &[
    "domain_meal_projection",
    "domain_food_library_projection",
    "domain_inventory_projection",
    "domain_purchase_projection",
];

const DEPRECATED_INDEXES: &[&str] = &[
    "idx_domain_inventory_purchase",
    "idx_domain_food_version_meals",
];

const CORE_TABLES: &[&str] = &[
    "domain_entities",
    "domain_singletons",
    "domain_state_meta",
    "domain_command_receipts",
    "domain_upgrade_reports",
];

const DEPRECATED_COLLECTIONS: &[&str] = &[
    "batches",
    "consumptionEvents",
    "wasteEvents",
    "inventory",
    "inventoryMovements",
    "purchases",
    "inbox",
    "plans",
];

fn object_exists(connection: &Connection, kind: &str, name: &str) -> bool {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2)",
            [kind, name],
            |row| row.get::<_, bool>(0),
        )
        .unwrap()
}

fn user_version(connection: &Connection) -> i64 {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

fn entity_collections(connection: &Connection) -> Vec<String> {
    let mut statement = connection
        .prepare("SELECT DISTINCT collection FROM domain_entities ORDER BY collection")
        .unwrap();
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows
}

fn singleton_keys(connection: &Connection) -> Vec<String> {
    let mut statement = connection
        .prepare("SELECT key FROM domain_singletons ORDER BY key")
        .unwrap();
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows
}

fn object_names(connection: &Connection, kind: &str) -> Vec<String> {
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = ?1 AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .unwrap();
    let rows = statement
        .query_map([kind], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows
}

/// 0.9.1 守卫：SQL 对象清单与 user_version 冻结。
/// 业务数据全部走 JSON 信封；任何新表/视图/索引都必须先改这个测试并说明理由，
/// 防止“顺手加个投影表”把零迁移承诺悄悄破坏掉。
#[test]
fn schema_inventory_stays_frozen_for_0_9_1() {
    let directory =
        std::env::temp_dir().join(format!("fitwise-migrate-guard-{}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("fitwise.db");
    let connection = Connection::open(&path).unwrap();
    ensure_repository_schema(&connection).unwrap();

    assert_eq!(user_version(&connection), 14);
    assert_eq!(
        object_names(&connection, "table"),
        vec![
            "app_kv",
            "domain_command_payloads",
            "domain_command_receipts",
            "domain_entities",
            "domain_singletons",
            "domain_state_meta",
            "domain_upgrade_reports",
        ]
    );
    assert_eq!(
        object_names(&connection, "view"),
        vec![
            "domain_active_meal_projection",
            "domain_checkin_projection",
            "domain_measurement_projection",
            "domain_workout_projection",
        ]
    );
    assert_eq!(
        object_names(&connection, "index"),
        vec!["idx_domain_command_receipts_created", "idx_domain_entities_order"]
    );

    drop(connection);
    fs::remove_dir_all(&directory).unwrap();
}

/// 直接重放 0001–0013（不设 user_version），模拟 0.8.1 及更早版本的物理库。
fn build_legacy_database(path: &Path) -> Connection {
    let connection = Connection::open(path).unwrap();
    for sql in [
        include_str!("../migrations/0001_schema.sql"),
        include_str!("../migrations/0002_batch_events.sql"),
        include_str!("../migrations/0003_domain_entity_store.sql"),
        include_str!("../migrations/0004_domain_commands.sql"),
        include_str!("../migrations/0005_queries_and_request_identity.sql"),
        include_str!("../migrations/0006_food_library.sql"),
        include_str!("../migrations/0007_inventory_operations.sql"),
        include_str!("../migrations/0008_input_artifacts.sql"),
        include_str!("../migrations/0009_meal_corrections.sql"),
        include_str!("../migrations/0010_label_drafts.sql"),
        include_str!("../migrations/0011_measurement_conditions.sql"),
        include_str!("../migrations/0012_workout_corrections.sql"),
        include_str!("../migrations/0013_menu_drafts.sql"),
    ] {
        connection.execute_batch(sql).unwrap();
    }
    // 0.8.1 从不写 user_version（门闩是 0.9.0 引入的），保持 0 即真实旧库状态。
    connection.execute_batch("PRAGMA user_version = 0").unwrap();
    connection
}

#[test]
fn scenario_1_fresh_database_has_only_core_schema() {
    let directory =
        std::env::temp_dir().join(format!("fitwise-migrate-s1-{}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("fitwise.db");
    let connection = Connection::open(&path).unwrap();
    ensure_repository_schema(&connection).unwrap();

    assert_eq!(user_version(&connection), 14);
    for table in CORE_TABLES {
        assert!(
            object_exists(&connection, "table", table),
            "核心表缺失：{table}"
        );
    }
    // 0009 的活跃餐食投影是运行时代码在用的核心视图，必须保留。
    assert!(object_exists(
        &connection,
        "view",
        "domain_active_meal_projection"
    ));
    for table in DEPRECATED_TABLES {
        assert!(
            !object_exists(&connection, "table", table),
            "废弃表未被删除：{table}"
        );
    }
    for view in DEPRECATED_VIEWS {
        assert!(
            !object_exists(&connection, "view", view),
            "废弃视图未被删除：{view}"
        );
    }
    for index in DEPRECATED_INDEXES {
        assert!(
            !object_exists(&connection, "index", index),
            "废弃索引未被删除：{index}"
        );
    }
    // 全新库没有任何领域数据。
    assert!(load_envelope(&connection).unwrap().is_none());
    assert!(entity_collections(&connection).is_empty());
    assert!(singleton_keys(&connection).is_empty());

    drop(connection);
    fs::remove_dir_all(&directory).unwrap();
}

#[test]
fn scenario_2_legacy_081_database_upgrade_keeps_core_and_drops_deprecated() {
    let directory =
        std::env::temp_dir().join(format!("fitwise-migrate-s2-{}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("fitwise.db");
    let mut connection = build_legacy_database(&path);
    assert_eq!(user_version(&connection), 0);

    // 0.8.1 形态的完整状态：8 个核心集合 + 8 个废弃集合 + aiSettings 单例。
    let mut state = serde_json::Map::new();
    state.insert("profile".into(), json!({"name":"迁移验证"}));
    for key in [
        "foodDefinitions",
        "foodDefinitionVersions",
        "meals",
        "checkIns",
        "measurements",
        "workouts",
        "recipes",
        "auditEvents",
    ] {
        state.insert(key.into(), json!([]));
    }
    state.insert(
        "meals".into(),
        json!([{"id":"legacy-meal-1","date":"2026-10-20","type":"lunch","name":"旧库午餐","nutrition":{"calories":{"state":"known","value":650,"unit":"kcal"}},"consumedRatio":1.0}]),
    );
    state.insert(
        "auditEvents".into(),
        json!([{"id":"legacy-audit-1","eventType":"add_meal","entityType":"meal","entityId":"legacy-meal-1"}]),
    );
    for key in DEPRECATED_COLLECTIONS {
        state.insert((*key).into(), json!([{"id":format!("legacy-{key}")}]));
    }
    let transaction = connection.transaction().unwrap();
    crate::domain_store::write_transaction(
        &transaction,
        &state,
        4,
        "legacy-hash",
        "2026-10-20T00:00:00Z",
    )
    .unwrap();
    // 0.8.1 的 write_transaction 写的是 16 个集合；废弃集合行只能直接插，模拟真实旧库。
    for collection in DEPRECATED_COLLECTIONS {
        transaction
            .execute(
                "INSERT INTO domain_entities (collection, entity_id, payload_json, sort_index, updated_at) VALUES (?1, ?2, '{}', 99, '2026-10-20T00:00:00Z')",
                rusqlite::params![collection, format!("legacy-{collection}")],
            )
            .unwrap();
    }
    transaction
        .execute(
            "INSERT INTO domain_singletons (key, payload_json, updated_at) VALUES ('aiSettings', '{}', '2026-10-20T00:00:00Z')",
            [],
        )
        .unwrap();
    transaction.commit().unwrap();

    // 升级：新代码首次打开旧库。
    ensure_repository_schema(&connection).unwrap();

    // 废弃物理对象全部清掉。
    for table in DEPRECATED_TABLES {
        assert!(
            !object_exists(&connection, "table", table),
            "升级后废弃表仍在：{table}"
        );
    }
    for view in DEPRECATED_VIEWS {
        assert!(
            !object_exists(&connection, "view", view),
            "升级后废弃视图仍在：{view}"
        );
    }
    for index in DEPRECATED_INDEXES {
        assert!(
            !object_exists(&connection, "index", index),
            "升级后废弃索引仍在：{index}"
        );
    }
    assert_eq!(user_version(&connection), 14);
    // 废弃集合数据与 aiSettings 单例被清掉，核心数据一条不少。
    // 注意：空集合在 domain_entities 里本就没有行，只能按“有数据的集合”断言。
    let collections = entity_collections(&connection);
    for collection in DEPRECATED_COLLECTIONS {
        assert!(
            !collections.iter().any(|c| c == collection),
            "升级后废弃集合数据仍在：{collection}"
        );
    }
    assert!(
        collections.contains(&"meals".to_owned()),
        "核心集合 meals 数据丢失"
    );
    assert!(
        collections.contains(&"auditEvents".to_owned()),
        "核心集合 auditEvents 数据丢失"
    );
    assert_eq!(singleton_keys(&connection), vec!["profile".to_owned()]);
    // 核心数据原样保留。
    let envelope: Value =
        serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
    assert_eq!(envelope["version"], 4);
    assert_eq!(envelope["state"]["meals"][0]["id"], "legacy-meal-1");
    assert_eq!(
        envelope["state"]["meals"][0]["nutrition"]["calories"]["value"],
        650.0
    );
    assert_eq!(envelope["state"]["auditEvents"][0]["id"], "legacy-audit-1");

    drop(connection);
    fs::remove_dir_all(&directory).unwrap();
}

#[test]
fn scenario_3_restart_after_upgrade_is_stable_and_data_intact() {
    let directory =
        std::env::temp_dir().join(format!("fitwise-migrate-s3-{}", rand::random::<u64>()));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("fitwise.db");
    let mut connection = build_legacy_database(&path);
    let mut state = serde_json::Map::new();
    state.insert("profile".into(), json!({"name":"重启验证"}));
    for key in [
        "foodDefinitions",
        "foodDefinitionVersions",
        "meals",
        "checkIns",
        "measurements",
        "workouts",
        "recipes",
        "auditEvents",
    ] {
        state.insert(key.into(), json!([]));
    }
    state.insert(
        "meals".into(),
        json!([{"id":"restart-meal-1","date":"2026-10-20","type":"breakfast","name":"升级前早餐","nutrition":{"calories":{"state":"known","value":420,"unit":"kcal"}}}]),
    );
    let transaction = connection.transaction().unwrap();
    crate::domain_store::write_transaction(
        &transaction,
        &state,
        4,
        "restart-hash",
        "2026-10-20T00:00:00Z",
    )
    .unwrap();
    transaction.commit().unwrap();

    ensure_repository_schema(&connection).unwrap();
    let after_first = load_envelope(&connection).unwrap().unwrap();
    let entity_count_after_upgrade: i64 = connection
        .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get(0))
        .unwrap();
    drop(connection);

    // 升级后再次启动（全新连接，模拟重开应用）。
    let connection = Connection::open(&path).unwrap();
    ensure_repository_schema(&connection).unwrap();
    assert_eq!(user_version(&connection), 14);
    assert_eq!(load_envelope(&connection).unwrap().unwrap(), after_first);
    let entity_count_after_restart: i64 = connection
        .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get(0))
        .unwrap();
    assert_eq!(entity_count_after_restart, entity_count_after_upgrade);
    // 升级报告表存在且可写（后续 upgrade() 对账依赖它）。
    assert!(object_exists(
        &connection,
        "table",
        "domain_upgrade_reports"
    ));
    // 重启后命令接收表仍在（幂等回执的载体）。
    assert!(object_exists(
        &connection,
        "table",
        "domain_command_receipts"
    ));
    // 核心数据完整：档案单例与升级前的餐食都在。
    let envelope: Value =
        serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
    assert_eq!(envelope["state"]["profile"]["name"], "重启验证");
    assert_eq!(envelope["state"]["meals"][0]["id"], "restart-meal-1");
    drop(connection);
    fs::remove_dir_all(&directory).unwrap();
}
