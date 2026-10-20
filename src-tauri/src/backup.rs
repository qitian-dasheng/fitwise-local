use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, bail, Context, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use chrono::Utc;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

const MAGIC: &[u8; 12] = b"FITWISEBKP1\0";
const FORMAT_VERSION: u8 = 1;
const ARGON_MEMORY_KIB: u32 = 65_536;
const ARGON_ITERATIONS: u32 = 3;
const ARGON_PARALLELISM: u32 = 1;
const MIN_PASSPHRASE_CHARS: usize = 10;
const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupHeader {
    format_version: u8,
    created_at: String,
    cipher: String,
    kdf: String,
    argon_memory_kib: u32,
    argon_iterations: u32,
    argon_parallelism: u32,
    salt: Vec<u8>,
    nonce: Vec<u8>,
    database_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingRestore {
    staged_path: String,
    requested_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStartupReport {
    status: String,
    message: String,
    applied_at: String,
    safety_copy_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    path: String,
    created_at: String,
    encrypted_bytes: u64,
    database_bytes: u64,
    integrity: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspection {
    path: String,
    created_at: String,
    format_version: u8,
    database_bytes: u64,
    integrity: String,
    staged_restore_path: Option<String>,
}

fn validate_passphrase(passphrase: &str) -> Result<()> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        bail!("备份口令至少需要 {MIN_PASSPHRASE_CHARS} 个字符");
    }
    Ok(())
}

fn unique_suffix() -> String {
    let mut bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}

fn sqlite_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .context("无法确定应用数据目录")?
        .join("fitwise.db"))
}

fn derive_key(passphrase: &str, header: &BackupHeader) -> Result<Zeroizing<[u8; 32]>> {
    let params = Params::new(
        header.argon_memory_kib,
        header.argon_iterations,
        header.argon_parallelism,
        Some(32),
    )
    .map_err(|_| anyhow!("备份参数无效"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; 32]);
    argon
        .hash_password_into(passphrase.as_bytes(), &header.salt, key.as_mut())
        .map_err(|_| anyhow!("无法派生备份密钥"))?;
    Ok(key)
}

fn encrypt_database(database: &[u8], passphrase: &str) -> Result<(Vec<u8>, BackupHeader)> {
    validate_passphrase(passphrase)?;
    let mut salt = vec![0_u8; 16];
    let mut nonce = vec![0_u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let header = BackupHeader {
        format_version: FORMAT_VERSION,
        created_at: Utc::now().to_rfc3339(),
        cipher: "AES-256-GCM".to_string(),
        kdf: "Argon2id-v19".to_string(),
        argon_memory_kib: ARGON_MEMORY_KIB,
        argon_iterations: ARGON_ITERATIONS,
        argon_parallelism: ARGON_PARALLELISM,
        salt,
        nonce,
        database_bytes: database.len() as u64,
    };
    let header_bytes = serde_json::to_vec(&header).context("无法序列化备份头")?;
    let key = derive_key(passphrase, &header)?;
    let cipher =
        Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| anyhow!("无法初始化加密器"))?;
    let nonce = Nonce::try_from(header.nonce.as_slice()).map_err(|_| anyhow!("备份随机数无效"))?;
    let encrypted = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: database,
                aad: &header_bytes,
            },
        )
        .map_err(|_| anyhow!("备份加密失败"))?;

    let mut container = Vec::with_capacity(MAGIC.len() + 4 + header_bytes.len() + encrypted.len());
    container.extend_from_slice(MAGIC);
    container.extend_from_slice(&(header_bytes.len() as u32).to_le_bytes());
    container.extend_from_slice(&header_bytes);
    container.extend_from_slice(&encrypted);
    Ok((container, header))
}

