use chrono::{Duration, Utc};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageDecoder, ImageReader, Rgba};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Cursor, path::Path};
use tauri::{AppHandle, Manager};

pub(crate) const MAX_INPUT_BYTES: usize = 20 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn audit(connection: &Connection, id: &str, action: &str, details: Value) -> Result<(), String> {
    connection.execute("INSERT INTO input_artifact_audit(entity_id,action,details_json,created_at) VALUES(?1,?2,?3,?4)",params![id,action,details.to_string(),Utc::now().to_rfc3339()]).map_err(err)?;
    Ok(())
}
fn decoded(bytes: &[u8]) -> Result<DynamicImage, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(err)?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(96 * 1024 * 1024);
    limits.max_image_width = Some(20_000);
    limits.max_image_height = Some(20_000);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("图片无法解码：{e}"))?;
    let (w, h) = decoder.dimensions();
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err("图片超过 1600 万像素，请先缩小后导入。".into());
    }
    let orientation = decoder.orientation().map_err(err)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(err)?;
    image.apply_orientation(orientation);
    Ok(image)
}
fn jpeg(image: &DynamicImage, edge: u32) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let scaled;
    let image = if image.width() > edge || image.height() > edge {
        scaled = image.thumbnail(edge, edge);
        &scaled
    } else {
        image
    };
    JpegEncoder::new_with_quality(&mut bytes, 85)
        .encode_image(&image.to_rgb8())
        .map_err(err)?;
    Ok(bytes)
}
pub(crate) struct InputFile {
    pub(crate) name: String,
    pub(crate) bytes: Vec<u8>,
}
struct PreparedFile {
    id: String,
    name: String,
    mime: &'static str,
    data: Vec<u8>,
    thumb: Option<Vec<u8>>,
    width: Option<u32>,
    height: Option<u32>,
}
fn prepare(file: InputFile) -> Result<PreparedFile, String> {
    if file.bytes.is_empty() || file.bytes.len() > MAX_INPUT_BYTES {
        return Err("附件为空或超过 20 MB。".into());
    }
    let mime =
        match image::guess_format(&file.bytes) {
            Ok(image::ImageFormat::Png) => "image/png",
            Ok(image::ImageFormat::Jpeg) => "image/jpeg",
            Ok(image::ImageFormat::WebP) => "image/webp",
            _ if file.bytes.starts_with(b"%PDF-") => "application/pdf",
            _ => return Err(
                "目前支持 PNG、JPEG、WebP 图片及 PDF 原件。HEIC 请先转换；不根据扩展名信任文件。"
                    .into(),
            ),
        };
    let (thumb, width, height) = if mime.starts_with("image/") {
        let image = decoded(&file.bytes)?;
        (
            Some(jpeg(&image, 512)?),
            Some(image.width()),
            Some(image.height()),
        )
    } else {
        (None, None, None)
    };
    let name = Path::new(&file.name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("附件")
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect();
    Ok(PreparedFile {
        id: hash(&file.bytes),
        name,
        mime,
        data: file.bytes,
        thumb,
        width,
        height,
    })
}
pub(crate) fn receive(
    connection: &mut Connection,
    request_id: &str,
    note: &str,
    files: Vec<InputFile>,
    source: &str,
) -> Result<Value, String> {
    receive_guarded(connection, request_id, note, files, source, || true)
}
pub(crate) fn receive_guarded(
    connection: &mut Connection,
    request_id: &str,
    note: &str,
    files: Vec<InputFile>,
    source: &str,
    can_commit: impl Fn() -> bool,
) -> Result<Value, String> {
    if request_id.len() < 12
        || request_id.len() > 100
        || !request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("接收请求标识无效。".into());
    }
    if note.chars().count() > 10_000
        || files.len() > 8
        || files.iter().map(|f| f.bytes.len()).sum::<usize>() > MAX_INPUT_BYTES
    {
        return Err("单次最多 8 个附件、合计 20 MB，文字最多 10000 字。".into());
    }
    if files.is_empty() && note.trim().is_empty() {
        return Err("没有收到内容。".into());
    }
    let files = files
        .into_iter()
        .map(prepare)
        .collect::<Result<Vec<_>, _>>()?;
    if !can_commit() {
        return Err("上传会话已结束，未保存本次内容。".into());
    }
    let request_hash=hash(serde_json::to_string(&json!({"files":files.iter().map(|f|(&f.id,&f.name)).collect::<Vec<_>>(),"note":note,"source":source})).map_err(err)?.as_bytes());
    crate::domain_store::ensure_repository_schema(connection)?;
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let old: Option<String> = tx
        .query_row(
            "SELECT request_sha256 FROM input_receipts WHERE request_id=?1 LIMIT 1",
            [request_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(old) = old {
        if old != request_hash {
            return Err("同一接收请求的内容发生变化，请重新发起。".into());
        }
        return Ok(json!({"replayed":true}));
    }
    let now = Utc::now().to_rfc3339();
    for (index, file) in files.iter().enumerate() {
        let existing: Option<(bool, bool)> = tx
            .query_row(
                "SELECT original IS NULL,trashed_at IS NOT NULL FROM input_artifact_objects WHERE id=?1",
                [&file.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        // Reimport is explicit restoration; never let a thumbnail hide a missing original.
        if existing.is_some_and(|v| v.0 || v.1) {
            tx.execute("UPDATE input_artifact_objects SET original=?1,thumb=?2,thumb_sha256=?3,privacy=NULL,privacy_sha256=NULL,masks_json=NULL,trashed_at=NULL,purged_at=NULL WHERE id=?4",params![file.data,file.thumb,file.thumb.as_ref().map(|b|hash(b)),file.id]).map_err(err)?;
        } else {
            tx.execute("INSERT OR IGNORE INTO input_artifact_objects(id,name,mime,original,thumb,thumb_sha256,width,height,original_bytes,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![file.id,file.name,file.mime,file.data,file.thumb,file.thumb.as_ref().map(|b|hash(b)),file.width,file.height,file.data.len(),now]).map_err(err)?;
        }
        tx.execute("INSERT INTO input_receipts(id,request_id,request_sha256,artifact_id,note,source,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![format!("{request_id}-{index}"),request_id,request_hash,file.id,note,source,now]).map_err(err)?;
    }
    if files.is_empty() {
        tx.execute("INSERT INTO input_receipts(id,request_id,request_sha256,note,source,created_at) VALUES(?1,?1,?2,?3,?4,?5)",params![request_id,request_hash,note,source,now]).map_err(err)?;
    }
    if !can_commit() {
        return Err("上传会话已结束，未保存本次内容。".into());
    }
    audit(
        &tx,
        request_id,
        "receive_input",
        json!({"fileCount":files.len(),"source":source,"requestHash":request_hash}),
    )?;
    tx.commit().map_err(err)?;
    Ok(json!({"replayed":false,"fileCount":files.len()}))
}
fn open(app: &AppHandle) -> Result<Connection, String> {
    let c = crate::domain_store::open_database(app)?;
    crate::domain_store::ensure_repository_schema(&c)?;
    Ok(c)
}

#[tauri::command]
pub async fn import_local_input(
    app: AppHandle,
    paths: Vec<String>,
    note: String,
    request_id: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.len() > 8 {
            return Err("单次最多选择 8 个附件。".into());
        }
        let mut total = 0u64;
        let mut files = Vec::new();
        for path in paths {
            let path = Path::new(&path);
            let metadata = fs::metadata(path).map_err(err)?;
            total = total.saturating_add(metadata.len());
            if !metadata.is_file() || total > MAX_INPUT_BYTES as u64 {
                return Err("附件合计超过 20 MB 或不是普通文件。".into());
            }
            files.push(InputFile {
                name: path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("附件")
                    .into(),
                bytes: fs::read(path).map_err(err)?,
            });
        }
        receive(&mut open(&app)?, &request_id, &note, files, "desktop")
    })
    .await
    .map_err(err)?
}

pub(crate) fn receipts(
    connection: &Connection,
    trashed: bool,
    offset: u32,
) -> Result<Value, String> {
    let mut stmt=connection.prepare("SELECT r.id,r.artifact_id,r.note,r.source,r.created_at,r.status,a.name,a.mime,a.width,a.height,a.trashed_at,a.purged_at,a.privacy_sha256,a.original_bytes FROM input_receipts r LEFT JOIN input_artifact_objects a ON a.id=r.artifact_id WHERE (?1=1 AND a.trashed_at IS NOT NULL) OR (?1=0 AND a.trashed_at IS NULL) ORDER BY r.created_at DESC,r.id LIMIT 51 OFFSET ?2").map_err(err)?;
    let rows=stmt.query_map(params![trashed,offset],|r|Ok(json!({"id":r.get::<_,String>(0)?,"artifactId":r.get::<_,Option<String>>(1)?,"note":r.get::<_,String>(2)?,"source":r.get::<_,String>(3)?,"createdAt":r.get::<_,String>(4)?,"status":r.get::<_,String>(5)?,"name":r.get::<_,Option<String>>(6)?,"mime":r.get::<_,Option<String>>(7)?,"width":r.get::<_,Option<u32>>(8)?,"height":r.get::<_,Option<u32>>(9)?,"trashedAt":r.get::<_,Option<String>>(10)?,"purgedAt":r.get::<_,Option<String>>(11)?,"privacyHash":r.get::<_,Option<String>>(12)?,"bytes":r.get::<_,Option<u64>>(13)?}))).map_err(err)?;
    let mut items = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
    let has_more = items.len() > 50;
    items.truncate(50);
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM input_receipts r LEFT JOIN input_artifact_objects a ON r.artifact_id=a.id WHERE r.status='unreviewed' AND a.trashed_at IS NULL AND a.purged_at IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(json!({"items":items,"unreviewedCount":count,"hasMore":has_more}))
}
#[tauri::command]
pub fn list_input_receipts(app: AppHandle, trashed: bool, offset: u32) -> Result<Value, String> {
    receipts(&open(&app)?, trashed, offset)
}

fn preview(connection: &Connection, id: &str, kind: &str) -> Result<Vec<u8>, String> {
    let column = match kind {
        "thumbnail" => "thumb",
        "privacy" => "privacy",
        "preview" => "original",
        _ => return Err("无效预览类型。".into()),
    };
    let bytes:Option<Vec<u8>>=connection.query_row(&format!("SELECT {column} FROM input_artifact_objects WHERE id=?1 AND trashed_at IS NULL AND purged_at IS NULL"),[id],|r|r.get(0)).optional().map_err(err)?.flatten();
    let bytes = bytes.ok_or("原件已删除、在回收站中或此类型不支持预览。")?;
    if kind == "preview" {
        jpeg(&decoded(&bytes)?, 1600)
    } else {
        Ok(bytes)
    }
}
#[tauri::command]
pub async fn read_artifact_preview(
    app: AppHandle,
    id: String,
    kind: String,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || preview(&open(&app)?, &id, &kind))
        .await
        .map_err(err)?
}

#[derive(Debug, Clone, Deserialize)]
pub struct Mask {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
fn redact(connection: &Connection, id: &str, masks: &[Mask]) -> Result<String, String> {
    if masks.is_empty()
        || masks.len() > 40
        || masks.iter().any(|m| {
            ![m.x, m.y, m.width, m.height].iter().all(|v| v.is_finite())
                || m.x < 0.0
                || m.y < 0.0
                || m.width <= 0.0
                || m.height <= 0.0
                || m.x + m.width > 1.00001
                || m.y + m.height > 1.00001
        })
    {
        return Err("请画出 1–40 个有效遮挡区域，且不超出图片。".into());
    }
    let bytes: Option<Vec<u8>> = connection
        .query_row(
            "SELECT original FROM input_artifact_objects WHERE id=?1 AND trashed_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .flatten();
    let mut image = decoded(&bytes.ok_or("原件不可用。")?)?.to_rgba8();
    let (w, h) = image.dimensions();
    for m in masks {
        let x0 = (m.x * w as f64).floor() as u32;
        let y0 = (m.y * h as f64).floor() as u32;
        let x1 = ((m.x + m.width) * w as f64).ceil().min(w as f64) as u32;
        let y1 = ((m.y + m.height) * h as f64).ceil().min(h as f64) as u32;
        for y in y0..y1 {
            for x in x0..x1 {
                image.put_pixel(x, y, Rgba([0, 0, 0, 255]));
            }
        }
    }
    // Lossless PNG after masking; source metadata is not copied. No recoverable blur.
    let image = DynamicImage::ImageRgba8(image);
    let image = if image.width() > 1600 || image.height() > 1600 {
        image.thumbnail(1600, 1600)
    } else {
        image
    };
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(err)?;
    let data = output.into_inner();
    let digest = hash(&data);
    let tx = connection.unchecked_transaction().map_err(err)?;
    let changed=tx.execute("UPDATE input_artifact_objects SET privacy=?1,privacy_sha256=?2,masks_json=?3 WHERE id=?4 AND original IS NOT NULL AND trashed_at IS NULL",params![data,digest,serde_json::to_string(&masks.iter().map(|m|json!({"x":m.x,"y":m.y,"width":m.width,"height":m.height})).collect::<Vec<_>>()).map_err(err)?,id]).map_err(err)?;
    if changed != 1 {
        return Err("附件状态已变化，请重新打开。".into());
    }
    audit(
        &tx,
        id,
        "save_privacy",
        json!({"derivedHash":digest,"maskCount":masks.len()}),
    )?;
    tx.commit().map_err(err)?;
    Ok(digest)
}
#[tauri::command]
pub async fn save_artifact_privacy(
    app: AppHandle,
    id: String,
    masks: Vec<Mask>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || redact(&open(&app)?, &id, &masks))
        .await
        .map_err(err)?
}

#[tauri::command]
pub fn set_input_status(app: AppHandle, id: String, status: String) -> Result<(), String> {
    if !["unreviewed", "drafted", "discarded"].contains(&status.as_str()) {
        return Err("仅能保存本地处理状态，不能直接确认正式记录。".into());
    }
    let connection = open(&app)?;
    let tx = connection.unchecked_transaction().map_err(err)?;
    let count = tx
        .execute(
            "UPDATE input_receipts SET status=?1 WHERE id=?2",
            params![status, id],
        )
        .map_err(err)?;
    if count != 1 {
        return Err("接收记录不存在。".into());
    }
    audit(&tx, &id, "set_input_status", json!({"status":status}))?;
    tx.commit().map_err(err)?;
    Ok(())
}
fn manage(connection: &Connection, id: &str, action: &str) -> Result<(), String> {
    let tx = connection.unchecked_transaction().map_err(err)?;
    let connection = &tx;
    let now = Utc::now().to_rfc3339();
    let changed=match action{
        "trash"=>connection.execute("UPDATE input_artifact_objects SET trashed_at=?1 WHERE id=?2 AND trashed_at IS NULL AND purged_at IS NULL",params![now,id]),
        "restore"=>connection.execute("UPDATE input_artifact_objects SET trashed_at=NULL WHERE id=?1 AND trashed_at IS NOT NULL AND purged_at IS NULL",[id]),
        "purge_expired"=>{let cutoff=(Utc::now()-Duration::days(30)).to_rfc3339();connection.execute("UPDATE input_artifact_objects SET original=NULL,thumb=NULL,privacy=NULL,purged_at=?1,trashed_at=NULL WHERE id=?2 AND trashed_at<=?3 AND purged_at IS NULL",params![now,id,cutoff])},
        _=>return Err("未知附件操作。".into())
    }.map_err(err)?;
    if changed != 1 {
        return Err("附件状态已变化，或尚未超过回收站 30 天期限。".into());
    }
    audit(&tx, id, action, json!({}))?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn manage_artifact(app: AppHandle, id: String, action: String) -> Result<(), String> {
    manage(&open(&app)?, &id, &action)
}

pub(crate) fn storage(connection: &Connection) -> Result<Value, String> {
    let result=connection.query_row("SELECT COUNT(*),COALESCE(SUM(length(original)),0),COALESCE(SUM(length(thumb)),0),COALESCE(SUM(length(privacy)),0),COALESCE(SUM(CASE WHEN trashed_at IS NOT NULL THEN length(original)+COALESCE(length(thumb),0)+COALESCE(length(privacy),0) ELSE 0 END),0) FROM input_artifact_objects",[],|r|Ok(json!({"count":r.get::<_,u64>(0)?,"originalBytes":r.get::<_,u64>(1)?,"thumbnailBytes":r.get::<_,u64>(2)?,"privacyBytes":r.get::<_,u64>(3)?,"trashBytes":r.get::<_,u64>(4)?}))).map_err(err)?;
    Ok(result)
}
#[tauri::command]
pub fn get_artifact_storage(app: AppHandle) -> Result<Value, String> {
    let c = open(&app)?;
    let mut stats = storage(&c)?;
    let root = app.path().app_data_dir().map_err(err)?;
    let db = fs::metadata(root.join("fitwise.db")).map_err(err)?.len();
    let attachments = stats["originalBytes"].as_u64().unwrap_or(0)
        + stats["thumbnailBytes"].as_u64().unwrap_or(0)
        + stats["privacyBytes"].as_u64().unwrap_or(0);
    stats["databaseBytes"] = json!(db);
    stats["databaseOtherBytes"] = json!(db.saturating_sub(attachments));
    stats["warning"] = json!(db >= 2 * 1024 * 1024 * 1024);
    Ok(stats)
}

pub(crate) fn verify(connection: &Connection) -> Result<(), String> {
    let exists:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='input_artifact_objects')",[],|r|r.get(0)).map_err(err)?;
    if !exists {
        return Ok(());
    }
    let missing:i64=connection.query_row("SELECT COUNT(*) FROM input_receipts r LEFT JOIN input_artifact_objects a ON a.id=r.artifact_id WHERE r.artifact_id IS NOT NULL AND a.id IS NULL",[],|r|r.get(0)).map_err(err)?;
    if missing != 0 {
        return Err("备份中存在缺失的附件引用。".into());
    }
    let mut stmt=connection.prepare("SELECT id,original,thumb,thumb_sha256,privacy,privacy_sha256,purged_at,original_bytes FROM input_artifact_objects").map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let id: String = row.get(0).map_err(err)?;
        let original: Option<Vec<u8>> = row.get(1).map_err(err)?;
        let purged: Option<String> = row.get(6).map_err(err)?;
        let bytes: u64 = row.get(7).map_err(err)?;
        if purged.is_none()
            && original
                .as_ref()
                .is_none_or(|b| hash(b) != id || b.len() as u64 != bytes)
        {
            return Err("备份中附件原件缺失或哈希不一致。".into());
        }
        for (data_col, hash_col) in [(2, 3), (4, 5)] {
            let data: Option<Vec<u8>> = row.get(data_col).map_err(err)?;
            let digest: Option<String> = row.get(hash_col).map_err(err)?;
            if purged.is_none() && data.as_ref().map(|b| hash(b)) != digest {
                return Err("备份中附件预览哈希不一致。".into());
            }
        }
    }
    Ok(())
}

pub(crate) fn manifest(connection: &Connection) -> Result<Value, String> {
    let mut statement=connection.prepare("SELECT id,name,mime,original_bytes,created_at,trashed_at,purged_at,privacy_sha256,width,height FROM input_artifact_objects ORDER BY id").map_err(err)?;
    let rows=statement.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"mime":r.get::<_,String>(2)?,"bytes":r.get::<_,u64>(3)?,"createdAt":r.get::<_,String>(4)?,"trashedAt":r.get::<_,Option<String>>(5)?,"purgedAt":r.get::<_,Option<String>>(6)?,"privacyHash":r.get::<_,Option<String>>(7)?,"width":r.get::<_,Option<u32>>(8)?,"height":r.get::<_,Option<u32>>(9)?}))).map_err(err)?;
    let artifacts = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
    let mut stmt = connection
        .prepare(
            "SELECT id,artifact_id,note,source,created_at,status FROM input_receipts ORDER BY id",
        )
        .map_err(err)?;
    let rows=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"artifactId":r.get::<_,Option<String>>(1)?,"note":r.get::<_,String>(2)?,"source":r.get::<_,String>(3)?,"createdAt":r.get::<_,String>(4)?,"status":r.get::<_,String>(5)?}))).map_err(err)?;
    Ok(
        json!({"artifacts":artifacts,"receipts":rows.collect::<Result<Vec<_>,_>>().map_err(err)?,"binaryIncluded":false,"note":"JSON 仅包含附件清单，完整原件及派生图请使用加密备份。"}),
    )
}

