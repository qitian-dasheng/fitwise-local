use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) const STORAGE_NAME: &str = "fitwise-app-state-v1";
const SINGLETONS: [&str; 2] = ["profile", "aiSettings"];
const COLLECTIONS: [&str; 16] = [
    "foodDefinitions",
    "foodDefinitionVersions",
    "meals",
    "checkIns",
    "measurements",
    "workouts",
    "recipes",
    "batches",
    "consumptionEvents",
    "wasteEvents",
    "auditEvents",
    "inventory",
    "inventoryMovements",
    "purchases",
    "inbox",
    "plans",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainStorageStatus {
    initialized: bool,
    persist_version: Option<i64>,
    revision: Option<i64>,
    entity_count: i64,
    command_count: i64,
    updated_at: Option<String>,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(directory.join("fitwise.db"))
}

pub(crate) fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let mut connection =
        Connection::open(&path).map_err(|error| format!("无法打开领域数据库：{error}"))?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
        .map_err(|error| format!("无法配置领域数据库：{error}"))?;
    crate::domain_upgrade::upgrade(&mut connection, &path)?;
    Ok(connection)
}

pub(crate) fn ensure_repository_schema(connection: &Connection) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    apply_repository_schema(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn apply_repository_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(include_str!("../migrations/0001_schema.sql"))
        .map_err(|error| error.to_string())?;
    let has_batch_status: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('prepared_batches') WHERE name = 'remaining_ratio')", [], |row| row.get(0)
    ).map_err(|error| error.to_string())?;
    if !has_batch_status {
        connection
            .execute_batch(include_str!("../migrations/0002_batch_events.sql"))
            .map_err(|error| error.to_string())?;
    }
    for sql in [
        include_str!("../migrations/0003_domain_entity_store.sql"),
        include_str!("../migrations/0004_domain_commands.sql"),
        include_str!("../migrations/0005_queries_and_request_identity.sql"),
        include_str!("../migrations/0006_food_library.sql"),
        include_str!("../migrations/0007_inventory_operations.sql"),
        include_str!("../migrations/0008_input_artifacts.sql"),
        include_str!("../migrations/0009_meal_corrections.sql"),
    ] {
        connection
            .execute_batch(sql)
            .map_err(|error| format!("无法初始化领域仓库：{error}"))?;
    }
    Ok(())
}

fn entity_id(collection: &str, value: &Value) -> Result<String, String> {
    value
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| {
            (collection == "checkIns")
                .then(|| value.get("date").and_then(Value::as_str))
                .flatten()
        })
        .map(str::to_owned)
        .ok_or_else(|| format!("{collection} 中存在缺少稳定标识的实体。"))
}

fn persist_envelope(connection: &mut Connection, name: &str, raw: &str) -> Result<(), String> {
    if name != STORAGE_NAME {
        return Err("未知的领域存储名称。".into());
    }
    let envelope: Value =
        serde_json::from_str(raw).map_err(|error| format!("状态 JSON 无效：{error}"))?;
    let persist_version = envelope
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "状态缺少持久化版本。".to_string())?;
    let state = envelope
        .get("state")
        .and_then(Value::as_object)
        .ok_or_else(|| "状态缺少领域对象。".to_string())?;
    for key in SINGLETONS {
        if !state.contains_key(key) {
            return Err(format!("状态缺少 {key}。"));
        }
    }
    for collection in COLLECTIONS {
        if !state.get(collection).is_some_and(Value::is_array) {
            return Err(format!("状态集合 {collection} 无效。"));
        }
    }

    let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
    let now = Utc::now().to_rfc3339();
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    write_transaction(&transaction, state, persist_version, &hash, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("提交领域事务失败：{error}"))
}