fn decrypt_database(container: &[u8], passphrase: &str) -> Result<(Vec<u8>, BackupHeader)> {
    validate_passphrase(passphrase)?;
    if container.len() < MAGIC.len() + 4 || &container[..MAGIC.len()] != MAGIC {
        bail!("不是有效的轻衡加密备份");
    }
    let header_len = u32::from_le_bytes(
        container[MAGIC.len()..MAGIC.len() + 4]
            .try_into()
            .map_err(|_| anyhow!("备份头损坏"))?,
    ) as usize;
    if header_len == 0
        || header_len > MAX_HEADER_BYTES
        || container.len() <= MAGIC.len() + 4 + header_len
    {
        bail!("备份头损坏");
    }
    let header_start = MAGIC.len() + 4;
    let header_end = header_start + header_len;
    let header_bytes = &container[header_start..header_end];
    let header: BackupHeader = serde_json::from_slice(header_bytes).context("备份头损坏")?;
    if header.format_version != FORMAT_VERSION
        || header.cipher != "AES-256-GCM"
        || header.kdf != "Argon2id-v19"
        || header.salt.len() != 16
        || header.nonce.len() != 12
    {
        bail!("不支持的备份格式");
    }
    let key = derive_key(passphrase, &header)?;
    let cipher =
        Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| anyhow!("无法初始化解密器"))?;
    let nonce = Nonce::try_from(header.nonce.as_slice()).map_err(|_| anyhow!("备份随机数无效"))?;
    let plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &container[header_end..],
                aad: header_bytes,
            },
        )
        .map_err(|_| anyhow!("口令错误或文件损坏"))?;
    if plaintext.len() as u64 != header.database_bytes {
        bail!("口令错误或文件损坏");
    }
    Ok((plaintext, header))
}

fn verify_sqlite_file(path: &Path) -> Result<String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .context("无法打开恢复副本")?;
    let result: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .context("无法执行数据库完整性检查")?;
    if result != "ok" {
        bail!("数据库完整性检查失败：{result}");
    }
    let app_state_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'app_kv'",
            [],
            |row| row.get(0),
        )
        .context("无法检查轻衡数据结构")?;
    if app_state_exists != 1 {
        bail!("备份不包含轻衡核心数据表");
    }
    Ok(result)
}

fn write_and_verify_temp(database: &[u8], path: &Path) -> Result<String> {
    fs::write(path, database).context("无法写入恢复验证副本")?;
    match verify_sqlite_file(path) {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = fs::remove_file(path);
            Err(error)
        }
    }
}

fn ensure_staged_path(app_data_dir: &Path, path: &Path) -> Result<PathBuf> {
    let staging = app_data_dir.join("restore-staging");
    let canonical_staging = staging.canonicalize().context("恢复暂存目录不存在")?;
    let canonical_requested = path.canonicalize().context("恢复暂存文件不存在")?;
    if !canonical_requested.starts_with(&canonical_staging)
        || canonical_requested
            .extension()
            .and_then(|value| value.to_str())
            != Some("db")
    {
        bail!("恢复文件不在受控暂存目录内");
    }
    Ok(canonical_requested)
}

fn restore_marker_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("restore-pending.json")
}

fn restore_report_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("restore-last-result.json")
}

fn write_restore_report(app_data_dir: &Path, report: &RestoreStartupReport) {
    if let Ok(json) = serde_json::to_vec_pretty(report) {
        let _ = fs::write(restore_report_path(app_data_dir), json);
    }
}

fn apply_pending_restore_in_dir(app_data_dir: &Path) -> Result<Option<RestoreStartupReport>> {
    let marker_path = restore_marker_path(app_data_dir);
    if !marker_path.exists() {
        return Ok(None);
    }
    let pending: PendingRestore =
        serde_json::from_slice(&fs::read(&marker_path).context("无法读取恢复请求")?)
            .context("恢复请求损坏")?;
    let staged = ensure_staged_path(app_data_dir, Path::new(&pending.staged_path))?;
    verify_sqlite_file(&staged)?;

    let database_path = app_data_dir.join("fitwise.db");
    let candidate_path =
        app_data_dir.join(format!("fitwise-restore-candidate-{}.db", unique_suffix()));
    fs::copy(&staged, &candidate_path).context("无法准备恢复候选数据库")?;
    verify_sqlite_file(&candidate_path)?;
    let safety_path = app_data_dir.join(format!(
        "fitwise-pre-restore-{}.db",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));

    let had_current = database_path.exists();
    if had_current {
        fs::rename(&database_path, &safety_path).context("无法保护当前数据库")?;
    }
    let applied = fs::rename(&candidate_path, &database_path)
        .context("无法把恢复候选数据库切换为当前数据库")
        .and_then(|_| verify_sqlite_file(&database_path).map(|_| ()));
    if let Err(error) = applied {
        let _ = fs::remove_file(&database_path);
        if had_current {
            let _ = fs::rename(&safety_path, &database_path);
        }
        let _ = fs::remove_file(&candidate_path);
        let _ = fs::remove_file(&marker_path);
        let report = RestoreStartupReport {
            status: "rolled_back".to_string(),
            message: format!("恢复失败，已回滚：{error}"),
            applied_at: Utc::now().to_rfc3339(),
            safety_copy_path: None,
        };
        write_restore_report(app_data_dir, &report);
        return Ok(Some(report));
    }

    let _ = fs::remove_file(&staged);
    let _ = fs::remove_file(&marker_path);
    let report = RestoreStartupReport {
        status: "applied".to_string(),
        message: "恢复副本已通过复检并成为当前数据库".to_string(),
        applied_at: Utc::now().to_rfc3339(),
        safety_copy_path: had_current.then(|| safety_path.display().to_string()),
    };
    write_restore_report(app_data_dir, &report);
    Ok(Some(report))
}

