//! 更新器代理跟随（0.11.0）：读 Windows 系统代理（WinINET 注册表）供更新检查/下载使用。
//!
//! 根因背景（v0.10.0 首验）：系统级代理开启（如 Clash Verge 127.0.0.1:7897）时浏览器经代理
//! 可通，但 tauri-plugin-updater 的 reqwest 不读 Windows 系统代理，直连 GitHub 被断，
//! 下载截断导致「signature verification failed」。本命令让前端在检查更新时显式传代理。

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProxy {
    /// "http://127.0.0.1:7897" 形式；ProxyEnable=0 时为 None。
    pub url: Option<String>,
}

/// 解析 WinINET 注册表值 → 代理 URL。纯函数（可测试，不碰真实注册表）。
/// 支持 "host:port" 与 "scheme://host:port"（分号分隔多协议时取 http/默认项）。
pub(crate) fn parse_proxy_server(server: &str, enabled: bool) -> Option<String> {
    if !enabled || server.trim().is_empty() {
        return None;
    }
    let first = server.split(';').next().unwrap_or(server).trim();
    if first.is_empty() {
        return None;
    }
    if first.contains("://") {
        Some(first.to_owned())
    } else if let Some((scheme, host)) = first.split_once('=') {
        // WinINET 多协议写法："http=127.0.0.1:7897;ftp=..." → scheme=http。
        let scheme = scheme.trim();
        if scheme.is_empty() || scheme.contains('.') {
            // 疑似主机名而非协议标记（如 "proxy.corp=8080" 罕见写法不猜）：按 http 处理。
            Some(format!("http://{first}"))
        } else {
            Some(format!("{scheme}://{host}"))
        }
    } else {
        Some(format!("http://{first}"))
    }
}

/// 读当前用户 WinINET 系统代理。非 Windows 返回 None。
#[tauri::command]
pub fn get_system_proxy() -> Option<SystemProxy> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        let settings = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings", KEY_READ)
            .ok()?;
        let enabled = settings.get_value::<u32, _>("ProxyEnable").unwrap_or(0) != 0;
        let server = settings.get_value::<String, _>("ProxyServer").unwrap_or_default();
        parse_proxy_server(&server, enabled).map(|url| SystemProxy { url: Some(url) })
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::parse_proxy_server;

    #[test]
    fn parses_host_port_with_enable_flag() {
        assert_eq!(
            parse_proxy_server("127.0.0.1:7897", true),
            Some("http://127.0.0.1:7897".into())
        );
    }

    #[test]
    fn disabled_or_empty_returns_none() {
        assert_eq!(parse_proxy_server("127.0.0.1:7897", false), None);
        assert_eq!(parse_proxy_server("", true), None);
        assert_eq!(parse_proxy_server("   ", true), None);
    }

    #[test]
    fn keeps_existing_scheme_and_takes_first_entry() {
        assert_eq!(
            parse_proxy_server("socks=127.0.0.1:7890;http=127.0.0.1:7897", true),
            Some("socks://127.0.0.1:7890".into())
        );
        assert_eq!(
            parse_proxy_server("http=127.0.0.1:7897", true),
            Some("http://127.0.0.1:7897".into())
        );
        assert_eq!(
            parse_proxy_server("https://proxy.local:8443", true),
            Some("https://proxy.local:8443".into())
        );
    }
}
