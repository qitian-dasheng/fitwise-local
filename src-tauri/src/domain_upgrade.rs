use crate::domain_store::{apply_repository_schema, load_envelope, STORAGE_NAME};
use chrono::Utc;
use rusqlite::{backup::Backup, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, sync::Mutex, time::Duration};

static UPGRADE_LOCK: Mutex<()> = Mutex::new(());

fn table_exists(connection: &Connection, name: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn source_state(connection: &Connection) -> Result<Option<String>, String> {
    if table_exists(connection, "domain_state_meta")? {
        if let Some(raw) = load_envelope(connection)? {
            return Ok(Some(raw));
        }
    }
    if table_exists(connection, "app_kv")? {
        return connection
            .query_row(
                "SELECT value FROM app_kv WHERE key = ?1",
                [STORAGE_NAME],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string());
    }
    Ok(None)
}

fn reconciliation(raw: Option<&str>) -> Result<Value, String> {
    let envelope: Value = match raw {
        Some(raw) => {
            serde_json::from_str(raw).map_err(|error| format!("升级前数据格式无效：{error}"))?
        }
        None => return Ok(json!({"initialized":false})),
    };
    let state = envelope
        .get("state")
        .and_then(Value::as_object)
        .ok_or("升级前数据缺少 state。")?;
    let mut counts = serde_json::Map::new();
    for (key, value) in state {
        if let Some(items) = value.as_array() {
            counts.insert(key.clone(), json!(items.len()));
        }
    }
    let calories: f64 = state
        .get("meals")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|meal| {
            let metric = &meal["nutrition"]["calories"];
            if metric["state"] == "unknown" {
                0.0
            } else {
                metric["value"].as_f64().unwrap_or(0.0)
                    * meal["consumedRatio"].as_f64().unwrap_or(1.0)
            }
        })
        .sum();
    let inventory: Vec<Value> = state.get("inventory").and_then(Value::as_array).into_iter().flatten().map(|lot| json!({"id":lot["id"],"remainingAmount":lot["remainingAmount"],"unit":lot["unit"]})).collect();
    let canonical = serde_json::to_vec(state).map_err(|error| error.to_string())?;
    Ok(
        json!({"initialized":true,"counts":counts,"caloriesKcal":calories,"inventory":inventory,"stateSha256":format!("{:x}",Sha256::digest(canonical))}),
    )
}

pub(crate) fn upgrade(connection: &mut Connection, database_path: &Path) -> Result<(), String> {
    let _guard = UPGRADE_LOCK.lock().map_err(|_| "数据库升级锁不可用。")?;
    if table_exists(connection, "domain_upgrade_reports")? {
        let done: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM domain_upgrade_reports WHERE version = 5)",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if done {
            return Ok(());
        }
    }
    let before = reconciliation(source_state(connection)?.as_deref())?;
    let had_schema: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%')",[],|row| row.get(0)).map_err(|error| error.to_string())?;
    let backup_path = if had_schema {
        let folder = database_path
            .parent()
            .ok_or("数据库目录无效。")?
            .join("upgrade-backups");
        fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
        let path = folder.join(format!(
            "before-schema-5-{}.db",
            Utc::now().format("%Y%m%dT%H%M%S%f")
        ));
        let mut destination = Connection::open(&path).map_err(|error| error.to_string())?;
        Backup::new(connection, &mut destination)
            .map_err(|error| error.to_string())?
            .run_to_completion(128, Duration::from_millis(5), None)
            .map_err(|error| format!("升级前快照失败：{error}"))?;
        let integrity: String = destination
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if integrity != "ok" {
            return Err("升级前快照完整性验证失败。".into());
        }
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    };
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    apply_repository_schema(&transaction)?;
    let after = reconciliation(source_state(&transaction)?.as_deref())?;
    if before != after {
        return Err("升级后数据对账不一致，已保留升级前副本，请停止录入并恢复检查。".into());
    }
    let report = json!({"version":5,"reconciled":true,"before":before,"after":after,"backupPath":backup_path,"backupEncrypted":false});
    transaction.execute("INSERT INTO domain_upgrade_reports (version,backup_path,report_json,created_at) VALUES (5,?1,?2,?3)",rusqlite::params![backup_path,report.to_string(),Utc::now().to_rfc3339()]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_migration_rolls_back_schema_and_keeps_verified_backup() {
        let directory =
            std::env::temp_dir().join(format!("fitwise-upgrade-failure-{}", rand::random::<u64>()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("fitwise.db");
        let mut connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE app_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE domain_upgrade_reports(version INTEGER PRIMARY KEY,backup_path TEXT,report_json TEXT,created_at TEXT); CREATE TRIGGER reject_upgrade BEFORE INSERT ON domain_upgrade_reports BEGIN SELECT RAISE(FAIL,'simulated interruption'); END;").unwrap();
        let legacy = json!({"version":3,"state":{"meals":[],"inventory":[]}}).to_string();
        connection
            .execute(
                "INSERT INTO app_kv VALUES (?1,?2,'now')",
                rusqlite::params![STORAGE_NAME, legacy],
            )
            .unwrap();
        assert!(upgrade(&mut connection, &path).is_err());
        assert!(!table_exists(&connection, "domain_state_meta").unwrap());
        assert_eq!(
            connection
                .query_row("SELECT value FROM app_kv", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            legacy
        );
        assert_eq!(
            fs::read_dir(directory.join("upgrade-backups"))
                .unwrap()
                .count(),
            1
        );
        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn upgrade_preserves_legacy_and_creates_verified_backup_once() {
        let directory =
            std::env::temp_dir().join(format!("fitwise-upgrade-{}", rand::random::<u64>()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("fitwise.db");
        let mut connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE app_kv (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);").unwrap();
        let legacy = json!({"version":3,"state":{"meals":[{"id":"meal","nutrition":{"calories":{"state":"known","value":800}},"consumedRatio":0.75}],"inventory":[{"id":"lot","remainingAmount":100,"unit":"g"}]}}).to_string();
        connection
            .execute(
                "INSERT INTO app_kv VALUES (?1,?2,'now')",
                rusqlite::params![STORAGE_NAME, legacy],
            )
            .unwrap();
        upgrade(&mut connection, &path).unwrap();
        upgrade(&mut connection, &path).unwrap();
        let raw: String = connection
            .query_row("SELECT value FROM app_kv", [], |row| row.get(0))
            .unwrap();
        assert_eq!(raw, legacy);
        let report: String = connection
            .query_row(
                "SELECT report_json FROM domain_upgrade_reports",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let report: Value = serde_json::from_str(&report).unwrap();
        assert_eq!(report["before"]["caloriesKcal"], 600.0);
        assert_eq!(report["before"], report["after"]);
        assert_eq!(
            fs::read_dir(directory.join("upgrade-backups"))
                .unwrap()
                .count(),
            1
        );
        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }
}
