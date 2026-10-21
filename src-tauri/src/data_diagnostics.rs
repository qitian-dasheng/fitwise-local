//! Read-only diagnostics and explicit, non-overwriting JSON exports. Never imports state.
use crate::domain_store::{load_envelope, read_storage_status};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, io::Write, path::Path};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_runtime_diagnostics(app: AppHandle) -> Result<Value, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fitwise.db");
    tauri::async_runtime::spawn_blocking(move || read_runtime_diagnostics(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn read_runtime_diagnostics(path: &Path) -> Result<Value, String> {
    // Do not create, initialize, migrate or import a database while diagnosing it.
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("只读打开数据库失败：{e}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let tx = connection
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let status = read_storage_status(&tx)?;
    let envelope = load_envelope(&tx)?;
    let fingerprint = envelope.map(|raw| format!("{:x}", Sha256::digest(raw.as_bytes())));
    Ok(json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "processId": std::process::id(),
        "executablePath": std::env::current_exe().map_err(|e| e.to_string())?.display().to_string(),
        "databasePath": path.canonicalize().map_err(|e| e.to_string())?.display().to_string(),
        "storage": status,
        "snapshotSha256": fingerprint,
        "capturedAt": chrono::Utc::now().to_rfc3339()
    }))
}

fn write_export(path: &Path, raw: &str) -> Result<Value, String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("json"))
    {
        return Err("请选择绝对路径且扩展名为 .json 的新文件。".into());
    }
    if raw.len() > 64 * 1024 * 1024 {
        return Err("JSON 超过 64 MB，未写入；请联系维护者进行分段导出。".into());
    }
    let value: Value = serde_json::from_str(raw).map_err(|e| format!("导出 JSON 无效：{e}"))?;
    if value["app"] != "Fitwise Local"
        || !matches!(
            value["source"].as_str(),
            Some("sqlite_domain_repository" | "window_snapshot_unverified")
        )
    {
        return Err("未知的导出来源，未写入。".into());
    }
    // create_new is atomic: an existing file (including the database) is never replaced.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("无法创建新导出文件（不会覆盖旧文件，请改用新文件名）：{e}"))?;
    file.write_all(raw.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("写入未完成，文件可能不完整，请另存新文件：{e}"))?;
    drop(file);
    let bytes = std::fs::read(path).map_err(|e| format!("写入后校验失败：{e}"))?;
    if bytes != raw.as_bytes() {
        return Err("导出文件回读不一致，请保留窗口并另存新文件。".into());
    }
    Ok(
        json!({"path":path.display().to_string(),"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes)),"source":value["source"]}),
    )
}

#[tauri::command]
pub async fn write_json_export(output_path: String, raw: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || write_export(Path::new(&output_path), &raw))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_is_verified_and_cannot_overwrite_an_existing_file() {
        let path = std::env::temp_dir().join(format!(
            "fitwise-export-test-{}.json",
            rand::random::<u64>()
        ));
        let raw = r#"{"app":"Fitwise Local","source":"window_snapshot_unverified","measurements":[{"weightKg":78.55}]}"#;
        let report = write_export(&path, raw).unwrap();
        assert_eq!(report["bytes"], raw.len());
        assert_eq!(report["source"], "window_snapshot_unverified");
        assert!(write_export(&path, raw).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn invalid_exports_do_not_create_files() {
        let path = std::env::temp_dir().join(format!(
            "fitwise-invalid-test-{}.json",
            rand::random::<u64>()
        ));
        for raw in [
            "invalid",
            "{}",
            r#"{"app":"Fitwise Local","source":"unknown"}"#,
        ] {
            assert!(write_export(&path, raw).is_err());
            assert!(!path.exists());
        }
        assert!(write_export(Path::new("relative.json"), "{}").is_err());
        assert!(write_export(&path.with_extension("db"), "{}").is_err());
    }

    #[test]
    fn diagnostics_never_create_or_migrate_a_missing_or_legacy_database() {
        let path = std::env::temp_dir().join(format!(
            "fitwise-diagnostics-test-{}.db",
            rand::random::<u64>()
        ));
        assert!(read_runtime_diagnostics(&path).is_err());
        assert!(!path.exists());
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('preserved');",
            )
            .unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(read_runtime_diagnostics(&path).is_err());
        assert_eq!(before, std::fs::read(&path).unwrap());
        let connection = Connection::open(&path).unwrap();
        crate::domain_store::ensure_repository_schema(&connection).unwrap();
        let tables_before: i64 = connection
            .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
            .unwrap();
        drop(connection);
        let report = read_runtime_diagnostics(&path).unwrap();
        assert_eq!(report["storage"]["initialized"], false);
        assert_eq!(report["storage"]["entityCount"], 0);
        assert!(report["snapshotSha256"].is_null());
        assert!(!report.to_string().contains("preserved"));
        let connection = Connection::open(&path).unwrap();
        assert_eq!(
            tables_before,
            connection
                .query_row("SELECT count(*) FROM sqlite_master", [], |r| r
                    .get::<_, i64>(0))
                .unwrap()
        );
        drop(connection);
        std::fs::remove_file(path).unwrap();
    }
}
