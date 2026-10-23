//! This device's sync configuration: which provider, its credentials, the device id and the
//! unwrapped sync key. Stored as one row of the `settings` table, AES-GCM under the vault key — so
//! the WebDAV app password, the Google refresh token and the sync key are never on disk in
//! plaintext and are unreadable while the vault is locked. Never synced.

use super::error::{SyncError, SyncResult};
use crate::crypto::{decrypt_string_from_blob, encrypt_string_to_blob, VaultKey};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const SETTINGS_KEY: &str = "sync_config";

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Provider {
    Webdav { url: String, username: String, password: String },
    Google { refresh_token: String },
}

impl Provider {
    pub fn name(&self) -> &'static str {
        match self {
            Provider::Webdav { .. } => "webdav",
            Provider::Google { .. } => "google",
        }
    }
}

// Hand-written so a `{:?}` can never print a password or token.
impl std::fmt::Debug for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Provider::Webdav { url, username, .. } => f
                .debug_struct("Webdav")
                .field("url", url)
                .field("username", username)
                .field("password", &"<redacted>")
                .finish(),
            Provider::Google { .. } => f.debug_struct("Google").field("refresh_token", &"<redacted>").finish(),
        }
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SyncConfig {
    pub provider: Provider,
    pub device_id: String,
    /// Base64 sync key; `None` while waiting for the remote vault's master password.
    #[serde(default)]
    pub sync_key: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    pub connected_at: String,
}

impl std::fmt::Debug for SyncConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SyncConfig")
            .field("provider", &self.provider)
            .field("device_id", &self.device_id)
            .field("sync_key", &self.sync_key.as_ref().map(|_| "<redacted>"))
            .field("last_sync_at", &self.last_sync_at)
            .finish()
    }
}

impl SyncConfig {
    pub fn sync_key(&self) -> SyncResult<Option<[u8; 32]>> {
        let Some(encoded) = &self.sync_key else { return Ok(None) };
        let bytes = BASE64.decode(encoded).map_err(|_| SyncError::Local("sync key".to_string()))?;
        let key: [u8; 32] = bytes.try_into().map_err(|_| SyncError::Local("sync key".to_string()))?;
        Ok(Some(key))
    }

    pub fn set_sync_key(&mut self, key: &[u8; 32]) {
        self.sync_key = Some(BASE64.encode(key));
    }
}

pub fn load(conn: &Connection, key: &VaultKey) -> SyncResult<Option<SyncConfig>> {
    let blob = conn
        .query_row(
            "SELECT value_ciphertext FROM settings WHERE key = ?1",
            [SETTINGS_KEY],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?;
    let Some(blob) = blob else { return Ok(None) };
    let json = decrypt_string_from_blob(key, &blob).map_err(|_| SyncError::Local("sync config".to_string()))?;
    let config = serde_json::from_str(&json).map_err(|_| SyncError::Local("sync config".to_string()))?;
    Ok(Some(config))
}

pub fn save(conn: &Connection, key: &VaultKey, config: &SyncConfig) -> SyncResult<()> {
    let json = serde_json::to_string(config).map_err(|_| SyncError::Local("sync config".to_string()))?;
    let blob = encrypt_string_to_blob(key, &json).map_err(|_| SyncError::Local("sync config".to_string()))?;
    conn.execute(
        "INSERT INTO settings (key, value_ciphertext) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value_ciphertext = excluded.value_ciphertext",
        params![SETTINGS_KEY, blob],
    )?;
    Ok(())
}

pub fn clear(conn: &Connection) -> SyncResult<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [SETTINGS_KEY])?;
    Ok(())
}