pub(crate) fn write_transaction(
    transaction: &Transaction<'_>,
    state: &Map<String, Value>,
    persist_version: i64,
    hash: &str,
    now: &str,
) -> Result<(), String> {
    transaction
        .execute("DELETE FROM domain_singletons", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_entities", [])
        .map_err(|error| error.to_string())?;

    for key in SINGLETONS {
        let payload = serde_json::to_string(&state[key]).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO domain_singletons (key, payload_json, updated_at) VALUES (?1, ?2, ?3)",
                params![key, payload, now],
            )
            .map_err(|error| format!("写入 {key} 失败：{error}"))?;
    }

    for collection in COLLECTIONS {
        let values = state[collection].as_array().expect("validated collection");
        for (index, value) in values.iter().enumerate() {
            let id = entity_id(collection, value)?;
            let payload = serde_json::to_string(value).map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO domain_entities (collection, entity_id, payload_json, sort_index, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![collection, id, payload, index as i64, now],
                )
                .map_err(|error| format!("写入 {collection}/{id} 失败：{error}"))?;
        }
    }

    let revision: i64 = transaction
        .query_row(
            "SELECT revision FROM domain_state_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0)
        + 1;
    transaction
        .execute(
            "INSERT INTO domain_state_meta (id, persist_version, revision, content_sha256, updated_at) VALUES (1, ?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET persist_version = excluded.persist_version, revision = excluded.revision, content_sha256 = excluded.content_sha256, updated_at = excluded.updated_at",
            params![persist_version, revision, hash, now],
        )
        .map_err(|error| format!("更新领域仓库版本失败：{error}"))?;
    Ok(())
}

pub(crate) fn load_envelope(connection: &Connection) -> Result<Option<String>, String> {
    // Hydration and exports must see one revision even if another process writes.
    if connection.is_autocommit() {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        return read_envelope(&transaction);
    }
    read_envelope(connection)
}

fn read_envelope(connection: &Connection) -> Result<Option<String>, String> {
    let version: Option<i64> = connection
        .query_row(
            "SELECT persist_version FROM domain_state_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(version) = version else {
        return Ok(None);
    };

    let mut state = Map::new();
    for key in SINGLETONS {
        let raw: String = connection
            .query_row(
                "SELECT payload_json FROM domain_singletons WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .map_err(|error| format!("读取 {key} 失败：{error}"))?;
        state.insert(
            key.into(),
            serde_json::from_str(&raw).map_err(|error| error.to_string())?,
        );
    }
    for collection in COLLECTIONS {
        let mut statement = connection
            .prepare("SELECT payload_json FROM domain_entities WHERE collection = ?1 ORDER BY sort_index")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([collection], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let mut values = Vec::new();
        for row in rows {
            values.push(
                serde_json::from_str(&row.map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?,
            );
        }
        state.insert(collection.into(), Value::Array(values));
    }
    serde_json::to_string(&serde_json::json!({ "state": state, "version": version }))
        .map(Some)
        .map_err(|error| error.to_string())
}

pub(crate) fn import_legacy_state(
    connection: &mut Connection,
    name: &str,
) -> Result<Option<String>, String> {
    let legacy: Option<String> = connection
        .query_row("SELECT value FROM app_kv WHERE key = ?1", [name], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(raw) = legacy {
        let normalized = normalize_legacy_envelope(&raw)?;
        persist_envelope(connection, name, &normalized)?;
        return Ok(Some(normalized));
    }
    Ok(None)
}

pub(crate) fn normalize_legacy_envelope(raw: &str) -> Result<String, String> {
    let mut envelope: Value = serde_json::from_str(raw).map_err(|error| error.to_string())?;
    let version = envelope["version"].as_i64().ok_or("状态缺少版本。")?;
    if version == 4 {
        return Ok(raw.to_owned());
    }
    if version != 2 && version != 3 {
        return Err("此持久化版本暂不受支持，请保留原数据库并检查升级路径。".into());
    }
    let state = envelope
        .get_mut("state")
        .and_then(Value::as_object_mut)
        .ok_or("旧版状态无效。")?;
    for key in ["foodDefinitions", "foodDefinitionVersions"] {
        state.entry(key).or_insert_with(|| serde_json::json!([]));
    }
    if version == 2 {
        for key in ["consumptionEvents", "wasteEvents", "auditEvents"] {
            state.entry(key).or_insert_with(|| serde_json::json!([]));
        }
        if let Some(batches) = state.get_mut("batches").and_then(Value::as_array_mut) {
            for batch in batches {
                let consumed = batch["consumedRatio"].as_f64().unwrap_or(0.0);
                let wasted = batch["wastedRatio"].as_f64().unwrap_or(0.0);
                let remaining = batch["remainingRatio"]
                    .as_f64()
                    .unwrap_or((1.0 - consumed - wasted).max(0.0));
                batch["remainingRatio"] = serde_json::json!(remaining);
                batch["status"] =
                    serde_json::json!(if remaining > 0.0 { "open" } else { "closed" });
            }
        }
        if let Some(measurements) = state.get_mut("measurements").and_then(Value::as_array_mut) {
            for measurement in measurements {
                if measurement.get("status").is_none() {
                    measurement["status"] = serde_json::json!("active");
                }
            }
        }
    }
    envelope["version"] = serde_json::json!(4);
    serde_json::to_string(&envelope).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn domain_storage_get(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if name != STORAGE_NAME {
        return Ok(None);
    }
    let mut connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    if let Some(value) = load_envelope(&connection)? {
        return Ok(Some(value));
    }
    import_legacy_state(&mut connection, &name)
}

#[tauri::command]
pub fn domain_storage_set(app: AppHandle, name: String, value: String) -> Result<(), String> {
    let mut connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    if load_envelope(&connection)?.is_some() {
        return Err("领域仓库已初始化，请通过业务命令保存记录。".into());
    }
    persist_envelope(&mut connection, &name, &value)
}

#[tauri::command]
pub fn domain_storage_remove(app: AppHandle, name: String) -> Result<(), String> {
    if name != STORAGE_NAME {
        return Ok(());
    }
    let mut connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_entities", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_singletons", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_state_meta", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_command_payloads", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM domain_command_receipts", [])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM app_kv WHERE key = ?1", [&name])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_domain_storage_status(app: AppHandle) -> Result<DomainStorageStatus, String> {
    let connection = open_database(&app)?;
    ensure_repository_schema(&connection)?;
    let meta: Option<(i64, i64, String)> = connection
        .query_row(
            "SELECT persist_version, revision, updated_at FROM domain_state_meta WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let entity_count = connection
        .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let command_count = connection
        .query_row("SELECT COUNT(*) FROM domain_command_receipts", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    Ok(DomainStorageStatus {
        initialized: meta.is_some(),
        persist_version: meta.as_ref().map(|value| value.0),
        revision: meta.as_ref().map(|value| value.1),
        entity_count,
        command_count,
        updated_at: meta.map(|value| value.2),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);").unwrap();
        ensure_repository_schema(&connection).unwrap();
        connection
    }

    fn envelope(version: i64, meal_name: &str) -> String {
        let mut state = Map::new();
        state.insert("profile".into(), serde_json::json!({"name":"test"}));
        state.insert(
            "aiSettings".into(),
            serde_json::json!({"provider":"openai"}),
        );
        for collection in COLLECTIONS {
            state.insert(collection.into(), Value::Array(vec![]));
        }
        state.insert(
            "meals".into(),
            serde_json::json!([{"id":"meal-1","name":meal_name}]),
        );
        serde_json::to_string(&serde_json::json!({"state":state,"version":version})).unwrap()
    }

    #[test]
    fn state_is_split_into_entities_and_round_trips() {
        let mut connection = connection();
        persist_envelope(&mut connection, STORAGE_NAME, &envelope(3, "tofu")).unwrap();
        let loaded: Value =
            serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["version"], 3);
        assert_eq!(loaded["state"]["meals"][0]["name"], "tofu");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn legacy_v2_is_normalized_before_desktop_hydration() {
        let mut legacy: Value = serde_json::from_str(&envelope(2, "old meal")).unwrap();
        for key in ["consumptionEvents", "wasteEvents", "auditEvents"] {
            legacy["state"].as_object_mut().unwrap().remove(key);
        }
        legacy["state"]["batches"] =
            serde_json::json!([{"id":"batch-old","consumedRatio":0.75,"wastedRatio":0.25}]);
        let normalized: Value =
            serde_json::from_str(&normalize_legacy_envelope(&legacy.to_string()).unwrap()).unwrap();
        assert_eq!(normalized["version"], 4);
        assert_eq!(normalized["state"]["batches"][0]["remainingRatio"], 0.0);
        assert_eq!(normalized["state"]["batches"][0]["status"], "closed");
        assert_eq!(normalized["state"]["meals"][0], legacy["state"]["meals"][0]);
    }

    #[test]
    fn invalid_update_rolls_back_to_previous_revision() {
        let mut connection = connection();
        persist_envelope(&mut connection, STORAGE_NAME, &envelope(3, "first")).unwrap();
        let duplicate = envelope(3, "second").replace(
            "[{\"id\":\"meal-1\",\"name\":\"second\"}]",
            "[{\"id\":\"meal-1\",\"name\":\"second\"},{\"id\":\"meal-1\",\"name\":\"duplicate\"}]",
        );
        assert!(persist_envelope(&mut connection, STORAGE_NAME, &duplicate).is_err());
        let loaded: Value =
            serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["state"]["meals"][0]["name"], "first");
        let revision: i64 = connection
            .query_row(
                "SELECT revision FROM domain_state_meta WHERE id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(revision, 1);
    }

    #[test]
    fn legacy_blob_is_imported_without_deleting_rollback_source() {
        let mut connection = connection();
        let legacy = envelope(3, "legacy");
        connection
            .execute(
                "INSERT INTO app_kv (key, value, updated_at) VALUES (?1, ?2, 'now')",
                params![STORAGE_NAME, legacy],
            )
            .unwrap();

        let imported = import_legacy_state(&mut connection, STORAGE_NAME)
            .unwrap()
            .unwrap();
        let imported: Value = serde_json::from_str(&imported).unwrap();
        let original: Value = serde_json::from_str(&legacy).unwrap();
        assert_eq!(imported["version"], 4);
        assert_eq!(imported["state"], original["state"]);
        let loaded: Value =
            serde_json::from_str(&load_envelope(&connection).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["state"]["meals"][0]["name"], "legacy");
        let retained: String = connection
            .query_row(
                "SELECT value FROM app_kv WHERE key = ?1",
                [STORAGE_NAME],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, legacy);
    }
}
