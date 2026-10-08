use crate::crypto::{
    decrypt_string, decrypt_string_from_blob, derive_key, encrypt_string, encrypt_string_to_blob,
    generate_salt, CryptoError, EncryptedPayload, VaultKey,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use rand::seq::SliceRandom;
use rand::Rng;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

const DEFAULT_VAULT_ID: &str = "personal";
const MASTER_VERIFIER_TEXT: &str = "passless-master-verifier";

#[derive(Clone)]
pub struct Session {
    key: VaultKey,
    vault_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct CustomField {
    pub label: String,
    pub value: String,
    pub field_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ItemUrl {
    pub label: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct LoginItem {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub website: String,
    pub urls: Vec<ItemUrl>,
    pub notes: String,
    pub tags: Vec<String>,
    pub custom_fields: Vec<CustomField>,
    pub favorite: bool,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct VaultSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AttachmentExport {
    pub file_name: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LoginItemInput {
    #[serde(default = "default_item_type")]
    pub item_type: String,
    pub title: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub urls: Vec<ItemUrl>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub custom_fields: Vec<CustomField>,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LoginItemUpdate {
    pub id: String,
    #[serde(default = "default_item_type")]
    pub item_type: String,
    pub title: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub urls: Vec<ItemUrl>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub custom_fields: Vec<CustomField>,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PasswordGeneratorOptions {
    pub length: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub numbers: bool,
    pub symbols: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WatchtowerReport {
    pub total_items: usize,
    pub weak_passwords: Vec<String>,
    pub reused_passwords: Vec<String>,
    pub missing_websites: Vec<String>,
    pub missing_totp: Vec<String>,
    pub expiring_items: Vec<String>,
    pub score: u8,
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("master password is already configured")]
    MasterPasswordAlreadyConfigured,
    #[error("master password has not been configured")]
    MasterPasswordMissing,
    #[error("invalid master password")]
    InvalidMasterPassword,
    #[error("vault is locked")]
    Locked,
    #[error("vault not found")]
    VaultNotFound,
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("crypto error: {0}")]
    Crypto(#[from] CryptoError),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("password generator needs at least one character set")]
    EmptyCharacterSet,
}

impl From<VaultError> for String {
    fn from(error: VaultError) -> Self {
        error.to_string()
    }
}

pub struct VaultService {
    connection: Connection,
}

impl VaultService {
    pub fn new(connection: Connection) -> Self {
        Self { connection }
    }

    #[cfg(test)]
    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    pub fn has_master_password(&self) -> Result<bool, VaultError> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM meta WHERE key = 'master_salt'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .is_some())
    }

    pub fn setup_master_password(&mut self, password: &str) -> Result<Session, VaultError> {
        if self.has_master_password()? {
            return Err(VaultError::MasterPasswordAlreadyConfigured);
        }

        let salt = generate_salt();
        let key = derive_key(password, &salt)?;
        let verifier = encrypt_string(&key, MASTER_VERIFIER_TEXT)?;

        self.set_meta("master_salt", &BASE64.encode(salt))?;
        self.set_meta("master_verifier", &serde_json::to_string(&verifier)?)?;
        self.ensure_default_vault(&key)?;

        Ok(Session {
            key,
            vault_id: DEFAULT_VAULT_ID.to_string(),
        })
    }

    pub fn unlock(&mut self, password: &str) -> Result<Session, VaultError> {
        let salt = self
            .get_meta("master_salt")?
            .ok_or(VaultError::MasterPasswordMissing)?;
        let verifier = self
            .get_meta("master_verifier")?
            .ok_or(VaultError::MasterPasswordMissing)?;
        let salt = BASE64
            .decode(salt)
            .map_err(|_| VaultError::InvalidMasterPassword)?;
        let key = derive_key(password, &salt)?;
        let verifier: EncryptedPayload = serde_json::from_str(&verifier)?;
        let plaintext =
            decrypt_string(&key, &verifier).map_err(|_| VaultError::InvalidMasterPassword)?;

        if plaintext != MASTER_VERIFIER_TEXT {
            return Err(VaultError::InvalidMasterPassword);
        }

        let session = Session {
            key,
            vault_id: DEFAULT_VAULT_ID.to_string(),
        };
        self.migrate_legacy_tags(&session)?;
        self.migrate_standalone_passkeys(&session)?;
        Ok(session)
    }

    pub fn create_login_item(
        &mut self,
        session: &Session,
        input: LoginItemInput,
    ) -> Result<LoginItem, VaultError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let title_ciphertext = encrypt_string_to_blob(&session.key, input.title.trim())?;

        self.connection.execute(
            "INSERT INTO items
             (id, vault_id, item_type, title_ciphertext, favorite, archived, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
            params![
                id,
                session.vault_id,
                normalized_item_type(&input.item_type),
                title_ciphertext,
                bool_to_i64(input.favorite),
                now
            ],
        )?;

        self.replace_login_fields(
            session,
            &id,
            &input.username,
            &input.password,
            &input.notes,
            &input.custom_fields,
        )?;
        self.replace_login_tags(session, &id, &input.tags)?;
        let urls = normalized_urls(&input.website, &input.urls);
        self.replace_login_urls(session, &id, &urls)?;

        Ok(self
            .get_login_item(session, &id)?
            .expect("created login item should be readable"))
    }

    pub fn export_login_items(&self, session: &Session) -> Result<Vec<LoginItem>, VaultError> {
        self.list_login_items(session, None)
    }

    pub fn list_vaults(&self, session: &Session) -> Result<Vec<VaultSummary>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name_ciphertext, created_at, updated_at FROM vaults ORDER BY created_at ASC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        rows.into_iter()
            .map(|(id, name_ciphertext, created_at, updated_at)| {
                Ok(VaultSummary {
                    id,
                    name: decrypt_string_from_blob(&session.key, &name_ciphertext)?,
                    created_at,
                    updated_at,
                })
            })
            .collect()
    }

    pub fn create_vault(
        &mut self,
        session: &Session,
        name: &str,
    ) -> Result<VaultSummary, VaultError> {
        let name = name.trim();
        let name = if name.is_empty() { "New Vault" } else { name };
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        self.connection.execute(
            "INSERT INTO vaults (id, name_ciphertext, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![id, encrypt_string_to_blob(&session.key, name)?, now],
        )?;
        Ok(VaultSummary {
            id,
            name: name.to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn session_for_vault(
        &mut self,
        session: &Session,
        vault_id: &str,
    ) -> Result<Session, VaultError> {
        let exists = self
            .connection
            .query_row("SELECT 1 FROM vaults WHERE id = ?1", [vault_id], |_| Ok(()))
            .optional()?
            .is_some();
        if !exists {
            return Err(VaultError::VaultNotFound);
        }
        let session = Session {
            key: session.key.clone(),
            vault_id: vault_id.to_string(),
        };
        self.migrate_legacy_tags(&session)?;
        self.migrate_standalone_passkeys(&session)?;
        Ok(session)
    }

    pub fn import_login_items(
        &mut self,
        session: &Session,
        items: Vec<LoginItemInput>,
    ) -> Result<usize, VaultError> {
        let mut imported = 0;
        for item in items {
            if self.item_exists(session, &item)? {
                continue;
            }
            self.create_login_item(session, item)?;
            imported += 1;
        }
        Ok(imported)
    }

    pub fn update_login_item(
        &mut self,
        session: &Session,
        input: LoginItemUpdate,
    ) -> Result<LoginItem, VaultError> {
        let now = Utc::now().to_rfc3339();
        let title_ciphertext = encrypt_string_to_blob(&session.key, input.title.trim())?;

        self.connection.execute(
            "UPDATE items
             SET item_type = ?1, title_ciphertext = ?2, favorite = ?3, updated_at = ?4
             WHERE id = ?5 AND vault_id = ?6",
            params![
                normalized_item_type(&input.item_type),
                title_ciphertext,
                bool_to_i64(input.favorite),
                now,
                input.id,
                session.vault_id
            ],
        )?;

        self.replace_login_fields(
            session,
            &input.id,
            &input.username,
            &input.password,
            &input.notes,
            &input.custom_fields,
        )?;
        self.replace_login_tags(session, &input.id, &input.tags)?;
        let urls = normalized_urls(&input.website, &input.urls);
        self.replace_login_urls(session, &input.id, &urls)?;

        Ok(self
            .get_login_item(session, &input.id)?
            .expect("updated login item should be readable"))
    }

    pub fn trash_item(&mut self, session: &Session, item_id: &str) -> Result<(), VaultError> {
        let now = Utc::now().to_rfc3339();
        let trashed = self.connection.execute(
            "UPDATE items SET trashed = 1, deleted_at = ?1, updated_at = ?1
             WHERE id = ?2 AND vault_id = ?3 AND trashed = 0",
            params![now, item_id, session.vault_id],
        )?;
        if trashed > 0 {
            self.record_event("trash_item", &format!("Trashed item {item_id}"))?;
        }
        Ok(())
    }

    pub fn list_trashed_login_items(
        &self,
        session: &Session,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT id FROM items
             WHERE vault_id = ?1 AND trashed = 1
             ORDER BY deleted_at DESC",
        )?;
        let ids = statement
            .query_map([&session.vault_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let mut items = Vec::new();
        for id in ids {
            if let Some(item) = self.get_login_item(session, &id)? {
                items.push(item);
            }
        }
        Ok(items)
    }

    pub fn restore_trashed_item(
        &mut self,
        session: &Session,
        item_id: &str,
    ) -> Result<(), VaultError> {
        self.connection.execute(
            "UPDATE items SET trashed = 0, deleted_at = NULL, updated_at = ?1
             WHERE id = ?2 AND vault_id = ?3",
            params![Utc::now().to_rfc3339(), item_id, session.vault_id],
        )?;
        self.record_event(
            "restore_trashed_item",
            &format!("Restored item {item_id} from trash"),
        )?;
        Ok(())
    }

    pub fn purge_item(&mut self, session: &Session, item_id: &str) -> Result<(), VaultError> {
        let purged = self.connection.execute(
            "DELETE FROM items WHERE id = ?1 AND vault_id = ?2 AND trashed = 1",
            params![item_id, session.vault_id],
        )?;
        if purged > 0 {
            self.prune_unused_tags(session)?;
            self.record_event("purge_item", &format!("Permanently deleted item {item_id}"))?;
        }
        Ok(())
    }

    pub fn archive_item(&mut self, session: &Session, item_id: &str) -> Result<(), VaultError> {
        self.connection.execute(
            "UPDATE items SET archived = 1, updated_at = ?1 WHERE id = ?2 AND vault_id = ?3",
            params![Utc::now().to_rfc3339(), item_id, session.vault_id],
        )?;
        self.record_event("archive_item", &format!("Archived item {item_id}"))?;
        Ok(())
    }

    pub fn restore_item(&mut self, session: &Session, item_id: &str) -> Result<(), VaultError> {
        self.connection.execute(
            "UPDATE items SET archived = 0, updated_at = ?1 WHERE id = ?2 AND vault_id = ?3",
            params![Utc::now().to_rfc3339(), item_id, session.vault_id],
        )?;
        self.record_event("restore_item", &format!("Restored item {item_id}"))?;
        Ok(())
    }

    pub fn set_favorite(
        &mut self,
        session: &Session,
        item_id: &str,
        favorite: bool,
    ) -> Result<(), VaultError> {
        self.connection.execute(
            "UPDATE items SET favorite = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
            params![
                bool_to_i64(favorite),
                Utc::now().to_rfc3339(),
                item_id,
                session.vault_id
            ],
        )?;
        Ok(())
    }

    pub fn list_login_items(
        &self,
        session: &Session,
        query: Option<&str>,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT id FROM items
             WHERE vault_id = ?1 AND archived = 0 AND trashed = 0
             ORDER BY updated_at DESC",
        )?;
        let ids = statement
            .query_map([&session.vault_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let query = query
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty());
        let mut items = Vec::new();
        for id in ids {
            if let Some(item) = self.get_login_item(session, &id)? {
                if matches_query(&item, query.as_deref()) {
                    items.push(item);
                }
            }
        }

        Ok(items)
    }

    pub fn list_archived_login_items(
        &self,
        session: &Session,
    ) -> Result<Vec<LoginItem>, VaultError> {
        self.list_login_items_by_archive_state(session, true)
    }

    pub fn watchtower_report(&self, session: &Session) -> Result<WatchtowerReport, VaultError> {
        let items = self.list_login_items(session, None)?;
        let mut weak_passwords = Vec::new();
        let mut missing_websites = Vec::new();
        let mut missing_totp = Vec::new();
        let mut expiring_items = Vec::new();
        let mut password_counts: HashMap<String, usize> = HashMap::new();

        for item in &items {
            if is_weak_password(&item.password) {
                weak_passwords.push(item.title.clone());
            }
            if item.website.trim().is_empty() {
                missing_websites.push(item.title.clone());
            }
            if item.item_type == "login" && !has_totp(item) {
                missing_totp.push(item.title.clone());
            }
            if has_expiring_field(item) {
                expiring_items.push(item.title.clone());
            }
            if !item.password.is_empty() {
                *password_counts.entry(item.password.clone()).or_default() += 1;
            }
        }

        let reused_passwords = items
            .iter()
            .filter(|item| password_counts.get(&item.password).copied().unwrap_or(0) > 1)
            .map(|item| item.title.clone())
            .collect::<Vec<_>>();
        let issue_count = weak_passwords.len()
            + missing_websites.len()
            + reused_passwords.len()
            + missing_totp.len()
            + expiring_items.len();
        let score = if items.is_empty() {
            100
        } else {
            (100_i32 - (issue_count as i32 * 12)).clamp(0, 100) as u8
        };

        Ok(WatchtowerReport {
            total_items: items.len(),
            weak_passwords,
            reused_passwords,
            missing_websites,
            missing_totp,
            expiring_items,
            score,
        })
    }

    pub fn set_encrypted_setting<T: Serialize>(
        &self,
        session: &Session,
        key: &str,
        value: &T,
    ) -> Result<(), VaultError> {
        self.connection.execute(
            "INSERT INTO settings (key, value_ciphertext) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_ciphertext = excluded.value_ciphertext",
            params![
                key,
                encrypt_string_to_blob(&session.key, &serde_json::to_string(value)?)?
            ],
        )?;
        Ok(())
    }

    pub fn get_encrypted_setting<T: for<'de> Deserialize<'de>>(
        &self,
        session: &Session,
        key: &str,
    ) -> Result<Option<T>, VaultError> {
        let blob = self
            .connection
            .query_row(
                "SELECT value_ciphertext FROM settings WHERE key = ?1",
                [key],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()?;
        let Some(blob) = blob else {
            return Ok(None);
        };
        Ok(Some(serde_json::from_str(&decrypt_string_from_blob(
            &session.key,
            &blob,
        )?)?))
    }

    pub fn add_attachment(
        &mut self,
        session: &Session,
        item_id: &str,
        path: &Path,
    ) -> Result<CustomField, VaultError> {
        if self.get_login_item(session, item_id)?.is_none() {
            return Err(VaultError::VaultNotFound);
        }
        let bytes = fs::read(path).map_err(|error| {
            VaultError::Database(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
        })?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("attachment")
            .to_string();
        let id = Uuid::new_v4().to_string();
        let encoded = BASE64.encode(&bytes);
        self.connection.execute(
            "INSERT INTO attachments
             (id, item_id, file_name_ciphertext, content_ciphertext, byte_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                item_id,
                encrypt_string_to_blob(&session.key, &file_name)?,
                encrypt_string_to_blob(&session.key, &encoded)?,
                bytes.len() as i64,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(CustomField {
            label: file_name,
            value: format!("attachment://{id}"),
            field_type: "file".to_string(),
        })
    }

    pub fn export_attachment(
        &self,
        session: &Session,
        attachment_id: &str,
    ) -> Result<AttachmentExport, VaultError> {
        let row = self
            .connection
            .query_row(
                "SELECT a.file_name_ciphertext, a.content_ciphertext
                 FROM attachments a
                 JOIN items i ON i.id = a.item_id
                 WHERE a.id = ?1 AND i.vault_id = ?2",
                params![attachment_id, session.vault_id],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()?
            .ok_or(VaultError::VaultNotFound)?;
        let file_name = decrypt_string_from_blob(&session.key, &row.0)?;
        let encoded = decrypt_string_from_blob(&session.key, &row.1)?;
        let bytes = BASE64
            .decode(encoded)
            .map_err(|_| VaultError::Serialization(serde_json::Error::io(std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid attachment payload"))))?;
        Ok(AttachmentExport { file_name, bytes })
    }

    pub fn upsert_passkey_event(
        &mut self,
        session: &Session,
        event_type: &str,
        origin: &str,
        rp_id: &str,
        user_name: &str,
    ) -> Result<LoginItem, VaultError> {
        let rp_id = rp_id.trim();
        let target = self
            .list_login_items(session, None)?
            .into_iter()
            .find(|item| item.item_type != PASSKEY_ITEM_TYPE && item_matches_rp_id(item, rp_id));

        if let Some(target) = target {
            // A sign-in must not clobber a handle we already stored; a registration may.
            let custom_fields = upsert_passkey_field(
                &target.custom_fields,
                rp_id,
                user_name,
                event_type == "create",
            );
            return self.update_login_item(
                session,
                LoginItemUpdate {
                    id: target.id.clone(),
                    item_type: target.item_type.clone(),
                    title: target.title.clone(),
                    // The passkey handle lives on the field, not on the login's username.
                    username: target.username.clone(),
                    password: target.password.clone(),
                    website: target.website.clone(),
                    urls: target.urls.clone(),
                    notes: target.notes.clone(),
                    tags: target.tags.clone(),
                    custom_fields,
                    favorite: target.favorite,
                },
            );
        }

        self.create_login_item(
            session,
            LoginItemInput {
                item_type: "login".to_string(),
                title: rp_id.to_string(),
                username: user_name.to_string(),
                password: "".to_string(),
                website: origin.to_string(),
                urls: vec![ItemUrl {
                    label: "website".to_string(),
                    url: origin.to_string(),
                }],
                notes: PASSKEY_NOTE.to_string(),
                tags: vec!["passkey".to_string()],
                custom_fields: vec![passkey_field(rp_id, user_name)],
                favorite: false,
            },
        )
    }

    /// Folds the pre-field `item_type = "passkey"` records into the login item they belong
    /// to. Runs on every unlock and is a no-op once nothing is left.
    fn migrate_standalone_passkeys(&mut self, session: &Session) -> Result<(), VaultError> {
        let legacy = self
            .list_login_items(session, None)?
            .into_iter()
            .filter(|item| item.item_type == PASSKEY_ITEM_TYPE)
            .collect::<Vec<_>>();

        for record in legacy {
            let rp_id = record
                .custom_fields
                .iter()
                .find(|field| field.label == "rp_id")
                .map(|field| field.value.trim().to_string())
                .unwrap_or_default();
            if rp_id.is_empty() {
                continue;
            }

            let target = self
                .list_login_items(session, None)?
                .into_iter()
                .find(|item| {
                    item.item_type != PASSKEY_ITEM_TYPE && item_matches_rp_id(item, &rp_id)
                });
            let carried = passkey_fields_for_record(&record, &rp_id);

            if let Some(target) = target {
                let has_handle = !record.username.trim().is_empty();
                let merged = merge_custom_fields(
                    upsert_passkey_field(&target.custom_fields, &rp_id, &record.username, has_handle),
                    carried,
                );
                self.update_login_item(
                    session,
                    LoginItemUpdate {
                        id: target.id.clone(),
                        item_type: target.item_type.clone(),
                        title: target.title.clone(),
                        username: target.username.clone(),
                        password: target.password.clone(),
                        website: target.website.clone(),
                        urls: target.urls.clone(),
                        notes: target.notes.clone(),
                        tags: target.tags.clone(),
                        custom_fields: merged,
                        favorite: target.favorite,
                    },
                )?;
                self.archive_item(session, &record.id)?;
                continue;
            }

            self.update_login_item(
                session,
                LoginItemUpdate {
                    id: record.id.clone(),
                    item_type: "login".to_string(),
                    title: record.title.clone(),
                    username: record.username.clone(),
                    password: record.password.clone(),
                    website: record.website.clone(),
                    urls: record.urls.clone(),
                    notes: PASSKEY_NOTE.to_string(),
                    tags: vec!["passkey".to_string()],
                    custom_fields: carried,
                    favorite: record.favorite,
                },
            )?;
        }
        Ok(())
    }

    fn list_login_items_by_archive_state(
        &self,
        session: &Session,
        archived: bool,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let archived = bool_to_i64(archived);
        let mut statement = self.connection.prepare(
            "SELECT id FROM items
             WHERE vault_id = ?1 AND archived = ?2 AND trashed = 0
             ORDER BY updated_at DESC",
        )?;
        let ids = statement
            .query_map(params![&session.vault_id, archived], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut items = Vec::new();
        for id in ids {
            if let Some(item) = self.get_login_item(session, &id)? {
                items.push(item);
            }
        }
        Ok(items)
    }

    fn get_login_item(&self, session: &Session, id: &str) -> Result<Option<LoginItem>, VaultError> {
        let row = self
            .connection
            .query_row(
                "SELECT item_type, title_ciphertext, favorite, updated_at FROM items
                 WHERE id = ?1 AND vault_id = ?2",
                params![id, session.vault_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;

        let Some((item_type, title_ciphertext, favorite, updated_at)) = row else {
            return Ok(None);
        };

        let title = decrypt_string_from_blob(&session.key, &title_ciphertext)?;
        let fields = self.login_fields(session, id)?;
        let urls = self.login_urls(session, id)?;
        let tags = self.item_tags(session, id)?;
        let website = urls
            .first()
            .map(|item_url| item_url.url.clone())
            .unwrap_or_default();
        let custom_fields = fields
            .get("custom_fields")
            .map(|value| serde_json::from_str(value))
            .transpose()?
            .unwrap_or_default();

        Ok(Some(LoginItem {
            id: id.to_string(),
            item_type,
            title,
            username: fields.get("username").cloned().unwrap_or_default(),
            password: fields.get("password").cloned().unwrap_or_default(),
            website,
            urls,
            notes: fields.get("notes").cloned().unwrap_or_default(),
            tags,
            custom_fields,
            favorite: favorite == 1,
            updated_at,
        }))
    }

    fn login_fields(
        &self,
        session: &Session,
        item_id: &str,
    ) -> Result<HashMap<String, String>, VaultError> {
        let mut statement = self
            .connection
            .prepare("SELECT field_key, value_ciphertext FROM item_fields WHERE item_id = ?1")?;
        let rows = statement
            .query_map([item_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut fields = HashMap::new();
        for (key, blob) in rows {
            fields.insert(key, decrypt_string_from_blob(&session.key, &blob)?);
        }
        Ok(fields)
    }

    fn login_urls(&self, session: &Session, item_id: &str) -> Result<Vec<ItemUrl>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT label_ciphertext, url_ciphertext FROM item_urls WHERE item_id = ?1 ORDER BY position",
        )?;
        let rows = statement
            .query_map([item_id], |row| {
                Ok((row.get::<_, Option<Vec<u8>>>(0)?, row.get::<_, Vec<u8>>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut urls = Vec::new();
        for (label_blob, url_blob) in rows {
            let label = label_blob
                .map(|blob| decrypt_string_from_blob(&session.key, &blob))
                .transpose()?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "website".to_string());
            let url = decrypt_string_from_blob(&session.key, &url_blob)?;
            urls.push(ItemUrl { label, url });
        }
        Ok(urls)
    }

    fn item_tags(&self, session: &Session, item_id: &str) -> Result<Vec<String>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT tags.name_ciphertext FROM item_tags
             JOIN tags ON tags.id = item_tags.tag_id
             WHERE item_tags.item_id = ?1
             ORDER BY item_tags.position",
        )?;
        let blobs = statement
            .query_map([item_id], |row| row.get::<_, Vec<u8>>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        blobs
            .iter()
            .map(|blob| Ok(decrypt_string_from_blob(&session.key, blob)?))
            .collect()
    }

    fn replace_login_fields(
        &mut self,
        session: &Session,
        item_id: &str,
        username: &str,
        password: &str,
        notes: &str,
        custom_fields: &[CustomField],
    ) -> Result<(), VaultError> {
        self.connection
            .execute("DELETE FROM item_fields WHERE item_id = ?1", [item_id])?;

        let custom_fields = serde_json::to_string(custom_fields)?;
        for (position, (field_key, field_type, value)) in [
            ("username", "text", username),
            ("password", "password", password),
            ("notes", "notes", notes),
            ("custom_fields", "json", custom_fields.as_str()),
        ]
        .into_iter()
        .enumerate()
        {
            self.connection.execute(
                "INSERT INTO item_fields
                 (id, item_id, field_key, field_type, value_ciphertext, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    Uuid::new_v4().to_string(),
                    item_id,
                    field_key,
                    field_type,
                    encrypt_string_to_blob(&session.key, value)?,
                    position as i64,
                ],
            )?;
        }
        Ok(())
    }

    fn replace_login_urls(
        &mut self,
        session: &Session,
        item_id: &str,
        urls: &[ItemUrl],
    ) -> Result<(), VaultError> {
        self.connection
            .execute("DELETE FROM item_urls WHERE item_id = ?1", [item_id])?;
        for (position, item_url) in urls.iter().enumerate() {
            self.connection.execute(
                "INSERT INTO item_urls (id, item_id, label_ciphertext, url_ciphertext, position)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    item_id,
                    encrypt_string_to_blob(&session.key, &item_url.label)?,
                    encrypt_string_to_blob(&session.key, &item_url.url)?,
                    position as i64,
                ],
            )?;
        }
        Ok(())
    }

    fn replace_login_tags(
        &mut self,
        session: &Session,
        item_id: &str,
        tags: &[String],
    ) -> Result<(), VaultError> {
        self.connection
            .execute("DELETE FROM item_tags WHERE item_id = ?1", [item_id])?;

        for (position, name) in normalized_tag_names(tags).into_iter().enumerate() {
            let tag_id = self.resolve_tag_id(session, &name)?;
            self.connection.execute(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id, position) VALUES (?1, ?2, ?3)",
                params![item_id, tag_id, position as i64],
            )?;
        }

        self.prune_unused_tags(session)?;
        Ok(())
    }

    fn prune_unused_tags(&self, session: &Session) -> Result<(), VaultError> {
        self.connection.execute(
            "DELETE FROM tags
             WHERE vault_id = ?1
               AND NOT EXISTS (SELECT 1 FROM item_tags WHERE item_tags.tag_id = tags.id)",
            [&session.vault_id],
        )?;
        Ok(())
    }

    fn resolve_tag_id(&self, session: &Session, name: &str) -> Result<String, VaultError> {
        let name_hash = tag_name_hash(&session.key, name);
        if let Some(tag_id) = self
            .connection
            .query_row(
                "SELECT id FROM tags WHERE vault_id = ?1 AND name_hash = ?2",
                params![&session.vault_id, name_hash],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            return Ok(tag_id);
        }

        let tag_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        self.connection.execute(
            "INSERT INTO tags (id, vault_id, name_ciphertext, name_hash, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                tag_id,
                session.vault_id,
                encrypt_string_to_blob(&session.key, name)?,
                name_hash,
                now
            ],
        )?;
        Ok(tag_id)
    }

    /// Earlier builds kept a whole item's tags as one JSON blob in `item_fields`.
    /// Runs whenever a session is derived; the old rows are deleted as they are
    /// converted, so repeat runs find nothing left to do.
    fn migrate_legacy_tags(&mut self, session: &Session) -> Result<(), VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT item_fields.item_id, item_fields.value_ciphertext FROM item_fields
             JOIN items ON items.id = item_fields.item_id
             WHERE items.vault_id = ?1 AND item_fields.field_key = 'tags'",
        )?;
        let legacy_rows = statement
            .query_map([&session.vault_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        for (item_id, blob) in legacy_rows {
            let tags: Vec<String> =
                serde_json::from_str(&decrypt_string_from_blob(&session.key, &blob)?)?;
            self.replace_login_tags(session, &item_id, &tags)?;
            self.connection.execute(
                "DELETE FROM item_fields WHERE item_id = ?1 AND field_key = 'tags'",
                [&item_id],
            )?;
        }
        Ok(())
    }

    fn ensure_default_vault(&mut self, key: &VaultKey) -> Result<(), VaultError> {
        let now = Utc::now().to_rfc3339();
        self.connection.execute(
            "INSERT INTO vaults (id, name_ciphertext, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(id) DO NOTHING",
            params![
                DEFAULT_VAULT_ID,
                encrypt_string_to_blob(key, "Personal")?,
                now
            ],
        )?;
        Ok(())
    }

    fn set_meta(&self, key: &str, value: &str) -> Result<(), VaultError> {
        self.connection.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    fn get_meta(&self, key: &str) -> Result<Option<String>, VaultError> {
        Ok(self
            .connection
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    fn item_exists(&self, session: &Session, input: &LoginItemInput) -> Result<bool, VaultError> {
        Ok(self
            .list_login_items(session, Some(&input.title))?
            .into_iter()
            .any(|item| {
                item.title == input.title
                    && item.username == input.username
                    && item.website == primary_website(&input.website, &input.urls)
            }))
    }

    fn record_event(&self, event_type: &str, message: &str) -> Result<(), VaultError> {
        self.connection.execute(
            "INSERT INTO audit_events (id, event_type, message, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), event_type, message, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }
}

impl Session {
    pub(crate) fn key(&self) -> &VaultKey {
        &self.key
    }
}

pub fn generate_password(options: PasswordGeneratorOptions) -> Result<String, VaultError> {
    let length = options.length.clamp(8, 128);
    let mut character_sets: Vec<&[u8]> = Vec::new();
    if options.uppercase {
        character_sets.push(b"ABCDEFGHJKLMNPQRSTUVWXYZ");
    }
    if options.lowercase {
        character_sets.push(b"abcdefghijkmnopqrstuvwxyz");
    }
    if options.numbers {
        character_sets.push(b"23456789");
    }
    if options.symbols {
        character_sets.push(b"!@#$%^&*-_=+?");
    }
    if character_sets.is_empty() {
        return Err(VaultError::EmptyCharacterSet);
    }

    let mut rng = rand::thread_rng();
    let mut password = Vec::with_capacity(length);
    for set in &character_sets {
        password.push(*set.choose(&mut rng).expect("set is non-empty"));
    }

    let all_characters = character_sets.concat();
    while password.len() < length {
        password.push(all_characters[rng.gen_range(0..all_characters.len())]);
    }
    password.shuffle(&mut rng);

    Ok(String::from_utf8(password).expect("generator only uses ASCII"))
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn normalized_tag_names(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut names = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() || !seen.insert(tag.to_lowercase()) {
            continue;
        }
        names.push(tag.to_string());
    }
    names
}

/// Keyed blind index: one tag name always maps to one hash per vault, so SQLite
/// can enforce tag uniqueness without the database holding any plaintext name.
/// Case-folded, because "Work" and "work" are meant to be the same tag.
fn tag_name_hash(key: &VaultKey, name: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha1>::new_from_slice(key)
        .expect("a 32 byte vault key is always a valid HMAC key for sha1");
    mac.update(name.to_lowercase().as_bytes());
    mac.finalize().into_bytes().to_vec()
}

const PASSKEY_ITEM_TYPE: &str = "passkey";
const PASSKEY_NOTE: &str =
    "Passkey detected by the browser extension. The private key stays with the platform authenticator.";

fn passkey_field(rp_id: &str, user_name: &str) -> CustomField {
    CustomField {
        label: rp_id.to_string(),
        value: user_name.to_string(),
        field_type: PASSKEY_ITEM_TYPE.to_string(),
    }
}

fn upsert_passkey_field(
    fields: &[CustomField],
    rp_id: &str,
    user_name: &str,
    overwrite: bool,
) -> Vec<CustomField> {
    let mut next = fields.to_vec();
    if let Some(existing) = next.iter_mut().find(|field| {
        field.field_type == PASSKEY_ITEM_TYPE && field.label.eq_ignore_ascii_case(rp_id)
    }) {
        if overwrite && !user_name.trim().is_empty() {
            existing.value = user_name.to_string();
        }
    } else {
        next.push(passkey_field(rp_id, user_name));
    }
    next
}

/// Legacy passkey records kept `event` / `rp_id` / `last_seen` as plain text fields. The
/// folded item keeps whatever else it had, plus the passkey field itself.
fn passkey_fields_for_record(record: &LoginItem, rp_id: &str) -> Vec<CustomField> {
    let mut fields: Vec<CustomField> = record
        .custom_fields
        .iter()
        .filter(|field| !matches!(field.label.as_str(), "event" | "rp_id" | "last_seen"))
        .cloned()
        .collect();
    fields.push(passkey_field(rp_id, &record.username));
    fields
}

/// Appends the incoming fields the target does not already carry, keyed by label.
fn merge_custom_fields(mut target: Vec<CustomField>, incoming: Vec<CustomField>) -> Vec<CustomField> {
    for field in incoming {
        if !target
            .iter()
            .any(|existing| existing.label.eq_ignore_ascii_case(&field.label))
        {
            target.push(field);
        }
    }
    target
}

/// Host part of a stored URL or bare website value, lowercased, without userinfo or port.
fn url_host(value: &str) -> String {
    let authority = value
        .split("://")
        .last()
        .unwrap_or(value)
        .split('/')
        .next()
        .unwrap_or(value);
    authority
        .rsplit('@')
        .next()
        .unwrap_or(authority)
        .split(':')
        .next()
        .unwrap_or(authority)
        .trim()
        .to_lowercase()
}

fn item_matches_rp_id(item: &LoginItem, rp_id: &str) -> bool {
    let rp_id = rp_id.trim().to_lowercase();
    if rp_id.is_empty() {
        return false;
    }
    url_host(&item.website) == rp_id || item.urls.iter().any(|url| url_host(&url.url) == rp_id)
}

fn matches_query(item: &LoginItem, query: Option<&str>) -> bool {
    let Some(query) = query else {
        return true;
    };
    item.title.to_lowercase().contains(query)
        || item.username.to_lowercase().contains(query)
        || item.website.to_lowercase().contains(query)
        || item.urls.iter().any(|item_url| {
            item_url.label.to_lowercase().contains(query)
                || item_url.url.to_lowercase().contains(query)
        })
        || item
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(query))
        || item.item_type.to_lowercase().contains(query)
        || item.custom_fields.iter().any(|field| {
            field.label.to_lowercase().contains(query) || field.value.to_lowercase().contains(query)
        })
}

fn default_item_type() -> String {
    "login".to_string()
}

fn normalized_urls(website: &str, urls: &[ItemUrl]) -> Vec<ItemUrl> {
    let mut normalized = urls
        .iter()
        .map(|item_url| ItemUrl {
            label: if item_url.label.trim().is_empty() {
                "website".to_string()
            } else {
                item_url.label.trim().to_string()
            },
            url: item_url.url.trim().to_string(),
        })
        .filter(|item_url| !item_url.url.is_empty())
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        let website = website.trim();
        if !website.is_empty() {
            normalized.push(ItemUrl {
                label: "website".to_string(),
                url: website.to_string(),
            });
        }
    }

    normalized
}

fn primary_website(website: &str, urls: &[ItemUrl]) -> String {
    normalized_urls(website, urls)
        .first()
        .map(|item_url| item_url.url.clone())
        .unwrap_or_else(|| website.trim().to_string())
}

fn normalized_item_type(item_type: &str) -> String {
    let item_type = item_type.trim();
    if item_type.is_empty() {
        "login".to_string()
    } else {
        item_type.to_string()
    }
}

fn is_weak_password(password: &str) -> bool {
    password.len() < 12
        || !password
            .chars()
            .any(|character| character.is_ascii_lowercase())
        || !password
            .chars()
            .any(|character| character.is_ascii_uppercase())
        || !password.chars().any(|character| character.is_ascii_digit())
}

fn has_totp(item: &LoginItem) -> bool {
    item.custom_fields.iter().any(|field| {
        let label = field.label.to_lowercase();
        label.contains("totp") || label.contains("otp") || label.contains("2fa")
    })
}

fn has_expiring_field(item: &LoginItem) -> bool {
    item.custom_fields.iter().any(|field| {
        let label = field.label.to_lowercase();
        label.contains("expiry") || label.contains("expires") || label.contains("expiration")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{initialize_database, open_database};

    fn test_database_path(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "passless-{name}-{}-{}.sqlite3",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        path
    }

    #[test]
    fn setup_unlock_and_login_crud_store_decrypted_data_only_after_unlock() {
        let path = test_database_path("vault-crud");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);

        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        let created = service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "GitHub".into(),
                    username: "octo@example.com".into(),
                    password: "v3ry-secret".into(),
                    website: "https://github.com".into(),
                    urls: vec![
                        ItemUrl {
                            label: "signin".into(),
                            url: "https://github.com/login".into(),
                        },
                        ItemUrl {
                            label: "docs".into(),
                            url: "https://docs.github.com".into(),
                        },
                    ],
                    notes: "primary account".into(),
                    tags: vec!["code".into(), "personal".into()],
                    custom_fields: vec![],
                    favorite: true,
                },
            )
            .expect("login should save");

        let matches = service
            .list_login_items(&session, Some("git"))
            .expect("items should list");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, created.id);
        assert_eq!(matches[0].password, "v3ry-secret");
        assert_eq!(matches[0].website, "https://github.com/login");
        assert_eq!(matches[0].urls.len(), 2);
        assert_eq!(matches[0].urls[0].label, "signin");
        assert_eq!(matches[0].tags, vec!["code", "personal"]);
        assert!(matches[0].favorite);

        let stored_ciphertext: Vec<u8> = service
            .connection()
            .query_row(
                "SELECT value_ciphertext FROM item_fields WHERE item_id = ?1 AND field_key = 'password'",
                [&created.id],
                |row| row.get(0),
            )
            .expect("ciphertext should exist");
        assert!(!String::from_utf8_lossy(&stored_ciphertext).contains("v3ry-secret"));

        service
            .update_login_item(
                &session,
                LoginItemUpdate {
                    id: created.id.clone(),
                    item_type: "login".into(),
                    title: "GitHub Main".into(),
                    username: "octo@example.com".into(),
                    password: "new-secret".into(),
                    website: "https://github.com".into(),
                    urls: vec![ItemUrl {
                        label: "main".into(),
                        url: "https://github.com".into(),
                    }],
                    notes: "updated".into(),
                    tags: vec!["code".into()],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("login should update");

        let updated = service
            .list_login_items(&session, Some("main"))
            .expect("items should list");
        assert_eq!(updated[0].password, "new-secret");
        assert!(!updated[0].favorite);

        service
            .trash_item(&session, &created.id)
            .expect("item should move to trash");
        assert!(service
            .list_login_items(&session, None)
            .expect("items should list")
            .is_empty());

        let trashed = service
            .list_trashed_login_items(&session)
            .expect("trash should list");
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].id, created.id);
        assert_eq!(trashed[0].tags, vec!["code"]);

        service
            .restore_trashed_item(&session, &created.id)
            .expect("item should leave trash");
        assert!(service
            .list_login_items(&session, None)
            .expect("items should list")
            .iter()
            .any(|item| item.id == created.id));
        assert!(service
            .list_trashed_login_items(&session)
            .expect("trash should list")
            .is_empty());

        service
            .trash_item(&session, &created.id)
            .expect("item should move to trash again");
        service
            .purge_item(&session, &created.id)
            .expect("item should purge");
        assert_eq!(
            service
                .connection()
                .query_row::<i64, _, _>(
                    "SELECT count(*) FROM items WHERE id = ?1",
                    [&created.id],
                    |row| row.get(0)
                )
                .expect("item count should read"),
            0
        );
        assert!(service
            .list_trashed_login_items(&session)
            .expect("trash should list")
            .is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn tags_are_one_row_per_name_and_retire_when_no_item_uses_them() {
        let path = test_database_path("tags");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        let github = service
            .create_login_item(&session, login_input("GitHub", vec!["code".into(), "Work".into()]))
            .expect("login should save");
        service
            .create_login_item(
                &session,
                login_input("GitLab", vec![" code ".into(), "work".into()]),
            )
            .expect("login should save");

        assert_eq!(tag_row_count(&service), 2);

        service
            .update_login_item(
                &session,
                LoginItemUpdate {
                    id: github.id.clone(),
                    item_type: "login".into(),
                    title: "GitHub".into(),
                    username: "user@example.com".into(),
                    password: "secret".into(),
                    website: "https://example.com".into(),
                    urls: vec![],
                    notes: String::new(),
                    tags: vec!["coding".into(), "work".into()],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("login should update");

        // GitLab still uses "code", so only the retired "coding" placeholder of
        // GitHub should have been dropped; confirm by reading both items back.
        let items = service.list_login_items(&session, None).expect("items should list");
        let github = items.iter().find(|item| item.title == "GitHub").expect("github");
        let gitlab = items.iter().find(|item| item.title == "GitLab").expect("gitlab");
        assert_eq!(github.tags, vec!["coding", "Work"]);
        assert_eq!(gitlab.tags, vec!["code", "Work"]);
        assert_eq!(tag_row_count(&service), 3);

        service
            .trash_item(&session, &gitlab.id)
            .expect("item should move to trash");
        assert_eq!(tag_row_count(&service), 3);

        service
            .purge_item(&session, &gitlab.id)
            .expect("item should purge");
        assert_eq!(tag_row_count(&service), 2);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unlock_migrates_legacy_json_tags_into_the_tag_tables() {
        let path = test_database_path("legacy-tags");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        let created = service
            .create_login_item(
                &session,
                login_input("Legacy", vec!["old".into(), "code".into()]),
            )
            .expect("login should save");

        let legacy_blob = encrypt_string_to_blob(session.key(), r#"["old","code"]"#)
            .expect("legacy payload should encrypt");
        service
            .connection()
            .execute("DELETE FROM item_tags WHERE item_id = ?1", [&created.id])
            .expect("relational tags should clear");
        service
            .connection()
            .execute(
                "INSERT INTO item_fields
                 (id, item_id, field_key, field_type, value_ciphertext, position)
                 VALUES ('legacy-tags-row', ?1, 'tags', 'json', ?2, 99)",
                params![created.id, legacy_blob],
            )
            .expect("legacy row should insert");

        let session = service.unlock("master-password").expect("unlock should migrate");

        let items = service.list_login_items(&session, None).expect("items should list");
        assert_eq!(items[0].tags, vec!["old", "code"]);
        assert_eq!(tag_row_count(&service), 2);
        assert_eq!(legacy_tag_row_count(&service), 0);

        service.unlock("master-password").expect("second unlock should run");
        assert_eq!(tag_row_count(&service), 2);

        let _ = std::fs::remove_file(path);
    }

    fn login_input(title: &str, tags: Vec<String>) -> LoginItemInput {
        LoginItemInput {
            item_type: "login".into(),
            title: title.into(),
            username: "user@example.com".into(),
            password: "secret".into(),
            website: "https://example.com".into(),
            urls: vec![],
            notes: String::new(),
            tags,
            custom_fields: vec![],
            favorite: false,
        }
    }

    fn tag_row_count(service: &VaultService) -> i64 {
        count_rows(service, "SELECT count(*) FROM tags")
    }

    fn legacy_tag_row_count(service: &VaultService) -> i64 {
        count_rows(
            service,
            "SELECT count(*) FROM item_fields WHERE field_key = 'tags'",
        )
    }

    fn count_rows(service: &VaultService, sql: &str) -> i64 {
        service
            .connection()
            .query_row(sql, [], |row| row.get::<_, i64>(0))
            .expect("count should read")
    }

    #[test]
    fn vaults_can_be_created_listed_and_keep_items_isolated() {
        let path = test_database_path("vault-switching");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let personal_session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        let work_vault = service
            .create_vault(&personal_session, "Work")
            .expect("work vault should create");
        let work_session = service
            .session_for_vault(&personal_session, &work_vault.id)
            .expect("work session should switch");

        service
            .create_login_item(
                &personal_session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "Personal Mail".into(),
                    username: "me".into(),
                    password: "PersonalPass123".into(),
                    website: "https://mail.example.com".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec![],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("personal item should create");
        service
            .create_login_item(
                &work_session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "Work SSO".into(),
                    username: "me@work".into(),
                    password: "WorkPass123".into(),
                    website: "https://sso.example.com".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec![],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("work item should create");

        let vaults = service
            .list_vaults(&personal_session)
            .expect("vaults should list");
        assert_eq!(
            vaults.iter().map(|vault| vault.name.as_str()).collect::<Vec<_>>(),
            vec!["Personal", "Work"]
        );
        assert_eq!(
            service
                .list_login_items(&personal_session, None)
                .expect("personal items")
                .into_iter()
                .map(|item| item.title)
                .collect::<Vec<_>>(),
            vec!["Personal Mail"]
        );
        assert_eq!(
            service
                .list_login_items(&work_session, None)
                .expect("work items")
                .into_iter()
                .map(|item| item.title)
                .collect::<Vec<_>>(),
            vec!["Work SSO"]
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unlock_rejects_wrong_master_password() {
        let path = test_database_path("unlock");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);

        service
            .setup_master_password("master-password")
            .expect("master password should setup");

        assert!(service.unlock("wrong-password").is_err());
        assert!(service.unlock("master-password").is_ok());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn generated_password_respects_length_and_character_sets() {
        let password = generate_password(PasswordGeneratorOptions {
            length: 24,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: false,
        })
        .expect("password should generate");

        assert_eq!(password.len(), 24);
        assert!(password
            .chars()
            .any(|character| character.is_ascii_uppercase()));
        assert!(password
            .chars()
            .any(|character| character.is_ascii_lowercase()));
        assert!(password.chars().any(|character| character.is_ascii_digit()));
        assert!(!password
            .chars()
            .any(|character| !character.is_ascii_alphanumeric()));
    }

    #[test]
    fn archive_and_restore_moves_login_between_active_and_archived_lists() {
        let path = test_database_path("archive");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");
        let created = service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "Archive Me".into(),
                    username: "user".into(),
                    password: "StrongPass123".into(),
                    website: "https://example.com".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec![],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("item should create");

        service
            .archive_item(&session, &created.id)
            .expect("archive should work");
        assert!(service
            .list_login_items(&session, None)
            .expect("active list")
            .is_empty());
        assert_eq!(
            service
                .list_archived_login_items(&session)
                .expect("archived list")
                .len(),
            1
        );

        service
            .restore_item(&session, &created.id)
            .expect("restore should work");
        assert_eq!(
            service
                .list_login_items(&session, None)
                .expect("active list")
                .len(),
            1
        );
        assert!(service
            .list_archived_login_items(&session)
            .expect("archived list")
            .is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn watchtower_reports_weak_reused_and_incomplete_logins() {
        let path = test_database_path("watchtower");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");
        for title in ["Weak One", "Weak Two"] {
            service
                .create_login_item(
                    &session,
                    LoginItemInput {
                        item_type: "login".into(),
                        title: title.into(),
                        username: "user".into(),
                        password: "short".into(),
                        website: "".into(),
                        urls: vec![],
                        notes: "".into(),
                        tags: vec![],
                        custom_fields: vec![],
                        favorite: false,
                    },
                )
                .expect("item should create");
        }

        let report = service
            .watchtower_report(&session)
            .expect("report should build");

        assert_eq!(report.total_items, 2);
        assert_eq!(report.weak_passwords.len(), 2);
        assert_eq!(report.reused_passwords.len(), 2);
        assert_eq!(report.missing_websites.len(), 2);
        assert!(report.score < 100);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn item_types_and_custom_fields_round_trip() {
        let path = test_database_path("custom-fields");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");

        let created = service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "credit_card".into(),
                    title: "Travel Card".into(),
                    username: "".into(),
                    password: "".into(),
                    website: "".into(),
                    urls: vec![],
                    notes: "Primary travel card".into(),
                    tags: vec!["finance".into()],
                    custom_fields: vec![
                        CustomField {
                            label: "number".into(),
                            value: "4111111111111111".into(),
                            field_type: "card_number".into(),
                        },
                        CustomField {
                            label: "expiry".into(),
                            value: "12/30".into(),
                            field_type: "text".into(),
                        },
                    ],
                    favorite: false,
                },
            )
            .expect("card should save");

        let matches = service
            .list_login_items(&session, Some("4111"))
            .expect("custom fields should search");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, created.id);
        assert_eq!(matches[0].item_type, "credit_card");
        assert_eq!(matches[0].custom_fields.len(), 2);
        assert_eq!(matches[0].custom_fields[0].label, "number");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn attachments_are_encrypted_and_exportable() {
        let path = test_database_path("attachments");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");
        let created = service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "With Attachment".into(),
                    username: "user".into(),
                    password: "StrongPass123".into(),
                    website: "https://example.com".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec![],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("item should create");
        let attachment_path = test_database_path("attachment-source").with_extension("txt");
        std::fs::write(&attachment_path, b"secret attachment bytes").expect("attachment source");

        let field = service
            .add_attachment(&session, &created.id, &attachment_path)
            .expect("attachment should save");
        assert_eq!(field.field_type, "file");
        assert!(field.value.starts_with("attachment://"));

        let attachment_id = field.value.trim_start_matches("attachment://");
        let stored_ciphertext: Vec<u8> = service
            .connection()
            .query_row(
                "SELECT content_ciphertext FROM attachments WHERE id = ?1",
                [attachment_id],
                |row| row.get(0),
            )
            .expect("ciphertext should exist");
        assert!(!String::from_utf8_lossy(&stored_ciphertext).contains("secret attachment bytes"));

        let exported = service
            .export_attachment(&session, attachment_id)
            .expect("attachment should export");
        assert_eq!(exported.bytes, b"secret attachment bytes");

        let _ = std::fs::remove_file(attachment_path);
        let _ = std::fs::remove_file(path);
    }

    fn passkey_field_of(item: &LoginItem) -> Option<&CustomField> {
        item.custom_fields
            .iter()
            .find(|field| field.field_type == "passkey")
    }

    #[test]
    fn passkey_events_attach_to_the_matching_login_item() {
        let path = test_database_path("passkey-field");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");
        let login = service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "Example".into(),
                    username: "alice".into(),
                    password: "StrongPass123".into(),
                    website: "https://example.com/account".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec![],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("login should create");

        let registered = service
            .upsert_passkey_event(
                &session,
                "create",
                "https://example.com",
                "example.com",
                "alice",
            )
            .expect("passkey should register");
        assert_eq!(registered.id, login.id);
        assert_eq!(registered.item_type, "login");
        assert_eq!(
            passkey_field_of(&registered).map(|field| field.value.as_str()),
            Some("alice")
        );

        // A registration may replace the handle; a sign-in may not.
        let reregistered = service
            .upsert_passkey_event(
                &session,
                "create",
                "https://example.com",
                "example.com",
                "bob",
            )
            .expect("passkey should re-register");
        assert_eq!(
            passkey_field_of(&reregistered).map(|field| field.value.as_str()),
            Some("bob")
        );
        let signed_in = service
            .upsert_passkey_event(
                &session,
                "get",
                "https://example.com/login",
                "example.com",
                "carol",
            )
            .expect("passkey sign-in should record");
        assert_eq!(
            passkey_field_of(&signed_in).map(|field| field.value.as_str()),
            Some("bob")
        );
        assert_eq!(signed_in.username, "alice");

        let items = service
            .list_login_items(&session, None)
            .expect("items should list");
        assert_eq!(items.len(), 1);
        assert!(items[0]
            .custom_fields
            .iter()
            .all(|field| field.field_type == "passkey"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn passkey_event_without_a_matching_login_creates_one() {
        let path = test_database_path("passkey-field-orphan");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");

        let created = service
            .upsert_passkey_event(&session, "create", "https://github.com", "github.com", "bob")
            .expect("passkey should create a login");
        assert_eq!(created.item_type, "login");
        assert_eq!(created.title, "github.com");
        assert_eq!(created.website, "https://github.com");
        assert_eq!(
            passkey_field_of(&created).map(|field| field.value.as_str()),
            Some("bob")
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn legacy_standalone_passkey_items_fold_into_logins_on_unlock() {
        let path = test_database_path("passkey-migration");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");

        let login = service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "Example".into(),
                    username: "alice".into(),
                    password: "StrongPass123".into(),
                    website: "https://example.com".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec![],
                    custom_fields: vec![],
                    favorite: false,
                },
            )
            .expect("login should create");

        // The shape upsert_passkey_event used to write.
        service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "passkey".into(),
                    title: "Passkey example.com".into(),
                    username: "alice".into(),
                    password: "".into(),
                    website: "https://example.com".into(),
                    urls: vec![ItemUrl {
                        label: "website".into(),
                        url: "https://example.com".into(),
                    }],
                    notes: "".into(),
                    tags: vec!["passkey".into(), "browser".into()],
                    custom_fields: vec![
                        CustomField {
                            label: "event".into(),
                            value: "create".into(),
                            field_type: "text".into(),
                        },
                        CustomField {
                            label: "rp_id".into(),
                            value: "example.com".into(),
                            field_type: "text".into(),
                        },
                        CustomField {
                            label: "last_seen".into(),
                            value: "2026-10-08T00:00:00Z".into(),
                            field_type: "date".into(),
                        },
                    ],
                    favorite: false,
                },
            )
            .expect("legacy passkey item should create");

        let orphan = service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "passkey".into(),
                    title: "Passkey github.com".into(),
                    username: "bob".into(),
                    password: "".into(),
                    website: "https://github.com".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec![],
                    custom_fields: vec![CustomField {
                        label: "rp_id".into(),
                        value: "github.com".into(),
                        field_type: "text".into(),
                    }],
                    favorite: false,
                },
            )
            .expect("orphan passkey item should create");

        let session = service.unlock("master-password").expect("unlock should migrate");

        let items = service
            .list_login_items(&session, None)
            .expect("items should list");
        let folded = items
            .iter()
            .find(|item| item.id == login.id)
            .expect("login should survive");
        assert_eq!(folded.custom_fields.len(), 1);
        assert_eq!(folded.custom_fields[0].field_type, "passkey");
        assert_eq!(folded.custom_fields[0].label, "example.com");

        let retyped = items
            .iter()
            .find(|item| item.id == orphan.id)
            .expect("orphan should stay reachable");
        assert_eq!(retyped.item_type, "login");
        assert_eq!(retyped.custom_fields.len(), 1);
        assert_eq!(retyped.custom_fields[0].field_type, "passkey");
        assert_eq!(items.len(), 2);

        let archived = service
            .list_archived_login_items(&session)
            .expect("archived items should list");
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].title, "Passkey example.com");

        service.unlock("master-password").expect("second unlock");
        assert_eq!(
            service
                .list_login_items(&session, None)
                .expect("items should list")
                .len(),
            2
        );

        let _ = std::fs::remove_file(path);
    }
}