#[cfg(target_os = "windows")]
pub fn apply_pending_restore_before_start() {
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return;
    };
    let app_data_dir = PathBuf::from(roaming).join("cn.fitwise.local");
    if let Err(error) = apply_pending_restore_in_dir(&app_data_dir) {
        let _ = fs::remove_file(restore_marker_path(&app_data_dir));
        write_restore_report(
            &app_data_dir,
            &RestoreStartupReport {
                status: "failed".to_string(),
                message: format!("恢复请求未应用：{error}"),
                applied_at: Utc::now().to_rfc3339(),
                safety_copy_path: None,
            },
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn apply_pending_restore_before_start() {}

fn create_sqlite_snapshot(source_path: &Path, snapshot_path: &Path) -> Result<String> {
    let source = Connection::open(source_path).context("无法打开当前数据库")?;
    let mut destination = Connection::open(snapshot_path).context("无法创建数据库快照")?;
    {
        let backup = Backup::new(&source, &mut destination).context("无法启动 SQLite 在线备份")?;
        backup
            .run_to_completion(32, Duration::from_millis(10), None)
            .context("SQLite 在线备份失败")?;
    }
    drop(destination);
    verify_sqlite_file(snapshot_path)
}

fn read_container(path: &Path) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path).context("找不到备份文件")?;
    if metadata.len() > 2 * 1024 * 1024 * 1024_u64 {
        bail!("备份文件超过 2 GB，拒绝载入内存");
    }
    fs::read(path).context("无法读取备份文件")
}

fn commit_backup_file(temporary_output: &Path, output: &Path) -> Result<()> {
    if !output.exists() {
        return fs::rename(temporary_output, output).context("无法完成备份文件写入");
    }
    let previous = output.with_extension(format!("previous-{}", unique_suffix()));
    fs::rename(output, &previous).context("无法保护已有备份文件")?;
    match fs::rename(temporary_output, output) {
        Ok(()) => {
            let _ = fs::remove_file(previous);
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(previous, output);
            Err(error).context("无法完成备份文件写入，原备份已保留")
        }
    }
}

