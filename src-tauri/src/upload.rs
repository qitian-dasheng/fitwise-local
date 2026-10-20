use axum::{
    extract::{DefaultBodyLimit, Multipart, Path as AxumPath, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use chrono::{Duration, Utc};
use local_ip_address::local_ip;
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tokio::{net::TcpListener, sync::oneshot};

const SESSION_MINUTES: i64 = 10;
const MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;

struct ActiveServer {
    shutdown: oneshot::Sender<()>,
}

#[derive(Clone, Default)]
pub struct UploadServerControl {
    inner: Arc<Mutex<Option<ActiveServer>>>,
}

#[derive(Clone)]
struct UploadContext {
    token: String,
    expires_at: chrono::DateTime<Utc>,
    inbox_dir: PathBuf,
    app: AppHandle,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSessionInfo {
    url: String,
    token: String,
    expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadEvent {
    received_at: String,
    text: String,
    files: Vec<String>,
}

#[tauri::command]
pub async fn start_mobile_upload(
    app: AppHandle,
    control: TauriState<'_, UploadServerControl>,
) -> Result<UploadSessionInfo, String> {
    stop_existing(&control);

    let ip = local_ip().map_err(|error| format!("无法确定局域网地址：{error}"))?;
    let ipv4 = match ip {
        IpAddr::V4(value) if value.is_private() => value,
        _ => {
            return Err(
                "当前网络不是受支持的私有 IPv4 局域网。请连接可信任的家庭网络后重试。".into(),
            )
        }
    };

    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    let expires_at = Utc::now() + Duration::minutes(SESSION_MINUTES);
    let inbox_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("inbox");
    tokio::fs::create_dir_all(&inbox_dir)
        .await
        .map_err(|error| format!("无法创建收件箱：{error}"))?;

    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0))
        .await
        .map_err(|error| format!("无法启动手机上传服务：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let context = Arc::new(UploadContext {
        token: token.clone(),
        expires_at: expires_at.clone(),
        inbox_dir,
        app,
    });
    let router = Router::new()
        .route("/u/{token}", get(upload_page).post(receive_upload))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
        .with_state(context);
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    tokio::spawn(async move {
        let shutdown = async move {
            tokio::select! {
                _ = shutdown_rx => {},
                _ = tokio::time::sleep(std::time::Duration::from_secs((SESSION_MINUTES * 60) as u64)) => {},
            }
        };
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await;
    });
    *control
        .inner
        .lock()
        .map_err(|_| "上传服务状态锁损坏".to_string())? = Some(ActiveServer {
        shutdown: shutdown_tx,
    });

    Ok(UploadSessionInfo {
        url: format!("http://{ipv4}:{port}/u/{token}"),
        token,
        expires_at: expires_at.to_rfc3339(),
    })
}

#[tauri::command]
pub fn stop_mobile_upload(control: TauriState<'_, UploadServerControl>) -> Result<(), String> {
    stop_existing(&control);
    Ok(())
}

fn stop_existing(control: &UploadServerControl) {
    if let Ok(mut guard) = control.inner.lock() {
        if let Some(active) = guard.take() {
            let _ = active.shutdown.send(());
        }
    }
}

async fn upload_page(
    AxumPath(token): AxumPath<String>,
    State(context): State<Arc<UploadContext>>,
) -> impl IntoResponse {
    if !authorized(&token, &context) {
        return (StatusCode::GONE, Html(expired_html())).into_response();
    }
    (StatusCode::OK, Html(form_html())).into_response()
}

async fn receive_upload(
    AxumPath(token): AxumPath<String>,
    State(context): State<Arc<UploadContext>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if !authorized(&token, &context) {
        return (StatusCode::GONE, Html(expired_html())).into_response();
    }

    let mut text = String::new();
    let mut saved = Vec::new();
    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or_default().to_string();
        if field_name == "note" {
            if let Ok(value) = field.text().await {
                text = value.chars().take(10_000).collect();
            }
            continue;
        }
        if field_name != "files" {
            continue;
        }
        let original = field.file_name().unwrap_or("upload.bin").to_string();
        let extension = safe_extension(&original);
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let hash = format!("{:x}", hasher.finalize());
        let filename = format!("{hash}.{extension}");
        let target = context.inbox_dir.join(&filename);
        if tokio::fs::metadata(&target).await.is_err()
            && tokio::fs::write(&target, &bytes).await.is_err()
        {
            continue;
        }
        saved.push(filename);
    }

    if text.trim().is_empty() && saved.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Html(message_html("没有收到文字或文件。")),
        )
            .into_response();
    }

    let event = UploadEvent {
        received_at: Utc::now().to_rfc3339(),
        text,
        files: saved,
    };
    let metadata_name = format!("submission-{}.json", Utc::now().timestamp_millis());
    if let Ok(json) = serde_json::to_vec_pretty(&event) {
        let _ = tokio::fs::write(context.inbox_dir.join(metadata_name), json).await;
    }
    let _ = context.app.emit("mobile-inbox-changed", &event);
    (
        StatusCode::OK,
        Html(message_html("已安全送达电脑收件箱，可以关闭此页面。")),
    )
        .into_response()
}

fn authorized(token: &str, context: &UploadContext) -> bool {
    token == context.token && Utc::now() <= context.expires_at
}

fn safe_extension(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| {
            matches!(
                value.as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "heic" | "pdf"
            )
        })
        .unwrap_or_else(|| "bin".into())
}

fn response_html(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>body{{margin:0;background:#f1f3ee;color:#19231f;font-family:system-ui,"Microsoft YaHei",sans-serif}}main{{max-width:520px;margin:0 auto;padding:42px 20px}}section{{padding:26px;border:1px solid #dce2dc;border-radius:20px;background:#fff;box-shadow:0 18px 50px rgba(35,55,46,.08)}}h1{{font-size:25px}}p{{color:#6f7b74;line-height:1.7;font-size:14px}}textarea,input{{box-sizing:border-box;width:100%;margin:8px 0 16px;padding:12px;border:1px solid #dce2dc;border-radius:11px}}textarea{{min-height:120px}}button{{width:100%;padding:13px;color:#fff;font-weight:700;border:0;border-radius:11px;background:#276a53}}small{{display:block;margin-top:14px;color:#849088;text-align:center}}</style></head><body><main><section>{body}</section></main></body></html>"#
    )
}

fn form_html() -> String {
    response_html(
        "轻衡手机上传",
        r#"<h1>发送到轻衡收件箱</h1><p>内容只会进入电脑上的待确认收件箱，不会自动成为饮食、库存或运动记录。</p><form method="post" enctype="multipart/form-data"><label>截图、标签或食物照片</label><input name="files" type="file" accept="image/*,.pdf" multiple><label>文字或商品链接</label><textarea name="note" placeholder="可粘贴商品链接、食物说明或备注"></textarea><button type="submit">发送到电脑</button></form><small>会话十分钟内有效 · 单次总量不超过 20 MB</small>"#,
    )
}

fn expired_html() -> String {
    response_html(
        "会话已结束",
        "<h1>上传会话已结束</h1><p>请回到电脑上的轻衡应用，重新生成一次性二维码。</p>",
    )
}

fn message_html(message: &str) -> String {
    response_html(
        "轻衡收件箱",
        &format!("<h1>{message}</h1><p>正式记录仍需要在电脑端检查和确认。</p>"),
    )
}
