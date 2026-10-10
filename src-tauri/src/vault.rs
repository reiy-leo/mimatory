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
use std::sync::OnceLock;
use thiserror::Error;
use uuid::Uuid;

const DEFAULT_VAULT_ID: &str = "personal";
const MASTER_VERIFIER_TEXT: &str = "passless-master-verifier";
const MATCH_TYPE_EXACT: &str = "exact";
const MATCH_TYPE_DOMAIN: &str = "domain";

const GENERATOR_MODE_PASSPHRASE: &str = "passphrase";
const GENERATOR_MODE_PIN: &str = "pin";
const UPPERCASE_UNAMBIGUOUS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
const UPPERCASE_ALL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE_UNAMBIGUOUS: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
const LOWERCASE_ALL: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const DIGITS_UNAMBIGUOUS: &[u8] = b"23456789";
const DIGITS_ALL: &[u8] = b"0123456789";

/// 4096 words, so each one is exactly 12 bits of choice. The list is the 4–8 character prefix of
/// google-10000-english-no-swears (github.com/first20hours/google-10000-english, MIT), vendored so
/// a generated passphrase never depends on a file the host happens to have.
const PASSPHRASE_WORDS: &str = include_str!("../wordlists/passphrase-words.txt");

fn default_generator_mode() -> String {
    "random".to_string()
}

fn default_word_count() -> usize {
    4
}

/// The character sets this app shipped with already left I, l, O, 0 and 1 out.
fn ambiguous_characters_avoided() -> bool {
    true
}

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
    /// `exact` autofills only on the host the address names, `domain` also on its subdomains.
    /// Backups and sync files written before this existed carry neither and mean `domain`.
    #[serde(default = "default_match_type")]
    pub match_type: String,
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

