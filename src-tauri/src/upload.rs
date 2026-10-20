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
use std::{
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, State as TauriState};
use tokio::{net::TcpListener, sync::oneshot};

const SESSION_MINUTES: i64 = 10;
const MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;

struct ActiveServer {
    shutdown: oneshot::Sender<()>,
    revoked: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct UploadServerControl {
    inner: Arc<Mutex<Option<ActiveServer>>>,
}

#[derive(Clone)]
struct UploadContext {
    token: String,
    expires_at: chrono::DateTime<Utc>,
    revoked: Arc<AtomicBool>,
    app: AppHandle,
    ip: std::net::Ipv4Addr,
    intake_slot: Arc<tokio::sync::Semaphore>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSessionInfo {
    url: String,
    token: String,
    expires_at: String,
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
    if !trusted_profile(ipv4) {
        return Err("Windows 未将当前适配器识别为专用/域网络，或网络状态无法确认。请手动检查网络配置；程序不会修改设置。也可改用本地导入。".into());
    }

    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    let expires_at = Utc::now() + Duration::minutes(SESSION_MINUTES);
    // Bind only the selected private adapter. Binding 0.0.0.0 would make an
    // already-running session reachable through a newly connected public adapter.
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(ipv4), 0))
        .await
        .map_err(|error| format!("无法启动手机上传服务：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let revoked = Arc::new(AtomicBool::new(false));
    let context = Arc::new(UploadContext {
        token: token.clone(),
        expires_at,
        revoked: revoked.clone(),
        app,
        ip: ipv4,
        intake_slot: Arc::new(tokio::sync::Semaphore::new(1)),
    });
    let shutdown_revoked = revoked.clone();
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
                _ = async {loop{tokio::time::sleep(std::time::Duration::from_secs(5)).await;if !trusted_profile(ipv4){break;}}} => {},
            }
            shutdown_revoked.store(true, Ordering::SeqCst);
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
        revoked,
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
            active.revoked.store(true, Ordering::SeqCst);
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
    let _slot = match context.intake_slot.clone().try_acquire_owned() {
        Ok(slot) => slot,
        Err(_) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Html(message_html("另一份上传正在处理，请稍后重试。")),
            )
                .into_response()
        }
    };
    let mut files = Vec::new();
    let mut request_id = String::new();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Html(message_html("上传不完整或超过限制，未保存本次提交。")),
                )
                    .into_response()
            }
        };
        let field_name = field.name().unwrap_or_default().to_string();
        if field_name == "request_id" {
            request_id = field.text().await.unwrap_or_default();
            continue;
        }
        if field_name == "note" {
            text = match field.text().await {
                Ok(v) => v,
                Err(_) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Html(message_html("文字读取失败，未保存本次提交。")),
                    )
                        .into_response()
                }
            };
            continue;
        }
        if field_name != "files" {
            continue;
        }
        let original = field.file_name().unwrap_or("").to_string();
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Html(message_html("附件读取失败，未保存本次提交。")),
                )
                    .into_response()
            }
        };
        // Empty file picker is not an attachment.
        if bytes.is_empty() && original.is_empty() {
            continue;
        }
        files.push(crate::artifacts::InputFile {
            name: original,
            bytes: bytes.to_vec(),
        });
    }
    if text.trim().is_empty() && files.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Html(message_html("没有收到文字或文件。")),
        )
            .into_response();
    }

    if !authorized(&token, &context) {
        return (StatusCode::GONE, Html(expired_html())).into_response();
    }
    let app = context.app.clone();
    let revoked = context.revoked.clone();
    let expires = context.expires_at;
    let saved = tauri::async_runtime::spawn_blocking(move || {
        if revoked.load(Ordering::SeqCst) || Utc::now() > expires {
            return Err("上传会话已关闭。".into());
        }
        let mut connection = crate::domain_store::open_database(&app)?;
        crate::artifacts::receive_guarded(
            &mut connection,
            &request_id,
            &text,
            files,
            "mobile",
            || !revoked.load(Ordering::SeqCst) && Utc::now() <= expires,
        )
    })
    .await;
    match saved {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            return (
                StatusCode::BAD_REQUEST,
                Html(message_html(upload_failure_message(&error))),
            )
                .into_response()
        }
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Html(message_html(
                    "本机接收任务中断，未保存本次内容。请重新生成上传会话。",
                )),
            )
                .into_response()
        }
    }
    let _ = context.app.emit("mobile-inbox-changed", ());
    (
        StatusCode::OK,
        Html(message_html("已安全送达电脑收件箱，可以关闭此页面。")),
    )
        .into_response()
}

