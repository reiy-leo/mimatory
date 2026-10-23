//! Sync errors. The `Display` text is the short Chinese message the UI may show as-is; `code()` and
//! `http_status()` let the frontend translate instead (zh/en/ja), so the UI never has to parse prose.
//! Nothing here may carry a secret: no URL with credentials, no token, no response body beyond a
//! short provider error string.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("{}", http_message(*.status, .detail))]
    Http { status: u16, detail: String },
    #[error("网络错误：{0}")]
    Network(String),
    #[error("同步数据无法解密（数据损坏或密钥不对）")]
    Decrypt,
    #[error("远端同步数据格式不受支持（版本 {0}），请先更新应用")]
    UnsupportedFormat(u32),
    #[error("远端同步数据无效：{0}")]
    InvalidRemote(String),
    #[error("需要输入远端保管库的主密码")]
    RemotePasswordRequired,
    #[error("主密码与远端保管库不匹配")]
    RemotePasswordWrong,
    #[error("未连接同步")]
    NotConnected,
    #[error("保管库已锁定")]
    Locked,
    #[error("其他设备正在写入，多次重试仍冲突（412 前置条件失败）")]
    ConflictRetriesExhausted,
    #[error("Google 同步未配置（构建时缺少 MIMATORY_GOOGLE_CLIENT_ID）")]
    GoogleNotConfigured,
    #[error("此平台暂不支持 Google 同步")]
    GoogleUnsupportedPlatform,
    #[error("Google 授权已失效，请重新连接")]
    GoogleReauth,
    #[error("授权已取消或超时")]
    OAuthCancelled,
    #[error("WebDAV 地址无效（需要 https://）")]
    InvalidUrl,
    #[error("同步正在进行")]
    Busy,
    #[error("本地数据错误：{0}")]
    Local(String),
}

pub type SyncResult<T> = Result<T, SyncError>;

/// Short Chinese gloss for an HTTP status (owner rule 2026-10-13: every response code shown carries one).
pub fn http_gloss(status: u16) -> &'static str {
    match status {
        301 | 302 | 307 | 308 => "重定向",
        400 => "请求错误",
        401 => "未授权",
        403 => "禁止访问",
        404 => "未找到",
        405 => "方法不允许",
        408 => "请求超时",
        409 => "冲突",
        412 => "前置条件失败",
        413 => "请求体过大",
        423 => "资源已锁定",
        429 => "请求过多",
        500 => "服务器内部错误",
        501 => "未实现",
        502 => "网关错误",
        503 => "服务不可用",
        504 => "网关超时",
        507 => "存储空间不足",
        _ => "HTTP 错误",
    }
}

fn http_message(status: u16, detail: &str) -> String {
    let hint = match status {
        301 | 302 | 307 | 308 => "，请检查服务器地址",
        401 => "：用户名或应用密码不对",
        403 => "：没有权限访问该目录",
        507 => "：网盘空间已满",
        _ => "",
    };
    if detail.is_empty() {
        format!("{status} {}{hint}", http_gloss(status))
    } else {
        format!("{status} {}{hint}（{detail}）", http_gloss(status))
    }
}

impl SyncError {
    pub fn http(status: u16) -> Self {
        SyncError::Http { status, detail: String::new() }
    }

    pub fn is_conflict(&self) -> bool {
        matches!(self, SyncError::Http { status: 412, .. })
    }

    /// Stable machine-readable kind for the frontend's i18n lookup.
    pub fn code(&self) -> &'static str {
        match self {
            SyncError::Http { .. } => "http",
            SyncError::Network(_) => "network",
            SyncError::Decrypt => "decrypt",
            SyncError::UnsupportedFormat(_) => "unsupported_format",
            SyncError::InvalidRemote(_) => "invalid_remote",
            SyncError::RemotePasswordRequired => "remote_password_required",
            SyncError::RemotePasswordWrong => "remote_password_wrong",
            SyncError::NotConnected => "not_connected",
            SyncError::Locked => "locked",
            SyncError::ConflictRetriesExhausted => "conflict",
            SyncError::GoogleNotConfigured => "google_not_configured",
            SyncError::GoogleUnsupportedPlatform => "google_unsupported_platform",
            SyncError::GoogleReauth => "google_reauth",
            SyncError::OAuthCancelled => "oauth_cancelled",
            SyncError::InvalidUrl => "invalid_url",
            SyncError::Busy => "busy",
            SyncError::Local(_) => "local",
        }
    }

    pub fn http_status(&self) -> Option<u16> {
        match self {
            SyncError::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub fn info(&self) -> SyncErrorInfo {
        SyncErrorInfo {
            code: self.code().to_string(),
            status: self.http_status(),
            message: self.to_string(),
        }
    }
}

/// What crosses the bridge for a failed sync.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SyncErrorInfo {
    pub code: String,
    pub status: Option<u16>,
    pub message: String,
}

impl From<reqwest::Error> for SyncError {
    fn from(error: reqwest::Error) -> Self {
        // reqwest's Display can include the request URL; strip it so a WebDAV URL with
        // embedded credentials (or a token in a query) can never reach a log or the UI.
        let error = error.without_url();
        if error.is_timeout() {
            return SyncError::Network("408 请求超时".to_string());
        }
        if let Some(status) = error.status() {
            return SyncError::http(status.as_u16());
        }
        if error.is_connect() {
            return SyncError::Network("无法连接服务器".to_string());
        }
        SyncError::Network(error.to_string())
    }
}

impl From<rusqlite::Error> for SyncError {
    fn from(error: rusqlite::Error) -> Self {
        SyncError::Local(error.to_string())
    }
}

impl From<crate::crypto::CryptoError> for SyncError {
    fn from(_: crate::crypto::CryptoError) -> Self {
        SyncError::Decrypt
    }
}

impl From<serde_json::Error> for SyncError {
    fn from(error: serde_json::Error) -> Self {
        SyncError::InvalidRemote(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_errors_carry_a_chinese_gloss() {
        assert_eq!(SyncError::http(412).to_string(), "412 前置条件失败");
        assert_eq!(SyncError::http(401).to_string(), "401 未授权：用户名或应用密码不对");
        let info = SyncError::http(507).info();
        assert_eq!(info.code, "http");
        assert_eq!(info.status, Some(507));
        assert!(SyncError::http(412).is_conflict());
    }
}