/// One row of the `tags` table, as the sidebar needs it. A tag is addressed by its name because that
/// is the only thing an item carries, matched case-insensitively through the hash the table has a
/// unique index on. How many items use a tag is not here — the frontend already holds the live item
/// list and counts from it, so a number beside a name cannot disagree with what clicking it reveals.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Tag {
    pub name: String,
    pub icon: String,
    pub color: String,
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
    #[serde(default = "default_generator_mode")]
    pub mode: String,
    #[serde(default = "default_word_count")]
    pub words: usize,
    #[serde(default = "ambiguous_characters_avoided")]
    pub exclude_ambiguous: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PasswordStrength {
    pub bits: u32,
    pub level: String,
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
    #[error("tag name cannot be empty")]
    TagNameEmpty,
    #[error("tag not found")]
    TagNotFound,
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

    /// Copies an item under a title the caller supplies, because the word for a copy belongs to
    /// the locale. Attachments are copied rather than shared: the copy gets its own rows and its
    /// `attachment://` references are rewritten to name them, so purging either item leaves the
    /// other one readable.
    pub fn duplicate_login_item(
        &mut self,
        session: &Session,
        item_id: &str,
        title: &str,
    ) -> Result<LoginItem, VaultError> {
        let source = self
            .get_login_item(session, item_id)?
            .ok_or(VaultError::VaultNotFound)?;

        let mut statement = self.connection.prepare(
            "SELECT id, file_name_ciphertext, content_ciphertext, byte_count
             FROM attachments WHERE item_id = ?1",
        )?;
        let attachments = statement
            .query_map([item_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        let created = self.create_login_item(
            session,
            LoginItemInput {
                item_type: source.item_type.clone(),
                title: title.trim().to_string(),
                username: source.username.clone(),
                password: source.password.clone(),
                website: source.website.clone(),
                urls: source.urls.clone(),
                notes: source.notes.clone(),
                tags: source.tags.clone(),
                custom_fields: source.custom_fields.clone(),
                favorite: source.favorite,
            },
        )?;
        if attachments.is_empty() {
            self.record_event("duplicate_item", &format!("Duplicated item {item_id}"))?;
            return Ok(created);
        }

        let mut custom_fields = source.custom_fields.clone();
        for (source_id, file_name_ciphertext, content_ciphertext, byte_count) in attachments {
            let id = Uuid::new_v4().to_string();
            // The blobs are ciphertext under one key, so they are copied verbatim and never
            // pass through memory in the clear.
            self.connection.execute(
                "INSERT INTO attachments
                 (id, item_id, file_name_ciphertext, content_ciphertext, byte_count, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    created.id,
                    file_name_ciphertext,
                    content_ciphertext,
                    byte_count,
                    Utc::now().to_rfc3339()
                ],
            )?;
            for field in &mut custom_fields {
                if field.value == format!("attachment://{source_id}") {
                    field.value = format!("attachment://{id}");
                }
            }
        }
        self.replace_login_fields(
            session,
            &created.id,
            &source.username,
            &source.password,
            &source.notes,
            &custom_fields,
        )?;
        self.record_event("duplicate_item", &format!("Duplicated item {item_id}"))?;

        Ok(self
            .get_login_item(session, &created.id)?
            .expect("duplicated login item should be readable"))
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

    /// Moves one item to another vault. Every vault is decrypted by the same key, so the rows that
    /// hang off `item_id` — fields, urls, attachments — follow the item without being rewritten.
    /// Tags are the exception: a tag belongs to a vault, so each link is re-pointed at the target's
    /// row for that name (reusing it when the target already has one) before the item itself moves.
    pub fn move_login_item(
        &mut self,
        session: &Session,
        item_id: &str,
        vault_id: &str,
    ) -> Result<(), VaultError> {
        let target = self.session_for_vault(session, vault_id)?;
        if target.vault_id == session.vault_id {
            return Ok(());
        }

        let moved = self.connection.execute(
            "UPDATE items SET vault_id = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
            params![&target.vault_id, Utc::now().to_rfc3339(), item_id, session.vault_id],
        )?;
        if moved == 0 {
            return Err(VaultError::VaultNotFound);
        }

        let mut statement = self.connection.prepare(
            "SELECT item_tags.tag_id, tags.name_ciphertext, tags.name_hash, tags.icon, tags.color
             FROM item_tags JOIN tags ON tags.id = item_tags.tag_id
             WHERE item_tags.item_id = ?1",
        )?;
        let links = statement
            .query_map([item_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        let now = Utc::now().to_rfc3339();
        for (source_tag_id, name_ciphertext, name_hash, icon, color) in links {
            let existing = self
                .connection
                .query_row(
                    "SELECT id FROM tags WHERE vault_id = ?1 AND name_hash = ?2",
                    params![&target.vault_id, &name_hash],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let target_tag_id = match existing {
                Some(id) => id,
                None => {
                    let id = Uuid::new_v4().to_string();
                    // The name is already encrypted under the key both vaults share, so the blob
                    // crosses as it is — and the styling crosses with it, because it belongs to
                    // the label rather than to the vault it was first drawn in.
                    self.connection.execute(
                        "INSERT INTO tags
                         (id, vault_id, name_ciphertext, name_hash,
                          created_at, updated_at, icon, color)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
                        params![
                            id,
                            &target.vault_id,
                            name_ciphertext,
                            name_hash,
                            now,
                            icon,
                            color
                        ],
                    )?;
                    id
                }
            };
            self.connection.execute(
                "UPDATE item_tags SET tag_id = ?1 WHERE item_id = ?2 AND tag_id = ?3",
                params![target_tag_id, item_id, source_tag_id],
            )?;
        }

        self.prune_unused_tags(session)?;
        self.record_event("move_item", &format!("Moved item {item_id} to vault {vault_id}"))?;
        Ok(())
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

    pub fn list_tags(&self, session: &Session) -> Result<Vec<Tag>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT name_ciphertext, icon, color FROM tags WHERE vault_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = statement
            .query_map([&session.vault_id], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        rows.into_iter()
            .map(|(name_ciphertext, icon, color)| {
                Ok(Tag {
                    name: decrypt_string_from_blob(&session.key, &name_ciphertext)?,
                    icon,
                    color,
                })
            })
            .collect()
    }

    /// Renames a tag, restyles it, or both, addressed by the name the sidebar is showing — a name is
    /// the only handle an item carries. Renaming onto a name the vault already has merges rather than
    /// failing: `UNIQUE (vault_id, name_hash)` means two spellings of one tag cannot coexist, and the
    /// links have to end up on one row either way.
    pub fn update_tag(
        &mut self,
        session: &Session,
        name: &str,
        new_name: &str,
        icon: &str,
        color: &str,
    ) -> Result<(), VaultError> {
        let id = self.tag_id(session, name)?.ok_or(VaultError::TagNotFound)?;
        let new_name = new_name.trim();
        if new_name.is_empty() {
            return Err(VaultError::TagNameEmpty);
        }

        let name_hash = tag_name_hash(&session.key, new_name);
        let now = Utc::now().to_rfc3339();
        let target = self
            .connection
            .query_row(
                "SELECT id FROM tags WHERE vault_id = ?1 AND name_hash = ?2 AND id != ?3",
                params![&session.vault_id, name_hash, id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        if let Some(target_id) = target {
            self.connection.execute(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id, position)
                 SELECT item_id, ?1, position FROM item_tags WHERE tag_id = ?2",
                params![&target_id, &id],
            )?;
            self.connection
                .execute("DELETE FROM item_tags WHERE tag_id = ?1", [&id])?;
            self.connection.execute("DELETE FROM tags WHERE id = ?1", [&id])?;
            self.connection.execute(
                "UPDATE tags SET icon = ?1, color = ?2, updated_at = ?3 WHERE id = ?4",
                params![icon, color, now, &target_id],
            )?;
            self.record_event("merge_tag", &format!("Merged tag {name} into {new_name}"))?;
            return Ok(());
        }

        self.connection.execute(
            "UPDATE tags SET name_ciphertext = ?1, name_hash = ?2, icon = ?3, color = ?4,
             updated_at = ?5 WHERE id = ?6 AND vault_id = ?7",
            params![
                encrypt_string_to_blob(&session.key, new_name)?,
                name_hash,
                icon,
                color,
                now,
                id,
                &session.vault_id
            ],
        )?;
        self.record_event("update_tag", &format!("Updated tag {name}"))?;
        Ok(())
    }

    /// Takes the label off every item that carries it and forgets the row. The items stay.
    /// `item_tags` would cascade on its own; the links go by hand so the result does not depend on the
    /// connection having `PRAGMA foreign_keys` on.
    pub fn delete_tag(&mut self, session: &Session, name: &str) -> Result<(), VaultError> {
        let id = self.tag_id(session, name)?.ok_or(VaultError::TagNotFound)?;
        self.connection
            .execute("DELETE FROM item_tags WHERE tag_id = ?1", [&id])?;
        self.connection.execute(
            "DELETE FROM tags WHERE id = ?1 AND vault_id = ?2",
            params![id, &session.vault_id],
        )?;
        self.record_event("delete_tag", &format!("Deleted tag {name}"))?;
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

    /// What the browser bridge asks for: items whose saved addresses cover this host, each
    /// honoured by its own match type. Deliberately not the search path — a search matches
    /// any field as a substring, which is far too loose a rule to hand a password over to.
    pub fn list_login_items_for_origin(
        &self,
        session: &Session,
        origin: &str,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let Some(request_host) = host_of(origin) else {
            return Ok(Vec::new());
        };
        let mut matches = Vec::new();
        for item in self.list_login_items(session, None)? {
            if normalized_urls(&item.website, &item.urls)
                .iter()
                .any(|url| url_matches_host(&url.url, &request_host, &url.match_type))
            {
                matches.push(item);
            }
        }
        Ok(matches)
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
                    match_type: default_match_type(),
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
            "SELECT label_ciphertext, url_ciphertext, match_type FROM item_urls
             WHERE item_id = ?1 ORDER BY position",
        )?;
        let rows = statement
            .query_map([item_id], |row| {
                Ok((
                    row.get::<_, Option<Vec<u8>>>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut urls = Vec::new();
        for (label_blob, url_blob, match_type) in rows {
            let label = label_blob
                .map(|blob| decrypt_string_from_blob(&session.key, &blob))
                .transpose()?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "website".to_string());
            let url = decrypt_string_from_blob(&session.key, &url_blob)?;
            urls.push(ItemUrl {
                label,
                url,
                match_type,
            });
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
                "INSERT INTO item_urls (id, item_id, label_ciphertext, url_ciphertext, match_type, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    Uuid::new_v4().to_string(),
                    item_id,
                    encrypt_string_to_blob(&session.key, &item_url.label)?,
                    encrypt_string_to_blob(&session.key, &item_url.url)?,
                    item_url.match_type.clone(),
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

    fn tag_id(&self, session: &Session, name: &str) -> Result<Option<String>, VaultError> {
        Ok(self
            .connection
            .query_row(
                "SELECT id FROM tags WHERE vault_id = ?1 AND name_hash = ?2",
                params![&session.vault_id, tag_name_hash(&session.key, name)],
                |row| row.get::<_, String>(0),
            )
            .optional()?)
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

    fn record_event(&self, event_type: &str, message: &str) -> Result<(), VaultError> {
        self.connection.execute(
            "INSERT INTO audit_events (id, event_type, message, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), event_type, message, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }
}

pub fn generate_password(options: PasswordGeneratorOptions) -> Result<String, VaultError> {
    match options.mode.as_str() {
        GENERATOR_MODE_PASSPHRASE => Ok(generate_passphrase(options.words.clamp(3, 10))),
        GENERATOR_MODE_PIN => Ok(generate_pin(options.length.clamp(4, 12))),
        _ => generate_random_password(&options),
    }
}

fn generate_random_password(options: &PasswordGeneratorOptions) -> Result<String, VaultError> {
    let length = options.length.clamp(8, 128);
    let mut character_sets: Vec<&[u8]> = Vec::new();
    if options.uppercase {
        character_sets.push(if options.exclude_ambiguous {
            UPPERCASE_UNAMBIGUOUS
        } else {
            UPPERCASE_ALL
        });
    }
    if options.lowercase {
        character_sets.push(if options.exclude_ambiguous {
            LOWERCASE_UNAMBIGUOUS
        } else {
            LOWERCASE_ALL
        });
    }
    if options.numbers {
        character_sets.push(if options.exclude_ambiguous {
            DIGITS_UNAMBIGUOUS
        } else {
            DIGITS_ALL
        });
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

fn generate_pin(length: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| rng.gen_range('0'..='9'))
        .collect::<String>()
}

fn generate_passphrase(word_count: usize) -> String {
    let wordlist = passphrase_wordlist();
    let mut rng = rand::thread_rng();
    let mut words = (0..word_count)
        .map(|_| wordlist.words[rng.gen_range(0..wordlist.words.len())].to_string())
        .collect::<Vec<_>>();
    // One capitalised word and a two-digit suffix are not decoration: a passphrase that is all
    // lower case and has no digit is the exact shape Watchtower calls weak, so the generator
    // would otherwise produce passwords its own audit then flags.
    let capitalised = rng.gen_range(0..words.len());
    if let Some(first) = words[capitalised].get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    format!("{}-{:02}", words.join("-"), rng.gen_range(0..100))
}

struct PassphraseWordlist {
    words: Vec<&'static str>,
    known: HashSet<&'static str>,
}

fn passphrase_wordlist() -> &'static PassphraseWordlist {
    static WORDLIST: OnceLock<PassphraseWordlist> = OnceLock::new();
    WORDLIST.get_or_init(|| {
        let words = PASSPHRASE_WORDS
            .lines()
            .map(str::trim)
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>();
        let known = words.iter().copied().collect::<HashSet<_>>();
        PassphraseWordlist { words, known }
    })
}

/// A passphrase is one word choice per segment, not one character out of the 95-character
/// charset, so scoring it by length would rate a 60-bit passphrase excellent. When a password has
/// the shape this generator emits, the meter counts the choices that were actually made instead.
fn passphrase_bits(password: &str) -> Option<u32> {
    let wordlist = passphrase_wordlist();
    let segments = password.split('-').collect::<Vec<_>>();
    if segments.len() < 2 {
        return None;
    }

    let mut words = 0_usize;
    let mut suffix_bits = 0_f64;
    for (index, segment) in segments.iter().enumerate() {
        let is_last = index + 1 == segments.len();
        if is_last && segment.len() == 2 && segment.chars().all(|character| character.is_ascii_digit())
        {
            suffix_bits = (100_f64).log2();
            continue;
        }
        let lowered = segment.to_lowercase();
        if !wordlist.known.contains(lowered.as_str()) {
            return None;
        }
        words += 1;
    }
    if words < 2 {
        return None;
    }

    let bits = words as f64 * (wordlist.words.len() as f64).log2() + suffix_bits;
    Some(bits.round() as u32)
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

pub(crate) fn default_match_type() -> String {
    MATCH_TYPE_DOMAIN.to_string()
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
            match_type: if item_url.match_type == MATCH_TYPE_EXACT {
                MATCH_TYPE_EXACT.to_string()
            } else {
                MATCH_TYPE_DOMAIN.to_string()
            },
        })
        .filter(|item_url| !item_url.url.is_empty())
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        let website = website.trim();
        if !website.is_empty() {
            normalized.push(ItemUrl {
                label: "website".to_string(),
                url: website.to_string(),
                match_type: default_match_type(),
            });
        }
    }

    normalized
}

/// Everything before the path: no scheme, no port, no userinfo, lowercased. A bare
/// `github.com` and a full `https://github.com/login` reduce to the same host.
fn host_of(value: &str) -> Option<String> {
    let value = value.trim().to_lowercase();
    if value.is_empty() {
        return None;
    }
    let authority = match value.split_once("://") {
        Some((_, rest)) => rest,
        None => &value,
    };
    let authority = authority
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .rsplit('@')
        .next()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default();
    if authority.is_empty() {
        None
    } else {
        Some(authority.to_string())
    }
}

/// Hosts only, never a substring: an item saved for `notgithub.com` must not answer a
/// page on `github.com`, and `exact` must not answer one on `login.github.com`.
fn url_matches_host(stored: &str, request_host: &str, match_type: &str) -> bool {
    let Some(stored_host) = host_of(stored) else {
        return false;
    };
    if match_type == MATCH_TYPE_EXACT {
        return stored_host == request_host;
    }
    stored_host == request_host || request_host.ends_with(&format!(".{stored_host}"))
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

/// The meter and Watchtower read the same rule: a password the report would list as weak
/// never shows as anything better than weak here, so the two can't contradict each other.
pub fn password_strength(password: &str) -> PasswordStrength {
    let length = password.chars().count();
    if length == 0 {
        return PasswordStrength {
            bits: 0,
            level: "weak".to_string(),
        };
    }

    let mut pool = 0_u32;
    if password.chars().any(|c| c.is_ascii_lowercase()) {
        pool += 26;
    }
    if password.chars().any(|c| c.is_ascii_uppercase()) {
        pool += 26;
    }
    if password.chars().any(|c| c.is_ascii_digit()) {
        pool += 10;
    }
    if password.chars().any(|c| !c.is_alphanumeric()) {
        pool += 33;
    }
    // Letters outside ASCII draw from a far larger set than the Latin alphabet does.
    if pool == 0 {
        pool = 100;
    }

    let bits = passphrase_bits(password)
        .unwrap_or_else(|| (length as f64 * (pool as f64).log2()).round() as u32);
    let level = if is_weak_password(password) || bits < 65 {
        "weak"
    } else if bits < 85 {
        "fair"
    } else if bits < 120 {
        "strong"
    } else {
        "excellent"
    };

    PasswordStrength {
        bits,
        level: level.to_string(),
    }
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
                            match_type: "exact".into(),
                        },
                        ItemUrl {
                            label: "docs".into(),
                            url: "https://docs.github.com".into(),
                            match_type: "domain".into(),
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
                        match_type: "domain".into(),
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
    fn host_of_reduces_an_address_to_its_authority() {
        assert_eq!(
            host_of("https://GitHub.com/login?x=1#frag").as_deref(),
            Some("github.com")
        );
        assert_eq!(host_of("github.com:8443/session").as_deref(), Some("github.com"));
        assert_eq!(
            host_of("user:pw@vault.corp.example/path").as_deref(),
            Some("vault.corp.example")
        );
        assert_eq!(host_of("   ").as_deref(), None);
        assert_eq!(host_of("https://").as_deref(), None);
    }

    #[test]
    fn exact_matches_one_host_and_domain_also_matches_subdomains() {
        assert!(url_matches_host("https://github.com/login", "github.com", MATCH_TYPE_EXACT));
        assert!(!url_matches_host(
            "https://github.com/login",
            "login.github.com",
            MATCH_TYPE_EXACT
        ));
        assert!(url_matches_host("github.com", "login.github.com", MATCH_TYPE_DOMAIN));
        assert!(url_matches_host("https://github.com:8443/x", "github.com", MATCH_TYPE_DOMAIN));
        // A registered domain is not a suffix of an unrelated one: this is the whole reason the
        // bridge no longer shares the search path's substring rule.
        assert!(!url_matches_host("github.com", "notgithub.com", MATCH_TYPE_DOMAIN));
        assert!(!url_matches_host("http://", "github.com", MATCH_TYPE_DOMAIN));
    }

    #[test]
    fn origin_lookup_honours_each_urls_match_type() {
        let path = test_database_path("origin-match");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        let exact = service
            .create_login_item(
                &session,
                LoginItemInput {
                    urls: vec![ItemUrl {
                        label: String::new(),
                        url: "https://github.com/login".into(),
                        match_type: MATCH_TYPE_EXACT.into(),
                    }],
                    ..login_input("GitHub sign-in", vec![])
                },
            )
            .expect("login should save");
        let domain = service
            .create_login_item(
                &session,
                LoginItemInput {
                    urls: vec![ItemUrl {
                        label: String::new(),
                        url: "github.com".into(),
                        match_type: MATCH_TYPE_DOMAIN.into(),
                    }],
                    ..login_input("GitHub API", vec![])
                },
            )
            .expect("login should save");
        let lookalike = service
            .create_login_item(
                &session,
                LoginItemInput {
                    urls: vec![ItemUrl {
                        label: String::new(),
                        url: "https://notgithub.com".into(),
                        match_type: MATCH_TYPE_DOMAIN.into(),
                    }],
                    ..login_input("Look-alike", vec![])
                },
            )
            .expect("login should save");

        assert_eq!(
            titles_for(&service, &session, "https://github.com/dashboard"),
            vec![domain.title.clone(), exact.title.clone()]
        );
        assert_eq!(
            titles_for(&service, &session, "https://api.github.com/session"),
            vec![domain.title.clone()]
        );
        assert_eq!(
            titles_for(&service, &session, "https://notgithub.com/"),
            vec![lookalike.title.clone()]
        );
        assert!(titles_for(&service, &session, "").is_empty());

        let _ = std::fs::remove_file(path);
    }

    fn titles_for(service: &VaultService, session: &Session, origin: &str) -> Vec<String> {
        let mut titles = service
            .list_login_items_for_origin(session, origin)
            .expect("origin should list")
            .iter()
            .map(|item| item.title.clone())
            .collect::<Vec<_>>();
        titles.sort();
        titles
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
    fn a_tag_can_be_renamed_restyled_and_deleted_without_touching_the_items() {
        let path = test_database_path("tag-crud");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        service
            .create_login_item(&session, login_input("GitHub", vec!["Work".into(), "code".into()]))
            .expect("login should save");
        service
            .create_login_item(&session, login_input("GitLab", vec!["work".into()]))
            .expect("login should save");

        let tags = service.list_tags(&session).expect("tags should list");
        assert_eq!(tags.len(), 2);
        // One row covers both spellings, so the vault has two tags, not three.
        assert!(tags.iter().all(|tag| tag.icon == "tag" && tag.color.is_empty()));
        assert!(tags.iter().any(|tag| tag.name == "Work"));

        service
            .update_tag(&session, "work", "Job", "briefcase", "teal")
            .expect("a tag is addressed by any spelling of its name");

        let tags = service.list_tags(&session).expect("tags should list after the rename");
        assert_eq!(tags.len(), 2);
        assert!(tags.iter().any(|tag| tag.name == "Job"));
        let job = tags.iter().find(|tag| tag.name == "Job").expect("Job");
        assert_eq!(job.icon, "briefcase");
        assert_eq!(job.color, "teal");

        // Both items read the new spelling without either one being opened, because an item's tags are
        // the rows it links to rather than a copy of the text that was typed.
        let items = service.list_login_items(&session, None).expect("items should list");
        assert_eq!(items.len(), 2);
        assert!(items
            .iter()
            .all(|item| item.tags.iter().any(|tag| tag == "Job")));

        // A name the vault already has merges rather than failing on the unique name hash.
        service
            .update_tag(&session, "code", "job", "star", "")
            .expect("renaming onto an existing tag should merge");

        let tags = service.list_tags(&session).expect("tags should list after the merge");
        assert_eq!(tags.len(), 1);
        // The row that was already there keeps its own spelling; only the styling follows this edit.
        assert_eq!(tags[0].name, "Job");
        assert_eq!(tags[0].icon, "star");
        assert_eq!(tags[0].color, "");

        let items = service.list_login_items(&session, None).expect("items should list");
        let github = items
            .iter()
            .find(|item| item.title == "GitHub")
            .expect("github");
        assert_eq!(github.tags, vec!["Job"]);

        assert!(matches!(
            service.update_tag(&session, "Job", "   ", "star", ""),
            Err(VaultError::TagNameEmpty)
        ));
        assert!(matches!(
            service.update_tag(&session, "missing-tag", "New", "star", ""),
            Err(VaultError::TagNotFound)
        ));

        service
            .delete_tag(&session, "JOB")
            .expect("tag should delete");
        assert!(service.list_tags(&session).expect("tags should list").is_empty());
        assert_eq!(tag_row_count(&service), 0);

        // Deleting the label is not deleting the item.
        let items = service.list_login_items(&session, None).expect("items should list");
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|item| item.tags.is_empty()));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_tag_row_survives_as_long_as_an_item_still_names_it() {
        let path = test_database_path("tag-rows");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        let github = service
            .create_login_item(&session, login_input("GitHub", vec!["work".into()]))
            .expect("login should save");
        service
            .create_login_item(&session, login_input("GitLab", vec!["work".into()]))
            .expect("login should save");

        service
            .archive_item(&session, &github.id)
            .expect("item should archive");

        // Archiving and trashing leave the links alone, so the row — and the icon on it — is still
        // there when the item comes back. Counting which of those items is live is the sidebar's job,
        // because it is the live item list that decides what a click on a tag reveals.
        assert_eq!(service.list_tags(&session).expect("tags should list").len(), 1);

        service
            .trash_item(&session, &github.id)
            .expect("item should move to trash");
        assert_eq!(service.list_tags(&session).expect("tags should list").len(), 1);

        service
            .purge_item(&session, &github.id)
            .expect("item should purge");
        assert_eq!(service.list_tags(&session).expect("tags should list").len(), 1);

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

        let legacy_blob = encrypt_string_to_blob(&session.key, r#"["old","code"]"#)
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
    fn moving_an_item_takes_its_fields_tags_and_tag_styling_into_the_target_vault() {
        let path = test_database_path("vault-move");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let personal = service
            .setup_master_password("master-password")
            .expect("master password should setup");
        let work_vault = service
            .create_vault(&personal, "Work")
            .expect("work vault should create");
        let work = service
            .session_for_vault(&personal, &work_vault.id)
            .expect("work session should switch");

        let moved = service
            .create_login_item(&personal, login_input("Personal Mail", vec!["code".into()]))
            .expect("personal item should create");
        // A tag's icon and colour belong to the label, so they have to cross with it rather
        // than reset to the column defaults.
        service
            .update_tag(&personal, "code", "code", "key", "amber")
            .expect("tag should restyle");

        service
            .move_login_item(&personal, &moved.id, &work_vault.id)
            .expect("item should move");

        assert!(service
            .list_login_items(&personal, None)
            .expect("personal items")
            .is_empty());
        let in_work = service.list_login_items(&work, None).expect("work items");
        assert_eq!(in_work.len(), 1);
        assert_eq!(in_work[0].id, moved.id);
        assert_eq!(in_work[0].username, "user@example.com");
        assert_eq!(in_work[0].password, "secret");
        assert_eq!(in_work[0].website, "https://example.com");
        assert_eq!(in_work[0].tags, vec!["code"]);

        let work_tags = service.list_tags(&work).expect("work tags should list");
        assert_eq!(work_tags.len(), 1);
        assert_eq!(work_tags[0].name, "code");
        assert_eq!(work_tags[0].icon, "key");
        assert_eq!(work_tags[0].color, "amber");
        // The label moved, it did not copy: the source vault keeps no row nothing links to.
        assert!(service.list_tags(&personal).expect("personal tags").is_empty());

        // A vault that is not there is refused before a single row is written.
        let error = service.move_login_item(&work, &moved.id, "no-such-vault");
        assert!(matches!(error, Err(VaultError::VaultNotFound)));
        assert_eq!(
            service.list_login_items(&work, None).expect("work items").len(),
            1
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn moving_an_item_onto_a_tag_the_target_vault_already_has_reuses_that_row() {
        let path = test_database_path("vault-move-merge");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let personal = service
            .setup_master_password("master-password")
            .expect("master password should setup");
        let work_vault = service
            .create_vault(&personal, "Work")
            .expect("work vault should create");
        let work = service
            .session_for_vault(&personal, &work_vault.id)
            .expect("work session should switch");

        let moved = service
            .create_login_item(&personal, login_input("Personal Mail", vec!["shared".into()]))
            .expect("personal item should create");
        service
            .create_login_item(&work, login_input("Work Mail", vec!["shared".into()]))
            .expect("work item should create");
        service
            .update_tag(&work, "shared", "shared", "star", "teal")
            .expect("work tag should restyle");

        service
            .move_login_item(&personal, &moved.id, &work_vault.id)
            .expect("item should move");

        // One spelling is one label, so the target vault's row — styling and all — is the one both
        // items now link to; the source's copy is pruned with the item gone.
        let work_tags = service.list_tags(&work).expect("work tags should list");
        assert_eq!(work_tags.len(), 1);
        assert_eq!(work_tags[0].icon, "star");
        assert_eq!(work_tags[0].color, "teal");
        let in_work = service.list_login_items(&work, None).expect("work items");
        assert_eq!(in_work.len(), 2);
        assert!(in_work.iter().all(|item| item.tags == vec!["shared"]));
        assert!(service.list_tags(&personal).expect("personal tags").is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn duplicating_an_item_gives_the_copy_its_own_attachment_rows() {
        let path = test_database_path("duplicate");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        let mut file = std::env::temp_dir();
        file.push(format!(
            "passless-duplicate-{}-{}.bin",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&file, b"seed-bytes").expect("attachment file should write");

        let created = service
            .create_login_item(&session, login_input("GitHub", vec!["code".into()]))
            .expect("login should create");
        let attachment = service
            .add_attachment(&session, &created.id, &file)
            .expect("attachment should store");
        let saved = service
            .update_login_item(
                &session,
                LoginItemUpdate {
                    id: created.id.clone(),
                    item_type: created.item_type.clone(),
                    title: created.title.clone(),
                    username: created.username.clone(),
                    password: created.password.clone(),
                    website: created.website.clone(),
                    urls: created.urls.clone(),
                    notes: created.notes.clone(),
                    tags: created.tags.clone(),
                    custom_fields: vec![attachment],
                    favorite: true,
                },
            )
            .expect("attachment field should save");

        let copy = service
            .duplicate_login_item(&session, &saved.id, "GitHub copy")
            .expect("login should duplicate");

        assert_ne!(copy.id, saved.id);
        assert_eq!(copy.title, "GitHub copy");
        assert_eq!(copy.item_type, saved.item_type);
        assert_eq!(copy.username, saved.username);
        assert_eq!(copy.password, saved.password);
        assert_eq!(copy.urls, saved.urls);
        assert_eq!(copy.tags, saved.tags);
        assert!(copy.favorite);
        assert_eq!(
            service
                .list_login_items(&session, None)
                .expect("items should list")
                .len(),
            2
        );

        // The copy's attachment field has to name an attachment that belongs to the copy, or
        // purging the original would take the copy's file with it.
        let original = saved.custom_fields[0].value.clone();
        let copied = copy.custom_fields[0].value.clone();
        assert!(copied.starts_with("attachment://"));
        assert_ne!(copied, original);
        assert_eq!(copy.custom_fields[0].label, saved.custom_fields[0].label);
        let original_bytes = service
            .export_attachment(&session, original.trim_start_matches("attachment://"))
            .expect("original attachment should export");
        let copied_bytes = service
            .export_attachment(&session, copied.trim_start_matches("attachment://"))
            .expect("copy attachment should export");
        assert_eq!(original_bytes.bytes, copied_bytes.bytes);
        assert_eq!(copied_bytes.file_name, original_bytes.file_name);
        assert_eq!(
            count_rows(&service, "SELECT count(*) FROM attachments"),
            2
        );

        service
            .purge_item(&session, &saved.id)
            .expect("original should purge");
        assert_eq!(
            service
                .export_attachment(&session, copied.trim_start_matches("attachment://"))
                .expect("copy attachment should outlive the original")
                .bytes,
            b"seed-bytes".to_vec()
        );

        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(file);
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
            ..generator_options()
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
    fn ambiguous_characters_are_left_out_only_when_the_option_says_so() {
        let ambiguous = ['I', 'O', 'l', '0', '1'];
        for _ in 0..20 {
            let password = generate_password(PasswordGeneratorOptions {
                exclude_ambiguous: true,
                length: 128,
                symbols: false,
                ..generator_options()
            })
            .expect("password should generate");
            assert!(password.chars().all(|character| !ambiguous.contains(&character)));
        }

        let uses_them = (0..20)
            .map(|_| {
                generate_password(PasswordGeneratorOptions {
                    exclude_ambiguous: false,
                    length: 128,
                    symbols: false,
                    ..generator_options()
                })
                .expect("password should generate")
            })
            .any(|password| password.chars().any(|character| ambiguous.contains(&character)));
        assert!(
            uses_them,
            "the unfiltered sets are the whole alphabet and all ten digits"
        );
    }

    #[test]
    fn generated_pin_is_digits_at_the_requested_length() {
        let pin = generate_password(PasswordGeneratorOptions {
            mode: "pin".to_string(),
            length: 6,
            ..generator_options()
        })
        .expect("pin should generate");
        assert_eq!(pin.len(), 6);
        assert!(pin.chars().all(|character| character.is_ascii_digit()));

        let shortest = generate_password(PasswordGeneratorOptions {
            mode: "pin".to_string(),
            length: 1,
            ..generator_options()
        })
        .expect("pin should generate");
        assert_eq!(shortest.len(), 4, "a one-digit pin is not a pin");
    }

    #[test]
    fn generated_passphrase_is_wordlist_words_with_one_capital_and_a_suffix() {
        let phrase = generate_password(PasswordGeneratorOptions {
            mode: "passphrase".to_string(),
            words: 5,
            ..generator_options()
        })
        .expect("passphrase should generate");
        let segments = phrase.split('-').collect::<Vec<_>>();
        assert_eq!(segments.len(), 6);
        assert!(segments[5].bytes().all(|byte| byte.is_ascii_digit()));
        assert_eq!(
            segments[..5]
                .iter()
                .filter(|segment| segment.starts_with(char::is_uppercase))
                .count(),
            1
        );
        let wordlist = passphrase_wordlist();
        for segment in &segments[..5] {
            let lowered = segment.to_lowercase();
            assert!(
                wordlist.known.contains(lowered.as_str()),
                "{segment} should be a wordlist word"
            );
        }

        let fewest = generate_password(PasswordGeneratorOptions {
            mode: "passphrase".to_string(),
            words: 1,
            ..generator_options()
        })
        .expect("passphrase should generate");
        assert_eq!(fewest.split('-').count(), 4, "three words is the floor");
    }

    #[test]
    fn the_passphrase_wordlist_is_an_even_power_of_two() {
        let wordlist = passphrase_wordlist();
        assert_eq!(wordlist.words.len(), 4096);
        assert_eq!(
            wordlist.words.len(),
            wordlist.known.len(),
            "a repeated word would make the list smaller than it looks"
        );
        assert!(wordlist
            .words
            .iter()
            .all(|word| (4..=8).contains(&word.len()) && word.bytes().all(|byte| byte.is_ascii_lowercase())));
    }

    #[test]
    fn a_passphrase_scores_the_words_it_chose_not_the_characters_it_typed() {
        let wordlist = passphrase_wordlist();
        let picked = [
            wordlist.words[12],
            wordlist.words[640],
            wordlist.words[1800],
            wordlist.words[3900],
        ];
        let mut phrase = picked.join("-");
        if let Some(head) = phrase.get_mut(0..1) {
            head.make_ascii_uppercase();
        }
        let phrase = format!("{phrase}-07");

        assert_eq!(passphrase_bits(&phrase), Some(55));
        let strength = password_strength(&phrase);
        assert_eq!(strength.bits, 55);
        // Read as characters, these would be roughly 260 bits of charset and rate excellent.
        assert_eq!(strength.level, "weak");

        assert!(passphrase_bits(&format!("{}-{}-zqxjvw", picked[0], picked[1])).is_none());
        assert!(passphrase_bits("revolvers").is_none());
    }

    fn generator_options() -> PasswordGeneratorOptions {
        PasswordGeneratorOptions {
            exclude_ambiguous: true,
            length: 24,
            lowercase: true,
            mode: "random".to_string(),
            numbers: true,
            symbols: false,
            uppercase: true,
            words: 4,
        }
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
    fn strength_meter_never_outrates_the_watchtower_weak_rule() {
        let password = "Ab1defghij";
        assert!(is_weak_password(password));
        assert_eq!(password_strength(password).level, "weak");
    }

    #[test]
    fn strength_rises_with_length_and_character_pool() {
        assert_eq!(password_strength("Abcd1234efgh").level, "fair");
        assert_eq!(password_strength("Tr0ub4dor&3xtr").level, "strong");
        assert_eq!(
            password_strength("rQ9!kW$9Z2#LpW7vB2&mXz4").level,
            "excellent"
        );
    }

    #[test]
    fn strength_scores_an_empty_password_as_zero_bits() {
        let empty = password_strength("");
        assert_eq!(empty.bits, 0);
        assert_eq!(empty.level, "weak");
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
                        match_type: "domain".into(),
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