#[tauri::command]
pub async fn create_encrypted_backup(
    app: AppHandle,
    output_path: String,
    passphrase: String,
) -> Result<BackupReport, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<BackupReport> {
        validate_passphrase(&passphrase)?;
        let source_path = sqlite_path(&app)?;
        if !source_path.exists() {
            bail!("当前数据库尚未创建");
        }
        let cache_dir = app.path().app_cache_dir().context("无法确定缓存目录")?;
        fs::create_dir_all(&cache_dir).context("无法创建缓存目录")?;
        let suffix = unique_suffix();
        let snapshot_path = cache_dir.join(format!("backup-snapshot-{suffix}.db"));
        let verification_path = cache_dir.join(format!("backup-verify-{suffix}.db"));
        let output = PathBuf::from(output_path);
        let output_parent = output.parent().ok_or_else(|| anyhow!("备份路径无效"))?;
        fs::create_dir_all(output_parent).context("无法创建备份目录")?;
        let temporary_output = output.with_extension("fitwise-backup.tmp");

        let result = (|| -> Result<BackupReport> {
            create_sqlite_snapshot(&source_path, &snapshot_path)?;
            let database = fs::read(&snapshot_path).context("无法读取数据库快照")?;
            let (container, header) = encrypt_database(&database, &passphrase)?;
            {
                let mut file = fs::File::create(&temporary_output).context("无法创建备份文件")?;
                file.write_all(&container).context("无法写入备份文件")?;
                file.sync_all().context("无法同步备份文件")?;
            }

            let (restored, _) = decrypt_database(&read_container(&temporary_output)?, &passphrase)?;
            let integrity = write_and_verify_temp(&restored, &verification_path)?;
            commit_backup_file(&temporary_output, &output)?;
            Ok(BackupReport {
                path: output.display().to_string(),
                created_at: header.created_at,
                encrypted_bytes: container.len() as u64,
                database_bytes: database.len() as u64,
                integrity,
            })
        })();

        let _ = fs::remove_file(&snapshot_path);
        let _ = fs::remove_file(&verification_path);
        if result.is_err() {
            let _ = fs::remove_file(&temporary_output);
        }
        result
    })
    .await
    .map_err(|_| "备份任务意外终止".to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn discard_staged_restore(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        let app_data_dir = app.path().app_data_dir().context("无法确定应用数据目录")?;
        let canonical_requested = ensure_staged_path(&app_data_dir, Path::new(&path))?;
        fs::remove_file(canonical_requested).context("无法删除恢复暂存副本")?;
        Ok(())
    })
    .await
    .map_err(|_| "清理恢复暂存副本时任务意外终止".to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn schedule_staged_restore(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        let app_data_dir = app.path().app_data_dir().context("无法确定应用数据目录")?;
        let staged = ensure_staged_path(&app_data_dir, Path::new(&path))?;
        verify_sqlite_file(&staged)?;
        let request = PendingRestore {
            staged_path: staged.display().to_string(),
            requested_at: Utc::now().to_rfc3339(),
        };
        let marker = serde_json::to_vec_pretty(&request).context("无法创建恢复请求")?;
        fs::write(restore_marker_path(&app_data_dir), marker).context("无法保存恢复请求")?;
        Ok(())
    })
    .await
    .map_err(|_| "安排恢复时任务意外终止".to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_restore_startup_report(
    app: AppHandle,
) -> Result<Option<RestoreStartupReport>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<RestoreStartupReport>> {
        let app_data_dir = app.path().app_data_dir().context("无法确定应用数据目录")?;
        let path = restore_report_path(&app_data_dir);
        if !path.exists() {
            return Ok(None);
        }
        let report = serde_json::from_slice(&fs::read(path).context("无法读取恢复结果")?)
            .context("恢复结果损坏")?;
        Ok(Some(report))
    })
    .await
    .map_err(|_| "读取恢复结果时任务意外终止".to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn inspect_encrypted_backup(
    app: AppHandle,
    path: String,
    passphrase: String,
    stage_restore: bool,
) -> Result<BackupInspection, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<BackupInspection> {
        let backup_path = PathBuf::from(&path);
        let container = read_container(&backup_path)?;
        let (database, header) = decrypt_database(&container, &passphrase)?;
        let base_dir = if stage_restore {
            let staging = app
                .path()
                .app_data_dir()
                .context("无法确定应用数据目录")?
                .join("restore-staging");
            fs::create_dir_all(&staging).context("无法创建恢复暂存目录")?;
            staging
        } else {
            let cache = app.path().app_cache_dir().context("无法确定缓存目录")?;
            fs::create_dir_all(&cache).context("无法创建缓存目录")?;
            cache
        };
        let restored_path = base_dir.join(format!("fitwise-restore-{}.db", unique_suffix()));
        let integrity = write_and_verify_temp(&database, &restored_path)?;
        let staged_restore_path = if stage_restore {
            Some(restored_path.display().to_string())
        } else {
            let _ = fs::remove_file(&restored_path);
            None
        };
        Ok(BackupInspection {
            path,
            created_at: header.created_at,
            format_version: header.format_version,
            database_bytes: header.database_bytes,
            integrity,
            staged_restore_path,
        })
    })
    .await
    .map_err(|_| "恢复验证任务意外终止".to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_container_round_trip_and_wrong_password_rejected() {
        let database = b"SQLite format 3\0not-a-full-db-but-encryption-is-testable";
        let (container, _) = encrypt_database(database, "correct horse battery staple").unwrap();
        assert!(!container
            .windows(database.len())
            .any(|part| part == database));
        let (restored, _) = decrypt_database(&container, "correct horse battery staple").unwrap();
        assert_eq!(restored, database);
        assert!(decrypt_database(&container, "this password is wrong").is_err());
    }

    #[test]
    fn sqlite_snapshot_can_be_encrypted_and_restored_with_integrity() {
        let directory =
            std::env::temp_dir().join(format!("fitwise-backup-test-{}", unique_suffix()));
        fs::create_dir_all(&directory).unwrap();
        let source_path = directory.join("source.db");
        let snapshot_path = directory.join("snapshot.db");
        let restored_path = directory.join("restored.db");
        let source = Connection::open(&source_path).unwrap();
        source
            .execute_batch(
                "CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);\
                 INSERT INTO app_kv VALUES ('state', '{\"ok\":true}', '2026-10-20T00:00:00Z');",
            )
            .unwrap();
        crate::domain_store::ensure_repository_schema(&source).unwrap();
        let food_payload = serde_json::json!({"id":"food-backup-test","name":"燕麦","activeVersionId":"food-version-backup-test"}).to_string();
        let version_payload = serde_json::json!({"id":"food-version-backup-test","foodId":"food-backup-test","version":1,"basis":{"quantity":100,"unit":"g"},"nutrition":{"calories":{"state":"known","value":400},"fiber":{"state":"unknown"}}}).to_string();
        for (collection, id, payload) in [
            ("foodDefinitions", "food-backup-test", &food_payload),
            (
                "foodDefinitionVersions",
                "food-version-backup-test",
                &version_payload,
            ),
        ] {
            source.execute("INSERT INTO domain_entities(collection,entity_id,payload_json,sort_index,updated_at) VALUES(?1,?2,?3,0,'now')",rusqlite::params![collection,id,payload]).unwrap();
        }
        drop(source);

        assert_eq!(
            create_sqlite_snapshot(&source_path, &snapshot_path).unwrap(),
            "ok"
        );
        let database = fs::read(&snapshot_path).unwrap();
        let (container, _) = encrypt_database(&database, "long test passphrase").unwrap();
        let (restored, _) = decrypt_database(&container, "long test passphrase").unwrap();
        assert_eq!(
            write_and_verify_temp(&restored, &restored_path).unwrap(),
            "ok"
        );
        let restored_connection = Connection::open(&restored_path).unwrap();
        let value: String = restored_connection
            .query_row("SELECT value FROM app_kv WHERE key = 'state'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(value, "{\"ok\":true}");
        for (id, original) in [
            ("food-backup-test", food_payload),
            ("food-version-backup-test", version_payload),
        ] {
            let payload: String = restored_connection
                .query_row(
                    "SELECT payload_json FROM domain_entities WHERE entity_id=?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(payload, original);
        }
        drop(restored_connection);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn pending_restore_replaces_database_and_keeps_safety_copy() {
        let directory =
            std::env::temp_dir().join(format!("fitwise-restore-test-{}", unique_suffix()));
        let staging = directory.join("restore-staging");
        fs::create_dir_all(&staging).unwrap();
        let current_path = directory.join("fitwise.db");
        let staged_path = staging.join("incoming.db");
        for (path, value) in [(&current_path, "current"), (&staged_path, "restored")] {
            let connection = Connection::open(path).unwrap();
            connection
                .execute_batch(&format!(
                    "CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);\
                     INSERT INTO app_kv VALUES ('state', '{value}', '2026-10-20T00:00:00Z');"
                ))
                .unwrap();
        }
        let request = PendingRestore {
            staged_path: staged_path.display().to_string(),
            requested_at: Utc::now().to_rfc3339(),
        };
        fs::write(
            restore_marker_path(&directory),
            serde_json::to_vec(&request).unwrap(),
        )
        .unwrap();

        let report = apply_pending_restore_in_dir(&directory).unwrap().unwrap();
        assert_eq!(report.status, "applied");
        assert!(report
            .safety_copy_path
            .as_ref()
            .is_some_and(|path| Path::new(path).exists()));
        let restored = Connection::open(&current_path).unwrap();
        let value: String = restored
            .query_row("SELECT value FROM app_kv WHERE key = 'state'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(value, "restored");
        drop(restored);
        fs::remove_dir_all(directory).unwrap();
    }
}