#[tauri::command]
pub async fn recover_legacy_inputs(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move||{
        let directory=app.path().app_data_dir().map_err(err)?.join("inbox");
        if !directory.exists(){return Ok(json!({"recovered":0,"failed":0}));}
        let directory=directory.canonicalize().map_err(err)?;
        let mut connection=open(&app)?;let mut recovered=0;let mut failed=0;
        for entry in fs::read_dir(&directory).map_err(err)?.take(1000){
            let entry=entry.map_err(err)?;let name=entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("submission-")||!name.ends_with(".json"){continue;}
            let result=(||->Result<(),String>{
                let metadata=entry.metadata().map_err(err)?;if !metadata.is_file()||metadata.len()>128*1024{return Err("旧接收记录过大。".into());}
                let path=entry.path().canonicalize().map_err(err)?;if !path.starts_with(&directory){return Err("旧文件不在收件箱内。".into());}
                let raw=fs::read(path).map_err(err)?;let value:Value=serde_json::from_slice(&raw).map_err(err)?;
                let note=value["text"].as_str().unwrap_or("");let names=value["files"].as_array().ok_or("旧记录缺少文件列表。")?;let mut files=Vec::new();let mut total=0;
                if names.len()>8{return Err("旧记录附件过多，请手动分批导入。".into());}
                for name in names {
                    let name=name.as_str().ok_or("旧文件名无效。")?;
                    if name.contains(['/', '\\'])||name.len()>80{return Err("旧文件名无效。".into());}
                    let expected=name.split('.').next().ok_or("文件缺少哈希。")?;
                    if expected.len()!=64||!expected.bytes().all(|c|c.is_ascii_hexdigit()){return Err("旧文件缺少内容哈希。".into());}
                    let path=directory.join(name).canonicalize().map_err(err)?;if !path.starts_with(&directory){return Err("旧文件不在收件箱内。".into());}
                    let size=fs::metadata(&path).map_err(err)?.len();total+=size;if total>MAX_INPUT_BYTES as u64{return Err("旧附件合计超过 20 MB。".into());}
                    let bytes=fs::read(path).map_err(err)?;if hash(&bytes)!=expected{return Err("旧文件哈希不一致。".into());}files.push(InputFile{name:name.into(),bytes});
                }
                receive(&mut connection,&format!("legacy-{}",hash(&raw)),note,files,"legacy")?;Ok(())
            })();
            if result.is_ok(){recovered+=1;}else{failed+=1;}
        }
        Ok(json!({"recovered":recovered,"failed":failed,"note":"旧目录原件未删除，重复恢复不会新增同一提交；失败项可手动导入。"}))
    }).await.map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(crate) fn png() -> Vec<u8> {
        let mut data = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            64,
            40,
            Rgba([255, 255, 255, 255]),
        ))
        .write_to(&mut data, image::ImageFormat::Png)
        .unwrap();
        data.into_inner()
    }
    fn file() -> InputFile {
        InputFile {
            name: "test.png".into(),
            bytes: png(),
        }
    }
    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::domain_store::ensure_repository_schema(&c).unwrap();
        c
    }
    #[test]
    fn intake_deduplicates_bytes_but_preserves_receipts_and_retry_identity() {
        let mut c = conn();
        receive(
            &mut c,
            "request-first-001",
            "first",
            vec![file()],
            "desktop",
        )
        .unwrap();
        assert_eq!(
            receive(
                &mut c,
                "request-first-001",
                "first",
                vec![file()],
                "desktop"
            )
            .unwrap()["replayed"],
            true
        );
        assert!(receive(
            &mut c,
            "request-first-001",
            "changed",
            vec![file()],
            "desktop"
        )
        .is_err());
        receive(
            &mut c,
            "request-second-001",
            "second",
            vec![file()],
            "mobile",
        )
        .unwrap();
        assert_eq!(storage(&c).unwrap()["count"], 1);
        let list = receipts(&c, false, 0).unwrap();
        assert_eq!(list["items"].as_array().unwrap().len(), 2);
        let text = serde_json::to_string(&list).unwrap();
        assert!(!text.contains("255,255"));
        assert!(!text.contains("thumb"));
        verify(&c).unwrap();
    }
    #[test]
    fn bad_images_or_revoked_sessions_leave_no_half_submission() {
        let mut c = conn();
        assert!(receive(
            &mut c,
            "request-invalid-001",
            "note",
            vec![
                file(),
                InputFile {
                    name: "fake.jpg".into(),
                    bytes: b"not an image".to_vec()
                }
            ],
            "mobile"
        )
        .is_err());
        let called = std::cell::Cell::new(0);
        assert!(receive_guarded(
            &mut c,
            "request-revoked-001",
            "note",
            vec![file()],
            "mobile",
            || {
                called.set(called.get() + 1);
                called.get() < 2
            }
        )
        .is_err());
        assert_eq!(storage(&c).unwrap()["count"], 0);
        assert_eq!(receipts(&c, false, 0).unwrap()["unreviewedCount"], 0);
        let mut bad = png();
        bad.truncate(30);
        assert!(prepare(InputFile {
            name: "bad.png".into(),
            bytes: bad
        })
        .is_err());
        assert!(receive(&mut c, "request-empty-001", "", vec![], "desktop").is_err());
    }
    #[test]
    fn redaction_has_black_pixels_preserves_original_and_survives_reopen() {
        let directory =
            std::env::temp_dir().join(format!("fitwise-artifact-test-{}", rand::random::<u64>()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("test.db");
        let mut c = Connection::open(&path).unwrap();
        receive(
            &mut c,
            "request-redact-001",
            "note",
            vec![file()],
            "desktop",
        )
        .unwrap();
        let id = hash(&png());
        assert!(redact(
            &c,
            &id,
            &[Mask {
                x: f64::NAN,
                y: 0.0,
                width: 0.1,
                height: 0.1
            }]
        )
        .is_err());
        redact(
            &c,
            &id,
            &[Mask {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            }],
        )
        .unwrap();
        let bytes = preview(&c, &id, "privacy").unwrap();
        let image = decoded(&bytes).unwrap().to_rgba8();
        assert_eq!(image.get_pixel(32, 20), &Rgba([0, 0, 0, 255]));
        assert_eq!(image.get_pixel(0, 0), &Rgba([255, 255, 255, 255]));
        let original: Vec<u8> = c
            .query_row(
                "SELECT original FROM input_artifact_objects WHERE id=?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(original, png());
        drop(c);
        let c = Connection::open(&path).unwrap();
        assert!(receipts(&c, false, 0).unwrap()["items"][0]["privacyHash"].is_string());
        verify(&c).unwrap();
        drop(c);
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn trash_restore_and_tombstone_keep_sources_and_reimport_is_consistent() {
        let mut c = conn();
        receive(&mut c, "request-trash-001", "keep", vec![file()], "desktop").unwrap();
        let id = hash(&png());
        redact(
            &c,
            &id,
            &[Mask {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 0.5,
            }],
        )
        .unwrap();
        manage(&c, &id, "trash").unwrap();
        assert!(preview(&c, &id, "preview").is_err());
        assert!(manage(&c, &id, "purge_expired").is_err());
        manage(&c, &id, "restore").unwrap();
        assert!(preview(&c, &id, "privacy").is_ok());
        manage(&c, &id, "trash").unwrap();
        c.execute(
            "UPDATE input_artifact_objects SET trashed_at=?1",
            [(Utc::now() - Duration::days(31)).to_rfc3339()],
        )
        .unwrap();
        manage(&c, &id, "purge_expired").unwrap();
        assert!(manage(&c, &id, "restore").is_err());
        assert!(receipts(&c, false, 0).unwrap()["items"][0]["purgedAt"].is_string());
        verify(&c).unwrap();
        receive(
            &mut c,
            "request-reimport-001",
            "again",
            vec![file()],
            "desktop",
        )
        .unwrap();
        verify(&c).unwrap();
        assert!(preview(&c, &id, "privacy").is_err());
        assert_eq!(
            receipts(&c, false, 0).unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn pagination_bounds_queries_and_thumbnail_not_original_is_returned() {
        let mut c = conn();
        for i in 0..55 {
            receive(
                &mut c,
                &format!("request-page-{i:04}"),
                "note",
                vec![file()],
                "desktop",
            )
            .unwrap();
        }
        let first = receipts(&c, false, 0).unwrap();
        assert_eq!(first["items"].as_array().unwrap().len(), 50);
        assert_eq!(first["hasMore"], true);
        assert_eq!(
            receipts(&c, false, 50).unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        assert_eq!(storage(&c).unwrap()["count"], 1);
        let id = hash(&png());
        let image = decoded(&preview(&c, &id, "thumbnail").unwrap()).unwrap();
        assert!(image.width() <= 512 && image.height() <= 512);
        c.execute("UPDATE input_artifact_objects SET original=x'0102'", [])
            .unwrap();
        assert!(verify(&c).is_err());
    }
    #[test]
    fn failed_receipt_insert_rolls_back_blob_and_audit() {
        let mut c = conn();
        c.execute_batch("CREATE TRIGGER reject_intake BEFORE INSERT ON input_receipts BEGIN SELECT RAISE(FAIL,'simulated disk failure'); END;").unwrap();
        assert!(receive(
            &mut c,
            "request-failure-001",
            "note",
            vec![file()],
            "desktop"
        )
        .is_err());
        assert_eq!(storage(&c).unwrap()["count"], 0);
        let audits: i64 = c
            .query_row("SELECT COUNT(*) FROM input_artifact_audit", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(audits, 0);
        c.execute_batch("DROP TRIGGER reject_intake;").unwrap();
        receive(
            &mut c,
            "request-failure-001",
            "note",
            vec![file()],
            "desktop",
        )
        .unwrap();
        assert_eq!(storage(&c).unwrap()["count"], 1);
    }
    #[test]
    fn file_size_and_pixel_limits_are_checked_before_storing() {
        assert!(prepare(InputFile {
            name: "large.png".into(),
            bytes: vec![0; MAX_INPUT_BYTES + 1]
        })
        .is_err());
        let image = DynamicImage::new_rgb8(4001, 4000);
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        assert!(prepare(InputFile {
            name: "too-many-pixels.png".into(),
            bytes: bytes.into_inner()
        })
        .is_err());
    }
}