fn authorized(token: &str, context: &UploadContext) -> bool {
    token == context.token
        && !context.revoked.load(Ordering::SeqCst)
        && Utc::now() <= context.expires_at
        && trusted_profile(context.ip)
}

#[cfg(target_os = "windows")]
fn trusted_profile(ip: std::net::Ipv4Addr) -> bool {
    use std::os::windows::process::CommandExt;
    // Static, read-only OS query; `ip` is an Ipv4Addr, never user-provided code.
    let script=format!("$ErrorActionPreference='Stop'; $a=Get-NetIPAddress -AddressFamily IPv4 -IPAddress '{ip}'; $p=Get-NetConnectionProfile -InterfaceIndex $a.InterfaceIndex; if (@($p).Count -eq 1 -and $p.NetworkCategory -in @('Private','DomainAuthenticated')) {{ 'trusted' }}");
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000)
        .output()
        .is_ok_and(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "trusted")
}
#[cfg(not(target_os = "windows"))]
fn trusted_profile(_: std::net::Ipv4Addr) -> bool {
    false
}

fn response_html(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>body{{margin:0;background:#f1f3ee;color:#19231f;font-family:system-ui,"Microsoft YaHei",sans-serif}}main{{max-width:520px;margin:0 auto;padding:42px 20px}}section{{padding:26px;border:1px solid #dce2dc;border-radius:20px;background:#fff;box-shadow:0 18px 50px rgba(35,55,46,.08)}}h1{{font-size:25px}}p{{color:#6f7b74;line-height:1.7;font-size:14px}}textarea,input{{box-sizing:border-box;width:100%;margin:8px 0 16px;padding:12px;border:1px solid #dce2dc;border-radius:11px}}textarea{{min-height:120px}}button{{width:100%;padding:13px;color:#fff;font-weight:700;border:0;border-radius:11px;background:#276a53}}small{{display:block;margin-top:14px;color:#849088;text-align:center}}</style></head><body><main><section>{body}</section></main></body></html>"#
    )
}

fn form_html() -> String {
    let request_id: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    response_html(
        "轻衡手机上传",
        &format!(
            r#"<h1>发送到轻衡收件箱</h1><p>内容只会保存在电脑，不会自动成为饮食、库存或运动记录。仅在可信局域网使用，HTTP 不提供传输加密。</p><form method="post" enctype="multipart/form-data"><input type="hidden" name="request_id" value="{request_id}"><label>截图、标签或食物照片（PNG/JPEG/WebP/PDF）</label><input name="files" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" multiple><label>文字或商品链接</label><textarea name="note" placeholder="可粘贴商品链接、食物说明或备注"></textarea><button type="submit">发送到电脑</button></form><small>会话十分钟内有效 · 单次最多 8 个附件，合计不超过 20 MB · 图片不超过 1600 万像素</small>"#
        ),
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

// Return only fixed public messages, not database errors, local paths, or text
// supplied in an attachment. Never interpolate untrusted errors into HTML.
fn upload_failure_message(error: &str) -> &'static str {
    if error.contains("1600 万像素") {
        "图片超过 1600 万像素，请先缩小图片再上传。本次内容未保存。"
    } else if error.contains("20 MB") || error.contains("10000 字") {
        "单次最多 8 个附件、合计 20 MB，文字最多 10000 字。请减少内容后重试；本次未保存。"
    } else if error.contains("目前支持") {
        "仅支持 PNG、JPEG、WebP 及 PDF 原件。HEIC 请先转换；修改后缀无效。本次内容未保存。"
    } else if error.contains("会话") {
        "上传会话已结束或网络不再可信，请在电脑重新生成二维码。本次内容未保存。"
    } else if error.contains("解码") {
        "图片损坏或无法读取，请重新导出为 PNG/JPEG 后上传。本次内容未保存。"
    } else if error.contains("同一接收请求") {
        "这一页面已提交过不同内容，请重新扫码打开上传页。本次改动未保存。"
    } else {
        "电脑存储或文件处理失败，未保存本次内容。请检查可用空间并在电脑端重试。"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upload_errors_are_actionable_and_do_not_echo_private_or_html_content() {
        assert!(upload_failure_message("图片超过 1600 万像素").contains("缩小"));
        assert!(upload_failure_message("目前支持 PNG").contains("HEIC"));
        assert!(upload_failure_message("上传会话已结束").contains("二维码"));
        let html = message_html(upload_failure_message(
            "<script>alert(1)</script> C:\\private.db",
        ));
        assert!(!html.contains("<script>"));
        assert!(!html.contains("private.db"));
    }
}
