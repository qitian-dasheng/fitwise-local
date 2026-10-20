use keyring::{Entry, Error as KeyringError};
use serde::Serialize;

const SERVICE: &str = "cn.fitwise.local.ai";
const ALLOWED_PROVIDERS: &[&str] = &["openai", "deepseek", "openai-compatible"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    provider: String,
    configured: bool,
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if ALLOWED_PROVIDERS.contains(&provider) {
        Ok(())
    } else {
        Err("不支持的 AI 提供商".to_string())
    }
}

fn entry(provider: &str) -> Result<Entry, String> {
    validate_provider(provider)?;
    Entry::new(SERVICE, provider).map_err(|_| "无法访问 Windows 凭据存储".to_string())
}

#[tauri::command]
pub async fn save_ai_credential(
    provider: String,
    api_key: String,
) -> Result<CredentialStatus, String> {
    if api_key.trim().len() < 8 {
        return Err("API Key 看起来过短".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let credential = entry(&provider)?;
        credential
            .set_password(api_key.trim())
            .map_err(|_| "保存 API Key 失败".to_string())?;
        Ok(CredentialStatus {
            provider,
            configured: true,
        })
    })
    .await
    .map_err(|_| "凭据任务意外终止".to_string())?
}

#[tauri::command]
pub async fn delete_ai_credential(provider: String) -> Result<CredentialStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let credential = entry(&provider)?;
        match credential.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(CredentialStatus {
                provider,
                configured: false,
            }),
            Err(_) => Err("删除 API Key 失败".to_string()),
        }
    })
    .await
    .map_err(|_| "凭据任务意外终止".to_string())?
}

#[tauri::command]
pub async fn get_ai_credential_status(provider: String) -> Result<CredentialStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let credential = entry(&provider)?;
        let configured = match credential.get_password() {
            Ok(value) => !value.is_empty(),
            Err(KeyringError::NoEntry) => false,
            Err(_) => return Err("读取 API Key 状态失败".to_string()),
        };
        Ok(CredentialStatus {
            provider,
            configured,
        })
    })
    .await
    .map_err(|_| "凭据任务意外终止".to_string())?
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn windows_credential_manager_round_trip() {
        let service = format!("cn.fitwise.local.test.{}", std::process::id());
        let credential = Entry::new(&service, "integration-test").unwrap();
        let _ = credential.delete_credential();
        credential.set_password("temporary-test-secret").unwrap();
        assert_eq!(credential.get_password().unwrap(), "temporary-test-secret");
        credential.delete_credential().unwrap();
        assert!(matches!(
            credential.get_password(),
            Err(KeyringError::NoEntry)
        ));
    }
}
