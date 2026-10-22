use crate::passkey::StoredPasskey;
use crate::crypto::{
    decrypt_string, decrypt_string_from_blob, derive_key, encrypt_string, encrypt_string_to_blob,
    generate_salt, CryptoError, EncryptedPayload, VaultKey,
};
use crate::site_match;
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

/// Meta key recording that the legacy-format migrations in `unlock` have run on this vault file.
const LEGACY_MIGRATIONS_META: &str = "legacy_migrations";
const LEGACY_MIGRATIONS_VERSION: &str = "1";
const DEFAULT_VAULT_ID: &str = "personal";
const MASTER_VERIFIER_TEXT: &str = "passless-master-verifier";
/// The field type older builds used to point at another item before links were real.
const LEGACY_RELATED_FIELD: &str = "related_item";
/// "Sign in with…": the field's value names the provider (`google`, …, or a name the user typed);
/// the account it signs in with is the `sign_in` link in the relation record. Builds before
/// 2026-10-17 stored the other item's id in the value instead — `migrate_legacy_sign_in_fields`.
const SIGN_IN_WITH_FIELD: &str = "sign_in_with";
/// The providers the app draws a mark for. Anything else in the field is a provider name.
const SIGN_IN_PROVIDERS: &[(&str, &[&str])] = &[
    ("google", &["google.com", "gmail.com"]),
    ("apple", &["apple.com", "icloud.com"]),
    ("github", &["github.com"]),
    ("microsoft", &["microsoft.com", "live.com", "outlook.com", "office.com"]),
    ("facebook", &["facebook.com"]),
    ("x", &["x.com", "twitter.com"]),
];
pub const ICON_MODE_AUTO: &str = "auto";
pub const ICON_MODE_LETTER: &str = "letter";
/// How long a fetched icon is trusted before the app asks the site again, and how long a site
/// with no icon (or that could not be reached) is left alone.
const SITE_ICON_FRESH_DAYS: i64 = 30;
const SITE_ICON_MISS_DAYS: i64 = 3;

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

impl Session {
    /// The same unlocked key pointed at another vault. Every vault shares the account key, so reading or
    /// changing an item in a vault other than the open one only needs its id.
    pub fn for_vault(&self, vault_id: &str) -> Session {
        Session { key: self.key.clone(), vault_id: vault_id.to_string() }
    }
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
    /// Autofill behaviour (`site_match`): `domain` fills anywhere on the registrable domain, `exact`
    /// only on this host and port, `never` not at all. Missing or unknown means `domain`; a build
    /// older than `never` (2026-10-17) reads it as `domain` and would write that back on save.
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
    /// When the item was made, for the list's Date Created sort.
    #[serde(default)]
    pub created_at: String,
    /// How often and when the item was last used (a field copied, Open & Fill), for the list's Frequently
    /// Used and Recently Used sorts. Never touches `updated_at`.
    #[serde(default)]
    pub use_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    /// The vault the item lives in; filled for every list so the cross-vault All view can tell them apart.
    #[serde(default)]
    pub vault_id: String,
    /// The item's place among the others: the one parent it belongs to, the items that belong to
    /// it, and its peers. Filled in for the lists the app window reads; the browser bridge never
    /// asks for it, and an item with none leaves the key out of the payload entirely.
    #[serde(default, skip_serializing_if = "ItemRelations::is_empty")]
    pub relations: ItemRelations,
    /// `auto` (the website icon when there is one) or `letter`. Left out of the payload for `auto`.
    #[serde(default = "default_icon_mode", skip_serializing_if = "is_auto_icon_mode")]
    pub icon_mode: String,
}

/// One row of the app window's item list (owner 2026-10-23: "列表只返回摘要，选中条目时再解密详情"). Only
/// what the list row, its sorts, the sidebar counts, tags, the link pickers and the "Sign in with"
/// subtitle read; the password, notes, other websites, custom field values and attachments stay in
/// the vault until `get_login_item` decrypts the one item the user opens.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct LoginItemSummary {
    pub id: String,
    pub vault_id: String,
    pub item_type: String,
    pub title: String,
    pub username: String,
    /// The first address — the one the row's icon and the Quick Access search read.
    pub website: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub updated_at: String,
    pub created_at: String,
    pub use_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(skip_serializing_if = "is_auto_icon_mode")]
    pub icon_mode: String,
    /// The raw value of the item's "Sign in with" field (a provider id or name, never an account),
    /// for the "Sign in with Google" subtitle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sign_in_with: Option<String>,
    /// The resolvable parent, which the link pickers need to refuse a loop.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Whether any link resolves (parent, child, related, sign-in either way): Delete and Move To
    /// are refused while it is true.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_relations: bool,
}

impl LoginItemSummary {
    fn from_item(item: &LoginItem) -> Self {
        LoginItemSummary {
            id: item.id.clone(),
            vault_id: item.vault_id.clone(),
            item_type: item.item_type.clone(),
            title: item.title.clone(),
            username: item.username.clone(),
            website: item.website.clone(),
            tags: item.tags.clone(),
            favorite: item.favorite,
            updated_at: item.updated_at.clone(),
            created_at: item.created_at.clone(),
            use_count: item.use_count,
            last_used_at: item.last_used_at.clone(),
            icon_mode: item.icon_mode.clone(),
            sign_in_with: sign_in_field_value(&item.custom_fields),
            parent_id: None,
            has_relations: false,
        }
    }
}

/// Which items a summary list reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ItemState {
    Live,
    Archived,
    Trashed,
}

impl ItemState {
    fn filter(self) -> &'static str {
        match self {
            ItemState::Live => "i.archived = 0 AND i.trashed = 0",
            ItemState::Archived => "i.archived = 1 AND i.trashed = 0",
            ItemState::Trashed => "i.trashed = 1",
        }
    }

    fn order(self) -> &'static str {
        match self {
            ItemState::Trashed => "i.deleted_at DESC",
            _ => "i.updated_at DESC",
        }
    }
}

fn sign_in_field_value(fields: &[CustomField]) -> Option<String> {
    fields
        .iter()
        .find(|field| field.field_type == SIGN_IN_WITH_FIELD)
        .map(|field| field.value.clone())
}

fn default_icon_mode() -> String {
    ICON_MODE_AUTO.to_string()
}

fn is_auto_icon_mode(mode: &str) -> bool {
    mode == ICON_MODE_AUTO
}

/// One cached website icon as the frontend reads it: a PNG data URL, or `None` for a remembered
/// miss, and whether it is recent enough not to ask the site again.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct CachedSiteIcon {
    pub icon: Option<String>,
    pub fresh: bool,
}

/// What the detail pane needs to draw one linked item and navigate to it. `archived` is shown
/// beside the title, because a link survives archiving on either side.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct RelatedItemRef {
    pub id: String,
    pub title: String,
    pub item_type: String,
    pub archived: bool,
}

/// Two kinds of link. A child belongs to its parent (one parent per item, never a cycle); a
/// related item is a peer, and the link is stored on both sides so either end reads it.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ItemRelations {
    pub parent: Option<RelatedItemRef>,
    pub children: Vec<RelatedItemRef>,
    pub related: Vec<RelatedItemRef>,
    /// The account this item signs in with ("Sign in with Google" → the Google login). Directed,
    /// like a parent: stored on this item only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sign_in_with: Option<RelatedItemRef>,
    /// The other way round: the items that sign in with this one. Resolved, never stored.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signs_in_to: Vec<RelatedItemRef>,
}

impl ItemRelations {
    pub fn is_empty(&self) -> bool {
        self.parent.is_none()
            && self.children.is_empty()
            && self.related.is_empty()
            && self.sign_in_with.is_none()
            && self.signs_in_to.is_empty()
    }
}

/// What `items.relations_ciphertext` decrypts to: ids only, under the vault key like every other
/// value, so the link graph is no more visible on disk than an item's title is. Children are not
/// stored — they are the items whose `parent` names this one.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
struct RelationRecord {
    #[serde(default)]
    parent: Option<String>,
    #[serde(default)]
    related: Vec<String>,
    /// The item this one signs in with (schema 4 era; an older build reading the record ignores
    /// the key, and drops it if it rewrites that item's links).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sign_in: Option<String>,
}

impl RelationRecord {
    fn is_empty(&self) -> bool {
        self.parent.is_none() && self.related.is_empty() && self.sign_in.is_none()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct VaultSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    /// The row's own styling, picked the same way a tag's is. A name alone is hard to tell apart in a
    /// sidebar that now lists every vault side by side.
    pub icon: String,
    pub color: String,
    pub archived: bool,
    /// Live items only — archived and trashed ones are not what clicking the row reveals.
    pub item_count: usize,
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

/// A plain-text attachment as the preview sheet shows it: decoded as UTF-8 (invalid bytes become
/// U+FFFD), cut at `TEXT_PREVIEW_LIMIT` bytes on a character boundary.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AttachmentText {
    pub file_name: String,
    pub text: String,
    /// Bytes in the stored file, so the sheet can say how much it left out.
    pub total_bytes: usize,
    pub truncated: bool,
    /// Some bytes were not UTF-8 and were replaced.
    pub lossy: bool,
}

/// The most of a text attachment the preview decodes and sends across the bridge (256KB).
pub const TEXT_PREVIEW_LIMIT: usize = 256 * 1024;

/// Decodes up to `limit` bytes of a text file for the preview. A UTF-8 byte-order mark is dropped,
/// and a cut that lands inside a multi-byte character backs up to its start rather than showing
/// half of it as a replacement character.
pub fn text_preview(file_name: &str, bytes: &[u8], limit: usize) -> AttachmentText {
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let truncated = body.len() > limit;
    let mut slice = &body[..body.len().min(limit)];
    if truncated {
        // Look back at most three bytes for the lead byte of a character the cut split.
        for back in 1..=3.min(slice.len()) {
            let lead = slice[slice.len() - back];
            let width = match lead {
                0xC0..=0xDF => 2,
                0xE0..=0xEF => 3,
                0xF0..=0xF7 => 4,
                _ => 0,
            };
            if width > back {
                slice = &slice[..slice.len() - back];
                break;
            }
            if width != 0 || lead < 0x80 {
                break;
            }
        }
    }
    let decoded = String::from_utf8_lossy(slice);
    let lossy = matches!(decoded, std::borrow::Cow::Owned(_));
    AttachmentText {
        file_name: file_name.to_string(),
        text: decoded.into_owned(),
        total_bytes: bytes.len(),
        truncated,
        lossy,
    }
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
    #[error("the item to save the passkey to was not found")]
    PasskeyItemNotFound,
    #[error("tag name cannot be empty")]
    TagNameEmpty,
    #[error("tag not found")]
    TagNotFound,
    #[error("vault name cannot be empty")]
    VaultNameEmpty,
    #[error("vault still holds items, so a destination is needed")]
    VaultDestinationRequired,
    #[error("the last vault cannot be dissolved")]
    VaultLastOne,
    #[error("an item cannot be linked to itself")]
    RelationSelf,
    #[error("that link would make an item its own parent")]
    RelationCycle,
    #[error("the item to link was not found")]
    RelationItemNotFound,
    #[error("this item has a parent, child items or related items; remove those links or archive it instead")]
    ItemHasRelations,
    #[error("this item has linked items; remove those links before moving it to another vault")]
    ItemRelationsBlockMove,
    #[error("unknown icon mode")]
    InvalidIconMode,
    #[error("item not found")]
    ItemNotFound,
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
        self.run_legacy_migrations(&session)?;
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

        let mut created = self
            .get_login_item(session, &id)?
            .expect("created login item should be readable");
        created.relations = self.item_relations(session, &id)?;
        Ok(created)
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
        if source.icon_mode != ICON_MODE_AUTO {
            self.set_item_icon_mode(session, &created.id, &source.icon_mode)?;
        }
        if attachments.is_empty() {
            self.record_event("duplicate_item", &format!("Duplicated item {item_id}"))?;
            return Ok(self
                .get_login_item(session, &created.id)?
                .expect("duplicated login item should be readable"));
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
        self.list_live_items(session, None)
    }

    /// Every vault, archived ones included — the sidebar splits the two into their own groups, and it
    /// needs the archived rows in hand to know that group is not empty. The count is SQL's rather than
    /// the item list's because, unlike a tag's, a vault's items are not in memory.
    pub fn list_vaults(&self, session: &Session) -> Result<Vec<VaultSummary>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name_ciphertext, created_at, updated_at, icon, color, archived,
                    (SELECT count(*) FROM items i
                      WHERE i.vault_id = vaults.id AND i.archived = 0 AND i.trashed = 0)
             FROM vaults ORDER BY created_at ASC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        rows.into_iter()
            .map(
                |(
                    id,
                    name_ciphertext,
                    created_at,
                    updated_at,
                    icon,
                    color,
                    archived,
                    item_count,
                )| {
                    Ok(VaultSummary {
                        id,
                        name: decrypt_string_from_blob(&session.key, &name_ciphertext)?,
                        created_at,
                        updated_at,
                        icon,
                        color,
                        archived: archived != 0,
                        item_count: item_count as usize,
                    })
                },
            )
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
            icon: "vault".to_string(),
            color: String::new(),
            archived: false,
            item_count: 0,
        })
    }

    /// Renames a vault and sets its styling. The name is the only thing shown about a vault that is
    /// encrypted at rest, so this re-encrypts; the icon and colour are plain columns like a tag's.
    pub fn update_vault(
        &mut self,
        session: &Session,
        vault_id: &str,
        name: &str,
        icon: &str,
        color: &str,
    ) -> Result<(), VaultError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(VaultError::VaultNameEmpty);
        }
        let exists = self
            .connection
            .query_row("SELECT 1 FROM vaults WHERE id = ?1", [vault_id], |_| Ok(()))
            .optional()?
            .is_some();
        if !exists {
            return Err(VaultError::VaultNotFound);
        }

        self.connection.execute(
            "UPDATE vaults SET name_ciphertext = ?1, icon = ?2, color = ?3, updated_at = ?4
             WHERE id = ?5",
            params![
                encrypt_string_to_blob(&session.key, name)?,
                icon,
                color,
                Utc::now().to_rfc3339(),
                vault_id
            ],
        )?;
        self.record_event("update_vault", &format!("Updated vault {vault_id}"))
    }

    /// Archiving a vault archives what is in it as well, so the items reach the existing 已归档 view
    /// rather than hiding behind a vault the sidebar no longer lists. Only the rows this call flips are
    /// marked, so restoring the vault cannot resurrect an item the user had archived on its own.
    pub fn set_vault_archived(
        &mut self,
        session: &Session,
        vault_id: &str,
        archived: bool,
    ) -> Result<(), VaultError> {
        let target = self.session_for_vault(session, vault_id)?;

        let now = Utc::now().to_rfc3339();
        if archived {
            self.connection.execute(
                "UPDATE items SET archived = 1, archived_by_vault = 1, updated_at = ?1
                 WHERE vault_id = ?2 AND archived = 0 AND trashed = 0",
                params![now, &target.vault_id],
            )?;
        } else {
            self.connection.execute(
                "UPDATE items SET archived = 0, archived_by_vault = 0, updated_at = ?1
                 WHERE vault_id = ?2 AND archived_by_vault = 1",
                params![now, &target.vault_id],
            )?;
        }
        self.connection.execute(
            "UPDATE vaults SET archived = ?1, updated_at = ?2 WHERE id = ?3",
            params![bool_to_i64(archived), now, vault_id],
        )?;
        self.record_event(
            if archived { "archive_vault" } else { "restore_vault" },
            &format!("Archived: {archived} vault {vault_id}"),
        )
    }

    /// Empties a vault into another one and deletes the row. There is no undo and no export, so this is
    /// the one sidebar action that ends with data gone — which is why every item, archived or trashed
    /// included, is moved rather than left to `ON DELETE CASCADE`. An empty vault needs no destination,
    /// but a vault with items does, and the last vault in the file stays whether it is empty or not.
    pub fn dissolve_vault(
        &mut self,
        session: &Session,
        vault_id: &str,
        into_vault_id: Option<&str>,
    ) -> Result<(), VaultError> {
        let source = self.session_for_vault(session, vault_id)?;

        let others = self
            .connection
            .query_row(
                "SELECT count(*) FROM vaults WHERE id <> ?1",
                [vault_id],
                |row| row.get::<_, i64>(0),
            )?;
        if others == 0 {
            return Err(VaultError::VaultLastOne);
        }

        let mut statement = self
            .connection
            .prepare("SELECT id FROM items WHERE vault_id = ?1 ORDER BY created_at ASC")?;
        let item_ids = statement
            .query_map([source.vault_id.clone()], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        if !item_ids.is_empty() {
            let destination = into_vault_id.ok_or(VaultError::VaultDestinationRequired)?;
            let target = self.session_for_vault(session, destination)?;
            if target.vault_id == source.vault_id {
                return Err(VaultError::VaultDestinationRequired);
            }
            for item_id in &item_ids {
                self.rehome_item_tags(&target, item_id)?;
                self.connection.execute(
                    "UPDATE items SET vault_id = ?1, updated_at = ?2 WHERE id = ?3",
                    params![&target.vault_id, Utc::now().to_rfc3339(), item_id],
                )?;
            }
            self.prune_unused_tags(&source)?;
        }

        self.connection
            .execute("DELETE FROM vaults WHERE id = ?1", [vault_id])?;
        self.record_event(
            "dissolve_vault",
            &match into_vault_id {
                Some(destination) => format!("Dissolved vault {vault_id} into {destination}"),
                None => format!("Dissolved empty vault {vault_id}"),
            },
        )
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
        self.run_legacy_migrations(&session)?;
        Ok(session)
    }

    /// The legacy-format migrations each decrypt the whole vault, so together they cost several full
    /// passes, and they used to run on every unlock and on every vault switch (which selecting an
    /// item from another vault in All does). Data written by current builds never needs them, so once
    /// they have run to completion for a vault it is remembered, per vault, and skipped afterwards.
    fn run_legacy_migrations(&mut self, session: &Session) -> Result<(), VaultError> {
        let key = format!("{LEGACY_MIGRATIONS_META}:{}", session.vault_id);
        if self.get_meta(&key)?.as_deref() == Some(LEGACY_MIGRATIONS_VERSION) {
            return Ok(());
        }
        self.migrate_legacy_tags(session)?;
        self.migrate_standalone_passkeys(session)?;
        self.migrate_legacy_related_fields(session)?;
        self.migrate_legacy_sign_in_fields(session)?;
        self.set_meta(&key, LEGACY_MIGRATIONS_VERSION)
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
        // Links never cross a vault, so an item that has any stays where its counterparts are.
        if self.has_relations(session, item_id)? {
            return Err(VaultError::ItemRelationsBlockMove);
        }

        let moved = self.connection.execute(
            "UPDATE items SET vault_id = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
            params![&target.vault_id, Utc::now().to_rfc3339(), item_id, session.vault_id],
        )?;
        if moved == 0 {
            return Err(VaultError::VaultNotFound);
        }

        self.rehome_item_tags(&target, item_id)?;
        self.prune_unused_tags(session)?;
        self.record_event("move_item", &format!("Moved item {item_id} to vault {vault_id}"))?;
        Ok(())
    }

    /// Re-points one item's tag links at the target vault's rows for the same names, creating those
    /// rows where the target does not have one yet. Called before the item's own `vault_id` changes,
    /// while its links still resolve through the source.
    fn rehome_item_tags(&self, target: &Session, item_id: &str) -> Result<(), VaultError> {
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

        let mut updated = self
            .get_login_item(session, &input.id)?
            .expect("updated login item should be readable");
        updated.relations = self.item_relations(session, &input.id)?;
        Ok(updated)
    }

    /// Deleting is refused while the item has any link: the parent would silently lose a child, or a
    /// peer its counterpart. Archiving is the way to put such an item away (links are kept).
    pub fn trash_item(&mut self, session: &Session, item_id: &str) -> Result<(), VaultError> {
        if self.has_relations(session, item_id)? {
            return Err(VaultError::ItemHasRelations);
        }
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

    // Test-only since the window reads summaries (`list_login_summaries`).
    #[cfg(test)]
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
        if self.has_relations(session, item_id)? {
            return Err(VaultError::ItemHasRelations);
        }
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

    /// Counts one use of an item (a field copied, Open & Fill) for the Frequently / Recently Used sorts.
    pub fn record_item_use(&mut self, session: &Session, item_id: &str) -> Result<(), VaultError> {
        self.connection.execute(
            "UPDATE items SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2 AND vault_id = ?3",
            params![Utc::now().to_rfc3339(), item_id, session.vault_id],
        )?;
        Ok(())
    }

    /// The vaults the cross-vault views read: every vault that is not archived.
    fn open_vault_ids(&self) -> Result<Vec<String>, VaultError> {
        let mut statement =
            self.connection.prepare("SELECT id FROM vaults WHERE archived = 0 ORDER BY created_at ASC")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    fn all_vault_ids(&self) -> Result<Vec<String>, VaultError> {
        let mut statement = self.connection.prepare("SELECT id FROM vaults ORDER BY created_at ASC")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    // Test-only since the window reads summaries (`list_login_summaries`).
    #[cfg(test)]
    /// All (owner 2026-10-18): every live item of every open vault, each carrying its `vault_id`.
    pub fn list_all_login_items(&self, session: &Session) -> Result<Vec<LoginItem>, VaultError> {
        let mut items = Vec::new();
        for vault_id in self.open_vault_ids()? {
            items.extend(self.list_login_items(&session.for_vault(&vault_id), None)?);
        }
        Ok(items)
    }

    /// The browser extension reads every open vault (owner 2026-10-18), the open one first so its
    /// items lead the list and win a tie.
    pub fn open_vault_sessions(&self, session: &Session) -> Result<Vec<Session>, VaultError> {
        let mut ids = self.open_vault_ids()?;
        if let Some(position) = ids.iter().position(|id| id == &session.vault_id) {
            let current = ids.remove(position);
            ids.insert(0, current);
        }
        Ok(ids.iter().map(|id| session.for_vault(id)).collect())
    }

    /// Autofill candidates for a page from every open vault.
    pub fn list_login_items_for_origin_everywhere(
        &self,
        session: &Session,
        origin: &str,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let mut matches = Vec::new();
        for vault in self.open_vault_sessions(session)? {
            matches.extend(self.list_login_items_for_origin(&vault, origin)?);
        }
        Ok(matches)
    }

    /// The login a save from this page updates, wherever it lives, with the session of its vault.
    pub fn find_site_login_everywhere(
        &self,
        session: &Session,
        origin: &str,
        username: &str,
    ) -> Result<Option<(Session, LoginItem)>, VaultError> {
        for vault in self.open_vault_sessions(session)? {
            if let Some(item) = self
                .list_login_items_for_site(&vault, origin)?
                .into_iter()
                .find(|item| item.username == username)
            {
                return Ok(Some((vault, item)));
            }
        }
        Ok(None)
    }

    /// A passkey reported by the extension goes to the item it names or matches in whichever open vault
    /// holds it; a new item (or no match anywhere) is created in the open vault.
    pub fn save_passkey_everywhere(
        &mut self,
        session: &Session,
        overwrite: bool,
        origin: &str,
        rp_id: &str,
        user_name: &str,
        target: &PasskeyTarget,
        credential: Option<&StoredPasskey>,
    ) -> Result<LoginItem, VaultError> {
        let holder = match target {
            PasskeyTarget::NewItem => None,
            PasskeyTarget::Item(id) => {
                let mut found = None;
                for vault in self.open_vault_sessions(session)? {
                    if self.list_live_items(&vault, None)?.iter().any(|item| &item.id == id) {
                        found = Some(vault);
                        break;
                    }
                }
                Some(found.ok_or(VaultError::PasskeyItemNotFound)?)
            }
            PasskeyTarget::Matching => {
                let rp = rp_id.trim();
                let mut found = None;
                for vault in self.open_vault_sessions(session)? {
                    if self.list_live_items(&vault, None)?.iter().any(|item| {
                        item.item_type != PASSKEY_ITEM_TYPE && item_matches_rp_id(item, rp)
                    }) {
                        found = Some(vault);
                        break;
                    }
                }
                found
            }
        };
        let vault = holder.unwrap_or_else(|| session.clone());
        self.save_passkey(&vault, overwrite, origin, rp_id, user_name, target, credential)
    }

    /// Every passkey Passless itself holds for a relying party, across the open vaults, with the item
    /// that carries it (the extension's sign-in picker and its signer).
    pub fn passkey_credentials_everywhere(
        &self,
        session: &Session,
        rp_id: &str,
    ) -> Result<Vec<(Session, LoginItem, StoredPasskey)>, VaultError> {
        let rp_id = rp_id.trim().to_ascii_lowercase();
        let mut found = Vec::new();
        for vault in self.open_vault_sessions(session)? {
            for item in self.list_live_items(&vault, None)? {
                for field in &item.custom_fields {
                    if let Some(stored) = StoredPasskey::from_field(field) {
                        if stored.rp_id.eq_ignore_ascii_case(&rp_id) {
                            found.push((vault.clone(), item.clone(), stored));
                        }
                    }
                }
            }
        }
        Ok(found)
    }

    /// Tags belong to All, not to a vault (owner 2026-10-18): one entry per name across the open vaults,
    /// styled as the open vault styles it, else as the first vault that has it.
    pub fn list_all_tags(&self, session: &Session) -> Result<Vec<Tag>, VaultError> {
        let mut ids = self.open_vault_ids()?;
        if let Some(position) = ids.iter().position(|id| id == &session.vault_id) {
            let current = ids.remove(position);
            ids.insert(0, current);
        }
        let mut tags: Vec<Tag> = Vec::new();
        for vault_id in ids {
            for tag in self.list_tags(&session.for_vault(&vault_id))? {
                if !tags.iter().any(|existing| existing.name == tag.name) {
                    tags.push(tag);
                }
            }
        }
        tags.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(tags)
    }

    /// Renames or restyles a tag in every vault that has it.
    pub fn update_tag_everywhere(
        &mut self,
        session: &Session,
        name: &str,
        new_name: &str,
        icon: &str,
        color: &str,
    ) -> Result<(), VaultError> {
        let mut found = false;
        for vault_id in self.all_vault_ids()? {
            let scoped = session.for_vault(&vault_id);
            if self.tag_id(&scoped, name)?.is_some() {
                self.update_tag(&scoped, name, new_name, icon, color)?;
                found = true;
            }
        }
        if found { Ok(()) } else { Err(VaultError::TagNotFound) }
    }

    /// Deletes a tag from every vault that has it (the items stay).
    pub fn delete_tag_everywhere(&mut self, session: &Session, name: &str) -> Result<(), VaultError> {
        let mut found = false;
        for vault_id in self.all_vault_ids()? {
            let scoped = session.for_vault(&vault_id);
            if self.tag_id(&scoped, name)?.is_some() {
                self.delete_tag(&scoped, name)?;
                found = true;
            }
        }
        if found { Ok(()) } else { Err(VaultError::TagNotFound) }
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


    // Test-only since the window reads summaries (`list_login_summaries`).
    #[cfg(test)]
    /// The live items the app window lists, each with its links resolved.
    pub fn list_login_items(
        &self,
        session: &Session,
        query: Option<&str>,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let mut items = self.list_live_items(session, query)?;
        self.attach_relations(session, &mut items)?;
        Ok(items)
    }

    /// The app window's list (owner 2026-10-23): summaries only. Without a query only what a row needs
    /// is decrypted — title, username, the first address, tag names, and the custom-field JSON, read
    /// for the "Sign in with" provider and dropped — never the password, the notes or the other
    /// addresses. A query searches the fully decrypted items here in Rust, as `matches_query` always
    /// did (every field value included), and still answers with summaries.
    pub fn list_login_summaries(
        &self,
        session: &Session,
        query: Option<&str>,
    ) -> Result<Vec<LoginItemSummary>, VaultError> {
        let query = query
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty());
        let Some(query) = query else {
            return self.list_summaries_by_state(session, ItemState::Live);
        };
        let mut summaries: Vec<LoginItemSummary> = self
            .list_live_items(session, Some(&query))?
            .iter()
            .map(LoginItemSummary::from_item)
            .collect();
        self.attach_summary_relations(session, &mut summaries)?;
        Ok(summaries)
    }

    /// All: every open vault's live items as summaries, each carrying its `vault_id`.
    pub fn list_all_login_summaries(&self, session: &Session) -> Result<Vec<LoginItemSummary>, VaultError> {
        let mut summaries = Vec::new();
        for vault_id in self.open_vault_ids()? {
            summaries.extend(self.list_summaries_by_state(&session.for_vault(&vault_id), ItemState::Live)?);
        }
        Ok(summaries)
    }

    pub fn list_archived_login_summaries(
        &self,
        session: &Session,
    ) -> Result<Vec<LoginItemSummary>, VaultError> {
        self.list_summaries_by_state(session, ItemState::Archived)
    }

    pub fn list_trashed_login_summaries(
        &self,
        session: &Session,
    ) -> Result<Vec<LoginItemSummary>, VaultError> {
        self.list_summaries_by_state(session, ItemState::Trashed)
    }

    /// One item, fully decrypted with its links resolved: what the detail pane opens.
    pub fn login_item_detail(&self, session: &Session, item_id: &str) -> Result<LoginItem, VaultError> {
        let mut item = self
            .get_login_item(session, item_id)?
            .ok_or(VaultError::ItemNotFound)?;
        item.relations = self.item_relations(session, item_id)?;
        Ok(item)
    }

    /// Four reads for the whole list instead of four per item, and only the columns a row shows.
    fn list_summaries_by_state(
        &self,
        session: &Session,
        state: ItemState,
    ) -> Result<Vec<LoginItemSummary>, VaultError> {
        let filter = state.filter();
        let mut statement = self.connection.prepare(&format!(
            "SELECT i.id, i.item_type, i.title_ciphertext, i.favorite, i.updated_at, i.icon_mode,
                    i.created_at, i.use_count, i.last_used_at
             FROM items i WHERE i.vault_id = ?1 AND {filter} ORDER BY {}",
            state.order()
        ))?;
        let rows = statement
            .query_map([&session.vault_id], |row| {
                Ok((
                    (row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Vec<u8>>(2)?),
                    (row.get::<_, i64>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?),
                    (row.get::<_, String>(6)?, row.get::<_, i64>(7)?, row.get::<_, Option<String>>(8)?),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        if rows.is_empty() {
            return Ok(Vec::new());
        }

        // The username and the custom-field JSON only: the password and notes rows are never read.
        let mut fields: HashMap<String, (Option<Vec<u8>>, Option<Vec<u8>>)> = HashMap::new();
        {
            let mut statement = self.connection.prepare(&format!(
                "SELECT f.item_id, f.field_key, f.value_ciphertext FROM item_fields f
                 JOIN items i ON i.id = f.item_id
                 WHERE i.vault_id = ?1 AND {filter} AND f.field_key IN ('username', 'custom_fields')"
            ))?;
            let mut query = statement.query([&session.vault_id])?;
            while let Some(row) = query.next()? {
                let entry = fields.entry(row.get::<_, String>(0)?).or_default();
                let blob = row.get::<_, Vec<u8>>(2)?;
                if row.get::<_, String>(1)? == "username" {
                    entry.0 = Some(blob);
                } else {
                    entry.1 = Some(blob);
                }
            }
        }

        // The first address of each item (lowest position), the one `get_login_item` calls `website`.
        let mut first_urls: HashMap<String, Vec<u8>> = HashMap::new();
        {
            let mut statement = self.connection.prepare(&format!(
                "SELECT u.item_id, u.url_ciphertext FROM item_urls u
                 JOIN items i ON i.id = u.item_id
                 WHERE i.vault_id = ?1 AND {filter}
                 ORDER BY u.item_id, u.position"
            ))?;
            let mut query = statement.query([&session.vault_id])?;
            while let Some(row) = query.next()? {
                first_urls
                    .entry(row.get::<_, String>(0)?)
                    .or_insert(row.get::<_, Vec<u8>>(1)?);
            }
        }

        // Tag names, each tag row decrypted once however many items carry it.
        let mut tags: HashMap<String, Vec<String>> = HashMap::new();
        {
            let mut names: HashMap<String, String> = HashMap::new();
            let mut statement = self.connection.prepare(&format!(
                "SELECT it.item_id, t.id, t.name_ciphertext FROM item_tags it
                 JOIN tags t ON t.id = it.tag_id
                 JOIN items i ON i.id = it.item_id
                 WHERE i.vault_id = ?1 AND {filter}
                 ORDER BY it.item_id, it.position"
            ))?;
            let mut query = statement.query([&session.vault_id])?;
            while let Some(row) = query.next()? {
                let item_id = row.get::<_, String>(0)?;
                let tag_id = row.get::<_, String>(1)?;
                let name = match names.get(&tag_id) {
                    Some(name) => name.clone(),
                    None => {
                        let name = decrypt_string_from_blob(&session.key, &row.get::<_, Vec<u8>>(2)?)?;
                        names.insert(tag_id, name.clone());
                        name
                    }
                };
                tags.entry(item_id).or_default().push(name);
            }
        }

        let mut summaries = Vec::with_capacity(rows.len());
        for ((id, item_type, title_ciphertext), (favorite, updated_at, icon_mode), (created_at, use_count, last_used_at)) in
            rows
        {
            let (username_blob, custom_blob) = fields.remove(&id).unwrap_or_default();
            let username = username_blob
                .map(|blob| decrypt_string_from_blob(&session.key, &blob))
                .transpose()?
                .unwrap_or_default();
            let sign_in_with = match custom_blob {
                Some(blob) => {
                    let json = decrypt_string_from_blob(&session.key, &blob)?;
                    // Most items have no "Sign in with" field; skip the parse for them.
                    if json.contains(SIGN_IN_WITH_FIELD) {
                        sign_in_field_value(&serde_json::from_str::<Vec<CustomField>>(&json)?)
                    } else {
                        None
                    }
                }
                None => None,
            };
            let website = first_urls
                .remove(&id)
                .map(|blob| decrypt_string_from_blob(&session.key, &blob))
                .transpose()?
                .unwrap_or_default();
            summaries.push(LoginItemSummary {
                title: decrypt_string_from_blob(&session.key, &title_ciphertext)?,
                tags: tags.remove(&id).unwrap_or_default(),
                id,
                vault_id: session.vault_id.clone(),
                item_type,
                username,
                website,
                favorite: favorite == 1,
                updated_at,
                created_at,
                use_count,
                last_used_at,
                icon_mode,
                sign_in_with,
                parent_id: None,
                has_relations: false,
            });
        }
        self.attach_summary_relations(session, &mut summaries)?;
        Ok(summaries)
    }

    /// `parent_id` and `has_relations` from one decrypted index, with the rule `relation_ref` applies:
    /// a link counts only while its other end is an item of this vault outside the trash.
    fn attach_summary_relations(
        &self,
        session: &Session,
        summaries: &mut [LoginItemSummary],
    ) -> Result<(), VaultError> {
        let index = self.relation_index(session)?;
        if index.is_empty() {
            return Ok(());
        }
        let mut statement = self
            .connection
            .prepare("SELECT id FROM items WHERE vault_id = ?1 AND trashed = 0")?;
        let resolvable = statement
            .query_map([&session.vault_id], |row| row.get::<_, String>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        // Items another resolvable item names as its parent or its sign-in account.
        let mut named_by_others: HashSet<&str> = HashSet::new();
        for (other_id, record) in &index {
            if !resolvable.contains(other_id) {
                continue;
            }
            if let Some(parent) = &record.parent {
                named_by_others.insert(parent.as_str());
            }
            if let Some(sign_in) = &record.sign_in {
                named_by_others.insert(sign_in.as_str());
            }
        }
        for summary in summaries.iter_mut() {
            let own = index.get(&summary.id);
            summary.parent_id = own
                .and_then(|record| record.parent.clone())
                .filter(|id| resolvable.contains(id));
            summary.has_relations = summary.parent_id.is_some()
                || named_by_others.contains(summary.id.as_str())
                || own.is_some_and(|record| {
                    record.related.iter().any(|id| resolvable.contains(id))
                        || record.sign_in.as_ref().is_some_and(|id| resolvable.contains(id))
                });
        }
        Ok(())
    }

    /// The live items without their links — what the bridge, Watchtower and the migrations read,
    /// none of which has any use for other items' titles.
    fn list_live_items(
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

    // Test-only since the window reads summaries (`list_login_summaries`).
    #[cfg(test)]
    pub fn list_archived_login_items(
        &self,
        session: &Session,
    ) -> Result<Vec<LoginItem>, VaultError> {
        self.list_login_items_by_archive_state(session, true)
    }

    /// What the browser bridge asks for: items one of whose saved addresses covers this page under
    /// its own autofill behaviour (`site_match::address_matches`). Deliberately not the search path —
    /// a search matches any field as a substring, far too loose a rule to hand a password over to.
    pub fn list_login_items_for_origin(
        &self,
        session: &Session,
        origin: &str,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let Some(page) = site_match::parse_site(origin) else {
            return Ok(Vec::new());
        };
        let mut matches = Vec::new();
        for item in self.list_live_items(session, None)? {
            if normalized_urls(&item.website, &item.urls)
                .iter()
                .any(|url| site_match::address_matches(&url.url, &url.match_type, &page))
            {
                matches.push(item);
            }
        }
        Ok(matches)
    }

    /// The items a login saved from this page could be an update of: any address on the same site,
    /// whatever its autofill behaviour — "never fill here" is not "this is not my account here", and
    /// ignoring it would make the extension save a duplicate the user then has to clean up.
    pub fn list_login_items_for_site(
        &self,
        session: &Session,
        origin: &str,
    ) -> Result<Vec<LoginItem>, VaultError> {
        let Some(page) = site_match::parse_site(origin) else {
            return Ok(Vec::new());
        };
        let mut matches = Vec::new();
        for item in self.list_live_items(session, None)? {
            if normalized_urls(&item.website, &item.urls).iter().any(|url| {
                site_match::address_matches(&url.url, site_match::MODE_DOMAIN, &page)
            }) {
                matches.push(item);
            }
        }
        Ok(matches)
    }

    pub fn watchtower_report(&self, session: &Session) -> Result<WatchtowerReport, VaultError> {
        let items = self.list_live_items(session, None)?;
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
        self.add_attachment_bytes(session, item_id, &file_name, &bytes)
    }

    /// The same attachment row from bytes already in memory (an import reads them out of an archive).
    pub fn add_attachment_bytes(
        &mut self,
        session: &Session,
        item_id: &str,
        file_name: &str,
        bytes: &[u8],
    ) -> Result<CustomField, VaultError> {
        if self.get_login_item(session, item_id)?.is_none() {
            return Err(VaultError::VaultNotFound);
        }
        let file_name = if file_name.trim().is_empty() { "attachment" } else { file_name }.to_string();
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

    /// After an import created an item (and its attachments): the final fields, the source's timestamps, and
    /// its archived state.
    pub fn finish_imported_item(
        &mut self,
        session: &Session,
        item_id: &str,
        input: &LoginItemInput,
        created_at: Option<String>,
        updated_at: Option<String>,
        archived: bool,
    ) -> Result<(), VaultError> {
        self.replace_login_fields(
            session,
            item_id,
            &input.username,
            &input.password,
            &input.notes,
            &input.custom_fields,
        )?;
        let now = Utc::now().to_rfc3339();
        let created = created_at.unwrap_or_else(|| now.clone());
        let updated = updated_at.unwrap_or_else(|| created.clone());
        self.connection.execute(
            "UPDATE items SET created_at = ?1, updated_at = ?2, archived = ?3 WHERE id = ?4 AND vault_id = ?5",
            params![created, updated, bool_to_i64(archived), item_id, session.vault_id],
        )?;
        Ok(())
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

    #[cfg(test)]
    pub fn upsert_passkey_event(
        &mut self,
        session: &Session,
        event_type: &str,
        origin: &str,
        rp_id: &str,
        user_name: &str,
    ) -> Result<LoginItem, VaultError> {
        // A sign-in must not clobber a handle we already stored; a registration may.
        self.save_passkey(
            session,
            event_type == "create",
            origin,
            rp_id,
            user_name,
            &PasskeyTarget::Matching,
            None,
        )
    }

    /// Records a passkey's metadata (the relying party and the account handle) on a login. The
    /// browser extension calls this only after the user pressed Save in its prompt; the private
    /// key never leaves the platform authenticator.
    pub fn save_passkey(
        &mut self,
        session: &Session,
        overwrite: bool,
        origin: &str,
        rp_id: &str,
        user_name: &str,
        target: &PasskeyTarget,
        credential: Option<&StoredPasskey>,
    ) -> Result<LoginItem, VaultError> {
        let rp_id = rp_id.trim();
        let target = match target {
            PasskeyTarget::NewItem => None,
            PasskeyTarget::Matching => self.list_live_items(session, None)?.into_iter().find(|item| {
                item.item_type != PASSKEY_ITEM_TYPE && item_matches_rp_id(item, rp_id)
            }),
            PasskeyTarget::Item(id) => Some(
                self.list_live_items(session, None)?
                    .into_iter()
                    .find(|item| &item.id == id && item.item_type != PASSKEY_ITEM_TYPE)
                    .ok_or(VaultError::PasskeyItemNotFound)?,
            ),
        };

        if let Some(target) = target {
            let custom_fields = with_passkey_credential(
                upsert_passkey_field(&target.custom_fields, rp_id, user_name, overwrite),
                credential,
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
                // The legacy note says the key stays with the platform authenticator — untrue once Passless holds it.
                notes: if credential.is_some() { String::new() } else { PASSKEY_NOTE.to_string() },
                tags: vec!["passkey".to_string()],
                custom_fields: with_passkey_credential(vec![passkey_field(rp_id, user_name)], credential),
                favorite: false,
            },
        )
    }

    /// Folds the pre-field `item_type = "passkey"` records into the login item they belong
    /// to. Runs on every unlock and is a no-op once nothing is left.
    fn migrate_standalone_passkeys(&mut self, session: &Session) -> Result<(), VaultError> {
        let legacy = self
            .list_live_items(session, None)?
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
                .list_live_items(session, None)?
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

    /// Sets (or, with `None`, clears) the one parent an item belongs to. Both ends must be items of
    /// this vault that are not in the trash; an item cannot be its own parent, nor the parent of
    /// anything above it.
    pub fn set_item_parent(
        &mut self,
        session: &Session,
        item_id: &str,
        parent_id: Option<&str>,
    ) -> Result<(), VaultError> {
        if !self.linkable_item_exists(session, item_id)? {
            return Err(VaultError::RelationItemNotFound);
        }
        let mut record = self.relation_record(session, item_id)?;
        if let Some(parent_id) = parent_id {
            if parent_id == item_id {
                return Err(VaultError::RelationSelf);
            }
            if !self.linkable_item_exists(session, parent_id)? {
                return Err(VaultError::RelationItemNotFound);
            }
            let index = self.relation_index(session)?;
            let mut cursor = Some(parent_id.to_string());
            let mut seen = HashSet::new();
            while let Some(current) = cursor {
                if current == item_id {
                    return Err(VaultError::RelationCycle);
                }
                if !seen.insert(current.clone()) {
                    break;
                }
                cursor = index.get(&current).and_then(|record| record.parent.clone());
            }
        }
        let next = parent_id.map(str::to_string);
        if record.parent == next {
            return Ok(());
        }
        record.parent = next;
        self.write_relation_record(session, item_id, &record)?;
        self.record_event("relate_item", &format!("Set the parent of item {item_id}"))?;
        Ok(())
    }

    /// Links two items as peers. The link is written on both sides, so either one lists the other
    /// and unlinking from either end clears both.
    pub fn link_related_items(
        &mut self,
        session: &Session,
        item_id: &str,
        other_id: &str,
    ) -> Result<(), VaultError> {
        if item_id == other_id {
            return Err(VaultError::RelationSelf);
        }
        if !self.linkable_item_exists(session, item_id)?
            || !self.linkable_item_exists(session, other_id)?
        {
            return Err(VaultError::RelationItemNotFound);
        }
        for (from, to) in [(item_id, other_id), (other_id, item_id)] {
            let mut record = self.relation_record(session, from)?;
            if !record.related.iter().any(|id| id == to) {
                record.related.push(to.to_string());
                self.write_relation_record(session, from, &record)?;
            }
        }
        self.record_event("relate_item", &format!("Linked items {item_id} and {other_id}"))?;
        Ok(())
    }

    pub fn unlink_related_items(
        &mut self,
        session: &Session,
        item_id: &str,
        other_id: &str,
    ) -> Result<(), VaultError> {
        for (from, to) in [(item_id, other_id), (other_id, item_id)] {
            let mut record = self.relation_record(session, from)?;
            let before = record.related.len();
            record.related.retain(|id| id != to);
            if record.related.len() != before {
                self.write_relation_record(session, from, &record)?;
            }
        }
        self.record_event("unrelate_item", &format!("Unlinked items {item_id} and {other_id}"))?;
        Ok(())
    }

    /// Records (or with `None`, clears) the account an item signs in with. It is a link like the
    /// others: same vault, never itself, and either end refuses Delete and Move while it stands.
    pub fn set_item_sign_in(
        &mut self,
        session: &Session,
        item_id: &str,
        account_id: Option<&str>,
    ) -> Result<(), VaultError> {
        if !self.linkable_item_exists(session, item_id)? {
            return Err(VaultError::RelationItemNotFound);
        }
        if let Some(account_id) = account_id {
            if account_id == item_id {
                return Err(VaultError::RelationSelf);
            }
            if !self.linkable_item_exists(session, account_id)? {
                return Err(VaultError::RelationItemNotFound);
            }
        }
        let mut record = self.relation_record(session, item_id)?;
        let next = account_id.map(str::to_string);
        if record.sign_in == next {
            return Ok(());
        }
        record.sign_in = next;
        self.write_relation_record(session, item_id, &record)?;
        self.record_event("relate_item", &format!("Set the sign-in account of item {item_id}"))?;
        Ok(())
    }

    /// Whether the item has any link the user can see — a dangling id (its counterpart gone) does
    /// not count, because nothing in the app could remove it and it would block deleting forever.
    fn has_relations(&self, session: &Session, item_id: &str) -> Result<bool, VaultError> {
        Ok(!self.item_relations(session, item_id)?.is_empty())
    }

    /// An item that can take part in a link: in this vault and not in the trash. Archived items
    /// can — archiving keeps links, so refusing new ones there would be arbitrary.
    fn linkable_item_exists(&self, session: &Session, item_id: &str) -> Result<bool, VaultError> {
        Ok(self
            .connection
            .query_row(
                "SELECT 1 FROM items WHERE id = ?1 AND vault_id = ?2 AND trashed = 0",
                params![item_id, session.vault_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    fn relation_record(&self, session: &Session, item_id: &str) -> Result<RelationRecord, VaultError> {
        let blob = self
            .connection
            .query_row(
                "SELECT relations_ciphertext FROM items WHERE id = ?1 AND vault_id = ?2",
                params![item_id, session.vault_id],
                |row| row.get::<_, Option<Vec<u8>>>(0),
            )
            .optional()?
            .flatten();
        match blob {
            Some(blob) => Ok(serde_json::from_str(&decrypt_string_from_blob(&session.key, &blob)?)?),
            None => Ok(RelationRecord::default()),
        }
    }

    /// An item with no links goes back to NULL rather than an encrypted empty record.
    fn write_relation_record(
        &self,
        session: &Session,
        item_id: &str,
        record: &RelationRecord,
    ) -> Result<(), VaultError> {
        let blob = if record.is_empty() {
            None
        } else {
            Some(encrypt_string_to_blob(&session.key, &serde_json::to_string(record)?)?)
        };
        self.connection.execute(
            "UPDATE items SET relations_ciphertext = ?1 WHERE id = ?2 AND vault_id = ?3",
            params![blob, item_id, session.vault_id],
        )?;
        Ok(())
    }

    /// Every stored link record in the vault, decrypted once, so resolving a whole list is one pass
    /// rather than one scan per item.
    fn relation_index(&self, session: &Session) -> Result<HashMap<String, RelationRecord>, VaultError> {
        let mut statement = self.connection.prepare(
            "SELECT id, relations_ciphertext FROM items
             WHERE vault_id = ?1 AND relations_ciphertext IS NOT NULL",
        )?;
        let rows = statement
            .query_map([&session.vault_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut index = HashMap::new();
        for (id, blob) in rows {
            let record: RelationRecord =
                serde_json::from_str(&decrypt_string_from_blob(&session.key, &blob)?)?;
            index.insert(id, record);
        }
        Ok(index)
    }

    /// A linked item as the detail pane draws it; `None` for an id that no longer resolves to an
    /// item of this vault outside the trash.
    fn relation_ref(
        &self,
        session: &Session,
        item_id: &str,
    ) -> Result<Option<RelatedItemRef>, VaultError> {
        let row = self
            .connection
            .query_row(
                "SELECT item_type, title_ciphertext, archived FROM items
                 WHERE id = ?1 AND vault_id = ?2 AND trashed = 0",
                params![item_id, session.vault_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((item_type, title_ciphertext, archived)) = row else {
            return Ok(None);
        };
        Ok(Some(RelatedItemRef {
            id: item_id.to_string(),
            title: decrypt_string_from_blob(&session.key, &title_ciphertext)?,
            item_type,
            archived: archived == 1,
        }))
    }

    fn resolve_relations(
        &self,
        session: &Session,
        item_id: &str,
        index: &HashMap<String, RelationRecord>,
    ) -> Result<ItemRelations, VaultError> {
        let mut relations = ItemRelations::default();
        if let Some(record) = index.get(item_id) {
            if let Some(parent_id) = &record.parent {
                relations.parent = self.relation_ref(session, parent_id)?;
            }
            for related_id in &record.related {
                if let Some(related) = self.relation_ref(session, related_id)? {
                    relations.related.push(related);
                }
            }
            if let Some(sign_in_id) = &record.sign_in {
                relations.sign_in_with = self.relation_ref(session, sign_in_id)?;
            }
        }
        for (other_id, record) in index {
            if record.parent.as_deref() == Some(item_id) {
                if let Some(child) = self.relation_ref(session, other_id)? {
                    relations.children.push(child);
                }
            }
            if record.sign_in.as_deref() == Some(item_id) {
                if let Some(user) = self.relation_ref(session, other_id)? {
                    relations.signs_in_to.push(user);
                }
            }
        }
        let by_title = |left: &RelatedItemRef, right: &RelatedItemRef| {
            left.title.to_lowercase().cmp(&right.title.to_lowercase())
        };
        relations.children.sort_by(by_title);
        relations.signs_in_to.sort_by(by_title);
        Ok(relations)
    }

    pub fn item_relations(&self, session: &Session, item_id: &str) -> Result<ItemRelations, VaultError> {
        let index = self.relation_index(session)?;
        self.resolve_relations(session, item_id, &index)
    }

    // Test-only since the window reads summaries (`list_login_summaries`).
    #[cfg(test)]
    fn attach_relations(&self, session: &Session, items: &mut [LoginItem]) -> Result<(), VaultError> {
        let index = self.relation_index(session)?;
        if index.is_empty() {
            return Ok(());
        }
        for item in items.iter_mut() {
            item.relations = self.resolve_relations(session, &item.id, &index)?;
        }
        Ok(())
    }

    /// Builds before this one offered a "related item" *field* holding another item's id. Each one
    /// that still names a live item of this vault becomes a real peer link and the field goes; one
    /// whose target is gone is left as it was, so nothing the user typed disappears. Items in the
    /// trash are skipped, because a linked item may not sit there.
    fn migrate_legacy_related_fields(&mut self, session: &Session) -> Result<(), VaultError> {
        let mut statement = self
            .connection
            .prepare("SELECT id FROM items WHERE vault_id = ?1 AND trashed = 0")?;
        let ids = statement
            .query_map([&session.vault_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        for id in ids {
            let Some(item) = self.get_login_item(session, &id)? else {
                continue;
            };
            if !item.custom_fields.iter().any(|field| field.field_type == LEGACY_RELATED_FIELD) {
                continue;
            }
            let mut kept = Vec::new();
            let mut linked = false;
            for field in item.custom_fields {
                let target = field.value.trim().to_string();
                if field.field_type == LEGACY_RELATED_FIELD
                    && !target.is_empty()
                    && target != id
                    && self.linkable_item_exists(session, &target)?
                {
                    self.link_related_items(session, &id, &target)?;
                    linked = true;
                    continue;
                }
                kept.push(field);
            }
            if linked {
                self.replace_login_fields(
                    session,
                    &id,
                    &item.username,
                    &item.password,
                    &item.notes,
                    &kept,
                )?;
            }
        }
        Ok(())
    }

    /// Builds before 2026-10-17 kept another item's *id* in a "Sign in with" field. Each one that
    /// still names a live item of this vault becomes the item's `sign_in` link, and the field keeps
    /// the provider instead: a known one when the linked item's address or title says which
    /// (google.com → `google`), otherwise the linked item's title as the provider name. A field
    /// whose target is gone is left alone, like the related-item migration does.
    fn migrate_legacy_sign_in_fields(&mut self, session: &Session) -> Result<(), VaultError> {
        let mut statement = self
            .connection
            .prepare("SELECT id FROM items WHERE vault_id = ?1 AND trashed = 0")?;
        let ids = statement
            .query_map([&session.vault_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        for id in ids {
            let Some(item) = self.get_login_item(session, &id)? else {
                continue;
            };
            let mut fields = item.custom_fields.clone();
            let mut changed = false;
            for field in fields.iter_mut() {
                let target = field.value.trim().to_string();
                if field.field_type != SIGN_IN_WITH_FIELD
                    || target.is_empty()
                    || target == id
                    || Uuid::parse_str(&target).is_err()
                    || !self.linkable_item_exists(session, &target)?
                {
                    continue;
                }
                let Some(account) = self.get_login_item(session, &target)? else {
                    continue;
                };
                if self.relation_record(session, &id)?.sign_in.is_none() {
                    self.set_item_sign_in(session, &id, Some(&target))?;
                }
                field.value = sign_in_provider_for(&account)
                    .map(str::to_string)
                    .unwrap_or_else(|| account.title.trim().to_string());
                changed = true;
            }
            if changed {
                self.replace_login_fields(
                    session,
                    &id,
                    &item.username,
                    &item.password,
                    &item.notes,
                    &fields,
                )?;
            }
        }
        Ok(())
    }

    /// Sets how the item's tile is drawn: `auto` or `letter`.
    pub fn set_item_icon_mode(
        &mut self,
        session: &Session,
        item_id: &str,
        mode: &str,
    ) -> Result<(), VaultError> {
        if mode != ICON_MODE_AUTO && mode != ICON_MODE_LETTER {
            return Err(VaultError::InvalidIconMode);
        }
        let changed = self.connection.execute(
            "UPDATE items SET icon_mode = ?1 WHERE id = ?2 AND vault_id = ?3",
            params![mode, item_id, session.vault_id],
        )?;
        if changed == 0 {
            return Err(VaultError::VaultNotFound);
        }
        Ok(())
    }

    /// The cached icons for these sites, keyed by the site as asked. A site never fetched is left
    /// out of the map, which is how the caller knows to fetch it.
    pub fn cached_site_icons(
        &self,
        session: &Session,
        domains: &[String],
    ) -> Result<HashMap<String, CachedSiteIcon>, VaultError> {
        let now = Utc::now();
        let mut found = HashMap::new();
        for domain in domains {
            let row = self
                .connection
                .query_row(
                    "SELECT icon_ciphertext, fetched_at FROM site_icons WHERE domain_hash = ?1",
                    [site_icon_hash(&session.key, domain)],
                    |row| Ok((row.get::<_, Option<Vec<u8>>>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let Some((blob, fetched_at)) = row else {
                continue;
            };
            let icon = blob
                .map(|blob| decrypt_string_from_blob(&session.key, &blob))
                .transpose()?;
            let age_days = chrono::DateTime::parse_from_rfc3339(&fetched_at)
                .map(|at| (now - at.with_timezone(&Utc)).num_days())
                .unwrap_or(i64::MAX);
            let limit = if icon.is_some() { SITE_ICON_FRESH_DAYS } else { SITE_ICON_MISS_DAYS };
            found.insert(domain.clone(), CachedSiteIcon { fresh: age_days < limit, icon });
        }
        Ok(found)
    }

    /// Stores a fetched icon (a PNG) or, with `None`, remembers that the site had none.
    pub fn store_site_icon(
        &mut self,
        session: &Session,
        domain: &str,
        png: Option<&[u8]>,
    ) -> Result<Option<String>, VaultError> {
        let data_url = png.map(|png| format!("data:image/png;base64,{}", BASE64.encode(png)));
        let blob = data_url
            .as_deref()
            .map(|value| encrypt_string_to_blob(&session.key, value))
            .transpose()?;
        self.connection.execute(
            "INSERT INTO site_icons (domain_hash, icon_ciphertext, fetched_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(domain_hash) DO UPDATE SET
               icon_ciphertext = excluded.icon_ciphertext, fetched_at = excluded.fetched_at",
            params![site_icon_hash(&session.key, domain), blob, Utc::now().to_rfc3339()],
        )?;
        Ok(data_url)
    }

    /// Forgets every cached icon (the setting was turned off).
    pub fn clear_site_icons(&mut self) -> Result<(), VaultError> {
        self.connection.execute("DELETE FROM site_icons", [])?;
        Ok(())
    }

    // Test-only since the window reads summaries (`list_login_summaries`).
    #[cfg(test)]
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
        self.attach_relations(session, &mut items)?;
        Ok(items)
    }

    fn get_login_item(&self, session: &Session, id: &str) -> Result<Option<LoginItem>, VaultError> {
        let row = self
            .connection
            .query_row(
                "SELECT item_type, title_ciphertext, favorite, updated_at, icon_mode, created_at, use_count,
                        last_used_at
                 FROM items WHERE id = ?1 AND vault_id = ?2",
                params![id, session.vault_id],
                |row| {
                    Ok((
                        (
                            row.get::<_, String>(0)?,
                            row.get::<_, Vec<u8>>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                        ),
                        (row.get::<_, String>(5)?, row.get::<_, i64>(6)?, row.get::<_, Option<String>>(7)?),
                    ))
                },
            )
            .optional()?;

        let Some(((item_type, title_ciphertext, favorite, updated_at, icon_mode), (created_at, use_count, last_used_at))) =
            row
        else {
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
            created_at,
            use_count,
            last_used_at,
            vault_id: session.vault_id.clone(),
            relations: ItemRelations::default(),
            icon_mode,
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

/// Keyed blind index for the icon cache, separated from tag hashes by its prefix so the same
/// string can never collide across the two tables. Lowercased: a host name is case-insensitive.
fn site_icon_hash(key: &VaultKey, domain: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha1>::new_from_slice(key)
        .expect("a 32 byte vault key is always a valid HMAC key for sha1");
    mac.update(b"site-icon:");
    mac.update(domain.trim().to_lowercase().as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// Which known provider an account item belongs to, from its addresses first and its title second.
fn sign_in_provider_for(account: &LoginItem) -> Option<&'static str> {
    let hosts: Vec<String> = normalized_urls(&account.website, &account.urls)
        .iter()
        .filter_map(|url| host_of(&url.url))
        .collect();
    for (provider, domains) in SIGN_IN_PROVIDERS {
        let host_hit = hosts.iter().any(|host| {
            domains
                .iter()
                .any(|domain| host == domain || host.ends_with(&format!(".{domain}")))
        });
        if host_hit {
            return Some(provider);
        }
    }
    let title = account.title.to_lowercase();
    SIGN_IN_PROVIDERS
        .iter()
        .map(|(provider, _)| *provider)
        .find(|provider| *provider != "x" && title.contains(provider))
}

/// The provider a "Sign in with" field names, as the browser extension is told it: a known id
/// (`google`) or the name the user typed. `None` when the item has no such field.
pub fn sign_in_provider_of(item: &LoginItem) -> Option<String> {
    item.custom_fields
        .iter()
        .find(|field| field.field_type == SIGN_IN_WITH_FIELD && !field.value.trim().is_empty())
        .map(|field| field.value.trim().to_string())
        // A pre-migration value is another item's id, which the extension has no use for.
        .filter(|value| Uuid::parse_str(value).is_err())
}

const PASSKEY_ITEM_TYPE: &str = "passkey";

/// Where the extension's save prompt sends a passkey.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasskeyTarget {
    /// The first live login for the relying party, else a new login.
    Matching,
    /// The login the user picked in the prompt.
    Item(String),
    /// A new login, even when one for the site exists.
    NewItem,
}
const PASSKEY_NOTE: &str =
    "Passkey detected by the browser extension. The private key stays with the platform authenticator.";

fn passkey_field(rp_id: &str, user_name: &str) -> CustomField {
    CustomField {
        label: rp_id.to_string(),
        value: user_name.to_string(),
        field_type: PASSKEY_ITEM_TYPE.to_string(),
    }
}

/// A new key for the same account on the same relying party replaces the old one; other accounts keep theirs.
fn with_passkey_credential(mut fields: Vec<CustomField>, credential: Option<&StoredPasskey>) -> Vec<CustomField> {
    let Some(credential) = credential else {
        return fields;
    };
    fields.retain(|field| {
        StoredPasskey::from_field(field).map_or(true, |existing| {
            !(existing.rp_id.eq_ignore_ascii_case(&credential.rp_id)
                && (existing.user_handle == credential.user_handle
                    || existing.credential_id == credential.credential_id))
        })
    });
    fields.push(credential.to_field());
    fields
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
    site_match::MODE_DOMAIN.to_string()
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
            match_type: site_match::normalized_mode(&item_url.match_type).to_string(),
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
                        match_type: site_match::MODE_EXACT.into(),
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
                        match_type: site_match::MODE_DOMAIN.into(),
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
                        match_type: site_match::MODE_DOMAIN.into(),
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

        // `never` drops that address from matching, but another address of the same item still counts,
        // and the save path (which looks for the account to update) sees the item either way.
        let url = |url: &str, mode: &str| ItemUrl {
            label: String::new(),
            url: url.into(),
            match_type: mode.into(),
        };
        let never = service
            .create_login_item(
                &session,
                LoginItemInput {
                    urls: vec![url("https://example.org", site_match::MODE_NEVER)],
                    ..login_input("Never here", vec![])
                },
            )
            .expect("login should save");
        let mixed = service
            .create_login_item(
                &session,
                LoginItemInput {
                    urls: vec![
                        url("https://legacy.example.org", site_match::MODE_NEVER),
                        url("https://id.example.org", site_match::MODE_EXACT),
                    ],
                    ..login_input("Mixed", vec![])
                },
            )
            .expect("login should save");
        assert_eq!(
            mixed.urls.iter().map(|url| url.match_type.as_str()).collect::<Vec<_>>(),
            vec!["never", "exact"]
        );
        assert!(titles_for(&service, &session, "https://example.org").is_empty());
        assert_eq!(
            titles_for(&service, &session, "https://id.example.org"),
            vec![mixed.title.clone()]
        );
        let mut for_save = service
            .list_login_items_for_site(&session, "https://example.org/login")
            .expect("site should list")
            .into_iter()
            .map(|item| item.title)
            .collect::<Vec<_>>();
        for_save.sort();
        assert_eq!(for_save, vec![mixed.title, never.title]);

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
    fn all_spans_every_open_vault_and_tags_belong_to_all() {
        let path = test_database_path("vault-all");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let personal = service.setup_master_password("master-password").expect("setup");
        let work_vault = service.create_vault(&personal, "Work").expect("work vault");
        let work = service.session_for_vault(&personal, &work_vault.id).expect("work session");
        let mine = service.create_login_item(&personal, login_input("Mine", vec!["code".into()])).expect("mine");
        let theirs = service.create_login_item(&work, login_input("Theirs", vec!["code".into()])).expect("theirs");

        let all = service.list_all_login_items(&personal).expect("all items");
        assert_eq!(all.len(), 2);
        assert_eq!(all.iter().find(|item| item.id == theirs.id).unwrap().vault_id, work_vault.id);
        assert!(!all.iter().find(|item| item.id == mine.id).unwrap().created_at.is_empty());
        assert_eq!(service.list_all_tags(&personal).expect("all tags").len(), 1);

        // A rename reaches the tag in both vaults.
        service.update_tag_everywhere(&personal, "code", "dev", "key", "").expect("rename everywhere");
        assert_eq!(service.list_tags(&work).expect("work tags")[0].name, "dev");

        // Uses are counted without touching the modified date.
        service.record_item_use(&work, &theirs.id).expect("use");
        let used = service.list_login_items(&work, None).expect("work items").remove(0);
        assert_eq!(used.use_count, 1);
        assert!(used.last_used_at.is_some());
        assert_eq!(used.updated_at, theirs.updated_at);

        // An archived vault drops out of All.
        service.set_vault_archived(&personal, &work_vault.id, true).expect("archive work");
        assert_eq!(service.list_all_login_items(&personal).expect("all items").len(), 1);
    }

    #[test]
    fn the_browser_extension_reads_every_open_vault() {
        let path = test_database_path("vault-bridge-all");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let personal = service.setup_master_password("master-password").expect("setup");
        let work_vault = service.create_vault(&personal, "Work").expect("work vault");
        let work = service.session_for_vault(&personal, &work_vault.id).expect("work session");
        let theirs = service.create_login_item(&work, login_input("Theirs", vec![])).expect("theirs");

        // The open vault is Personal, yet the Work login fills and is the one a save updates.
        let matches = service
            .list_login_items_for_origin_everywhere(&personal, "https://example.com")
            .expect("matches");
        assert_eq!(matches.iter().map(|item| item.id.clone()).collect::<Vec<_>>(), vec![theirs.id.clone()]);
        let (vault, found) = service
            .find_site_login_everywhere(&personal, "https://example.com", "user@example.com")
            .expect("lookup")
            .expect("found in work");
        assert_eq!(found.id, theirs.id);
        assert_eq!(vault.vault_id, work_vault.id);

        // A passkey for the matching login lands in Work, not as a new Personal item.
        let saved = service
            .save_passkey_everywhere(&personal, true, "https://example.com", "example.com", "rei", &PasskeyTarget::Matching, None)
            .expect("passkey");
        assert_eq!(saved.id, theirs.id);
        assert!(service.list_login_items(&personal, None).expect("personal").is_empty());

        // An archived vault is out of reach.
        service.set_vault_archived(&personal, &work_vault.id, true).expect("archive work");
        assert!(service
            .list_login_items_for_origin_everywhere(&personal, "https://example.com")
            .expect("matches")
            .is_empty());
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
    fn updating_a_vault_renames_it_and_carries_its_icon_and_colour() {
        let path = test_database_path("vault-update");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let personal = service
            .setup_master_password("master-password")
            .expect("master password should setup");
        let work_vault = service
            .create_vault(&personal, "Work")
            .expect("work vault should create");
        service
            .create_login_item(&personal, login_input("Personal Mail", vec![]))
            .expect("personal item should create");

        service
            .update_vault(&personal, &work_vault.id, "  Team  ", "briefcase", "teal")
            .expect("vault should update");

        let vaults = service.list_vaults(&personal).expect("vaults should list");
        let team = vaults
            .iter()
            .find(|vault| vault.id == work_vault.id)
            .expect("the renamed vault is still the same row");
        assert_eq!(team.name, "Team");
        assert_eq!(team.icon, "briefcase");
        assert_eq!(team.color, "teal");

        // The name is the only encrypted column here, so re-encrypting it must not disturb what the
        // vault points at: the session still resolves and the other vault still reads.
        let team_session = service
            .session_for_vault(&personal, &work_vault.id)
            .expect("the renamed vault should still open");
        assert!(service
            .list_login_items(&team_session, None)
            .expect("team items should list")
            .is_empty());
        assert_eq!(
            service
                .list_login_items(&personal, None)
                .expect("personal items should list")
                .len(),
            1
        );

        assert!(matches!(
            service.update_vault(&personal, &work_vault.id, "   ", "tag", ""),
            Err(VaultError::VaultNameEmpty)
        ));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn archiving_a_vault_archives_its_items_without_claiming_the_ones_it_did_not_move() {
        let path = test_database_path("vault-archive");
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

        let kept = service
            .create_login_item(&work, login_input("Work SSO", vec![]))
            .expect("live item should create");
        let private = service
            .create_login_item(&work, login_input("Old Router", vec![]))
            .expect("second item should create");
        service
            .archive_item(&work, &private.id)
            .expect("item should archive on its own");

        service
            .set_vault_archived(&personal, &work_vault.id, true)
            .expect("vault should archive");

        assert!(service
            .list_login_items(&work, None)
            .expect("work live items should list")
            .is_empty());
        assert_eq!(
            service
                .list_archived_login_items(&work)
                .expect("work archived items should list")
                .len(),
            2
        );
        let vaults = service.list_vaults(&personal).expect("vaults should list");
        assert!(vaults
            .iter()
            .find(|vault| vault.id == work_vault.id)
            .expect("archived vault still lists")
            .archived);
        // A count of live items is what the sidebar row shows, so an archived vault reads as empty
        // rather than keeping the number it had before it was put away.
        assert_eq!(
            vaults
                .iter()
                .find(|vault| vault.id == work_vault.id)
                .map(|vault| vault.item_count)
                .expect("archived vault still counts"),
            0
        );

        service
            .set_vault_archived(&personal, &work_vault.id, false)
            .expect("vault should restore");

        assert_eq!(
            service
                .list_login_items(&work, None)
                .expect("work live items should list")
                .into_iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            vec![kept.id]
        );
        assert_eq!(
            service
                .list_archived_login_items(&work)
                .expect("work archived items should list")
                .into_iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            vec![private.id]
        );
        assert!(!service
            .list_vaults(&personal)
            .expect("vaults should list")
            .into_iter()
            .find(|vault| vault.id == work_vault.id)
            .expect("restored vault still lists")
            .archived);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn dissolving_a_vault_moves_every_item_and_takes_the_tag_styling_with_them() {
        let path = test_database_path("vault-dissolve");
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

        service
            .create_login_item(&work, login_input("Work SSO", vec!["shared".into()]))
            .expect("live item should create");
        let gone = service
            .create_login_item(&work, login_input("Old VPN", vec!["shared".into()]))
            .expect("trashed item should create");
        service
            .trash_item(&work, &gone.id)
            .expect("item should reach the trash");
        service
            .update_tag(&work, "shared", "shared", "key", "amber")
            .expect("tag should restyle");

        service
            .dissolve_vault(&personal, &work_vault.id, Some("personal"))
            .expect("vault should dissolve");

        assert_eq!(
            service
                .list_vaults(&personal)
                .expect("vaults should list")
                .into_iter()
                .map(|vault| vault.name)
                .collect::<Vec<_>>(),
            vec!["Personal"]
        );
        // Nothing is left behind, not even a row the user had thrown away: those would otherwise
        // disappear with the vault and nobody would ever see them again.
        assert_eq!(
            service
                .list_trashed_login_items(&personal)
                .expect("personal trash should list")
                .len(),
            1
        );
        let live = service
            .list_login_items(&personal, None)
            .expect("personal items should list");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].tags, vec!["shared"]);
        let shared = service
            .list_tags(&personal)
            .expect("personal tags should list")
            .into_iter()
            .find(|tag| tag.name == "shared")
            .expect("the tag followed its items");
        assert_eq!(shared.icon, "key");
        assert_eq!(shared.color, "amber");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn dissolving_a_vault_needs_a_destination_only_when_it_holds_something() {
        let path = test_database_path("vault-dissolve-rules");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let personal = service
            .setup_master_password("master-password")
            .expect("master password should setup");

        assert!(matches!(
            service.dissolve_vault(&personal, "personal", None),
            Err(VaultError::VaultLastOne)
        ));

        let empty_vault = service
            .create_vault(&personal, "Empty")
            .expect("empty vault should create");
        service
            .dissolve_vault(&personal, &empty_vault.id, None)
            .expect("an empty vault needs nowhere to send its items");
        assert_eq!(service.list_vaults(&personal).expect("vaults should list").len(), 1);

        let work_vault = service
            .create_vault(&personal, "Work")
            .expect("work vault should create");
        let work = service
            .session_for_vault(&personal, &work_vault.id)
            .expect("work session should switch");
        service
            .create_login_item(&work, login_input("Work SSO", vec![]))
            .expect("work item should create");

        assert!(matches!(
            service.dissolve_vault(&personal, &work_vault.id, None),
            Err(VaultError::VaultDestinationRequired)
        ));
        assert!(matches!(
            service.dissolve_vault(&personal, &work_vault.id, Some(&work_vault.id)),
            Err(VaultError::VaultDestinationRequired)
        ));
        assert_eq!(
            service
                .list_vaults(&personal)
                .expect("a refused dissolve leaves the vault alone")
                .len(),
            2
        );

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
    fn text_previews_decode_utf8_lossily_and_cut_on_a_character_boundary() {
        let plain = text_preview("notes.txt", "hello\nworld".as_bytes(), 1024);
        assert_eq!(plain.text, "hello\nworld");
        assert!(!plain.truncated && !plain.lossy);
        assert_eq!(plain.total_bytes, 11);

        let bom = text_preview("bom.txt", b"\xEF\xBB\xBFabc", 1024);
        assert_eq!(bom.text, "abc");

        let invalid = text_preview("latin1.txt", b"caf\xE9 au lait", 1024);
        assert_eq!(invalid.text, "caf\u{FFFD} au lait");
        assert!(invalid.lossy);

        // "密码" is two 3-byte characters; a 4-byte cut keeps the first whole and drops the split one.
        let cut = text_preview("zh.txt", "密码".as_bytes(), 4);
        assert_eq!(cut.text, "密");
        assert!(cut.truncated && !cut.lossy);
        assert_eq!(cut.total_bytes, 6);

        let ascii_cut = text_preview("long.txt", &[b'a'; 10], 4);
        assert_eq!(ascii_cut.text, "aaaa");
        assert!(ascii_cut.truncated);
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
    fn a_saved_passkey_goes_where_the_prompt_said() {
        let path = test_database_path("passkey-target");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");
        let input = |title: &str| LoginItemInput {
            item_type: "login".into(),
            title: title.into(),
            username: "alice".into(),
            password: "StrongPass123".into(),
            website: "https://example.com".into(),
            urls: vec![],
            notes: "".into(),
            tags: vec![],
            custom_fields: vec![],
            favorite: false,
        };
        let first = service.create_login_item(&session, input("First")).expect("first");
        let second = service.create_login_item(&session, input("Second")).expect("second");

        let picked = service
            .save_passkey(
                &session,
                true,
                "https://example.com",
                "example.com",
                "alice",
                &PasskeyTarget::Item(first.id.clone()),
                None,
            )
            .expect("passkey should save to the picked login");
        assert_eq!(picked.id, first.id);
        assert!(passkey_field_of(&picked).is_some());

        let fresh = service
            .save_passkey(
                &session,
                true,
                "https://example.com",
                "example.com",
                "alice",
                &PasskeyTarget::NewItem,
                None,
            )
            .expect("passkey should save to a new login");
        assert_ne!(fresh.id, first.id);
        assert_ne!(fresh.id, second.id);
        assert!(passkey_field_of(&fresh).is_some());

        let missing = service.save_passkey(
            &session,
            true,
            "https://example.com",
            "example.com",
            "alice",
            &PasskeyTarget::Item("no-such-item".into()),
            None,
        );
        assert!(matches!(missing, Err(VaultError::PasskeyItemNotFound)));

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

    fn relation_service(name: &str) -> (std::path::PathBuf, VaultService, Session) {
        let path = test_database_path(name);
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("master password should setup");
        (path, service, session)
    }

    fn create_titled(service: &mut VaultService, session: &Session, title: &str) -> String {
        service
            .create_login_item(session, login_input(title, vec![]))
            .expect("item should create")
            .id
    }

    fn listed_relations(service: &VaultService, session: &Session, id: &str) -> ItemRelations {
        service
            .list_login_items(session, None)
            .expect("items should list")
            .into_iter()
            .find(|item| item.id == id)
            .expect("item should be listed")
            .relations
    }

    fn ref_titles(refs: &[RelatedItemRef]) -> Vec<String> {
        refs.iter().map(|item| item.title.clone()).collect()
    }

    #[test]
    fn a_child_lists_its_parent_and_the_parent_lists_its_children() {
        let (path, mut service, session) = relation_service("relations-parent");
        let bank = create_titled(&mut service, &session, "Bank");
        let card = create_titled(&mut service, &session, "Credit card");
        let app = create_titled(&mut service, &session, "App login");

        service.set_item_parent(&session, &card, Some(&bank)).expect("parent should set");
        service.set_item_parent(&session, &app, Some(&bank)).expect("parent should set");

        let bank_relations = listed_relations(&service, &session, &bank);
        assert_eq!(bank_relations.parent, None);
        assert_eq!(ref_titles(&bank_relations.children), vec!["App login", "Credit card"]);
        let card_relations = listed_relations(&service, &session, &card);
        assert_eq!(card_relations.parent.map(|parent| parent.title), Some("Bank".to_string()));
        assert!(card_relations.children.is_empty());

        // One parent per item: setting another replaces it.
        service.set_item_parent(&session, &card, Some(&app)).expect("parent should move");
        assert_eq!(ref_titles(&listed_relations(&service, &session, &bank).children), vec!["App login"]);

        service.set_item_parent(&session, &card, None).expect("parent should clear");
        assert!(listed_relations(&service, &session, &card).is_empty());
        let stored: Option<Vec<u8>> = service
            .connection()
            .query_row("SELECT relations_ciphertext FROM items WHERE id = ?1", [&card], |row| {
                row.get(0)
            })
            .expect("row should read");
        assert_eq!(stored, None, "an item with no links goes back to NULL");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_parent_link_refuses_itself_and_any_cycle() {
        let (path, mut service, session) = relation_service("relations-cycle");
        let a = create_titled(&mut service, &session, "A");
        let b = create_titled(&mut service, &session, "B");
        let c = create_titled(&mut service, &session, "C");

        assert!(matches!(
            service.set_item_parent(&session, &a, Some(&a)),
            Err(VaultError::RelationSelf)
        ));
        service.set_item_parent(&session, &b, Some(&a)).expect("b under a");
        service.set_item_parent(&session, &c, Some(&b)).expect("c under b");
        assert!(matches!(
            service.set_item_parent(&session, &a, Some(&c)),
            Err(VaultError::RelationCycle)
        ));
        assert!(matches!(
            service.set_item_parent(&session, &a, Some(&b)),
            Err(VaultError::RelationCycle)
        ));
        assert!(matches!(
            service.set_item_parent(&session, &a, Some("missing")),
            Err(VaultError::RelationItemNotFound)
        ));
        assert_eq!(listed_relations(&service, &session, &a).parent, None);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_related_link_is_symmetric_and_unlinks_from_either_end() {
        let (path, mut service, session) = relation_service("relations-related");
        let server = create_titled(&mut service, &session, "Server");
        let database = create_titled(&mut service, &session, "Database");

        assert!(matches!(
            service.link_related_items(&session, &server, &server),
            Err(VaultError::RelationSelf)
        ));
        service.link_related_items(&session, &server, &database).expect("link");
        service.link_related_items(&session, &database, &server).expect("linking twice is harmless");

        assert_eq!(ref_titles(&listed_relations(&service, &session, &server).related), vec!["Database"]);
        assert_eq!(ref_titles(&listed_relations(&service, &session, &database).related), vec!["Server"]);

        service.unlink_related_items(&session, &database, &server).expect("unlink");
        assert!(listed_relations(&service, &session, &server).is_empty());
        assert!(listed_relations(&service, &session, &database).is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn relation_data_is_stored_encrypted() {
        let (path, mut service, session) = relation_service("relations-encrypted");
        let a = create_titled(&mut service, &session, "A");
        let b = create_titled(&mut service, &session, "B");
        service.link_related_items(&session, &a, &b).expect("link");

        let blob: Vec<u8> = service
            .connection()
            .query_row("SELECT relations_ciphertext FROM items WHERE id = ?1", [&a], |row| {
                row.get(0)
            })
            .expect("row should read");
        let haystack = String::from_utf8_lossy(&blob);
        assert!(!haystack.contains(&b), "the linked id must not be readable on disk");
        assert!(!haystack.contains("related"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_linked_item_cannot_be_deleted_or_moved_but_can_be_archived() {
        let (path, mut service, session) = relation_service("relations-guard");
        let parent = create_titled(&mut service, &session, "Parent");
        let child = create_titled(&mut service, &session, "Child");
        let peer = create_titled(&mut service, &session, "Peer");
        let loose = create_titled(&mut service, &session, "Loose");
        service.set_item_parent(&session, &child, Some(&parent)).expect("parent");
        service.link_related_items(&session, &parent, &peer).expect("link");
        let work = service.create_vault(&session, "Work").expect("vault should create");

        for id in [&parent, &child, &peer] {
            assert!(matches!(service.trash_item(&session, id), Err(VaultError::ItemHasRelations)));
            assert!(matches!(
                service.move_login_item(&session, id, &work.id),
                Err(VaultError::ItemRelationsBlockMove)
            ));
        }
        assert!(service.list_trashed_login_items(&session).expect("trash").is_empty());
        service.trash_item(&session, &loose).expect("an unlinked item still deletes");

        // Archiving keeps the links, and both ends show the archived state.
        service.archive_item(&session, &child).expect("archive should work");
        let parent_relations = listed_relations(&service, &session, &parent);
        assert_eq!(parent_relations.children.len(), 1);
        assert!(parent_relations.children[0].archived);
        let archived = service.list_archived_login_items(&session).expect("archived");
        assert_eq!(archived[0].relations.parent.as_ref().map(|item| item.id.clone()), Some(parent.clone()));
        assert!(matches!(service.trash_item(&session, &child), Err(VaultError::ItemHasRelations)));

        // Unlinking frees them again.
        service.set_item_parent(&session, &child, None).expect("unparent");
        service.unlink_related_items(&session, &peer, &parent).expect("unlink");
        service.trash_item(&session, &child).expect("child deletes once unlinked");
        service.trash_item(&session, &parent).expect("parent deletes once unlinked");
        service.purge_item(&session, &parent).expect("purge");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn trashed_items_cannot_be_linked_and_duplicates_start_unlinked() {
        let (path, mut service, session) = relation_service("relations-trash");
        let a = create_titled(&mut service, &session, "A");
        let b = create_titled(&mut service, &session, "B");
        let gone = create_titled(&mut service, &session, "Gone");
        service.trash_item(&session, &gone).expect("trash");
        assert!(matches!(
            service.link_related_items(&session, &a, &gone),
            Err(VaultError::RelationItemNotFound)
        ));
        assert!(matches!(
            service.set_item_parent(&session, &gone, Some(&a)),
            Err(VaultError::RelationItemNotFound)
        ));

        service.link_related_items(&session, &a, &b).expect("link");
        let copy = service.duplicate_login_item(&session, &a, "A copy").expect("duplicate");
        assert!(copy.relations.is_empty());
        assert!(listed_relations(&service, &session, &copy.id).is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unlock_turns_legacy_related_item_fields_into_links() {
        let (path, mut service, session) = relation_service("relations-legacy");
        let target = create_titled(&mut service, &session, "Target");
        let mut input = login_input("Source", vec![]);
        input.custom_fields = vec![
            CustomField {
                label: "Related item".into(),
                value: target.clone(),
                field_type: "related_item".into(),
            },
            CustomField {
                label: "Related item".into(),
                value: "no-such-item".into(),
                field_type: "related_item".into(),
            },
            CustomField { label: "PIN".into(), value: "1234".into(), field_type: "text".into() },
        ];
        let source = service.create_login_item(&session, input).expect("source").id;

        let session = service.unlock("master-password").expect("unlock should migrate");
        let items = service.list_login_items(&session, None).expect("items");
        let migrated = items.iter().find(|item| item.id == source).expect("source listed");
        assert_eq!(ref_titles(&migrated.relations.related), vec!["Target"]);
        assert_eq!(
            migrated.custom_fields.iter().map(|field| field.value.as_str()).collect::<Vec<_>>(),
            vec!["no-such-item", "1234"],
            "a field whose target is gone stays, and other fields are untouched"
        );
        assert_eq!(ref_titles(&listed_relations(&service, &session, &target).related), vec!["Source"]);

        service.unlock("master-password").expect("a second unlock changes nothing");
        assert_eq!(listed_relations(&service, &session, &target).related.len(), 1);

        let _ = std::fs::remove_file(path);
    }
    fn sign_in_field(value: &str) -> CustomField {
        CustomField { label: String::new(), value: value.into(), field_type: "sign_in_with".into() }
    }

    #[test]
    fn a_sign_in_account_is_a_link_both_ends_see_and_that_blocks_delete_and_move() {
        let (path, mut service, session) = relation_service("relations-sign-in");
        let google = create_titled(&mut service, &session, "Google");
        let mut input = login_input("Figma", vec![]);
        input.custom_fields = vec![sign_in_field("google")];
        let figma = service.create_login_item(&session, input).expect("figma").id;
        let notion = create_titled(&mut service, &session, "Notion");

        assert!(matches!(
            service.set_item_sign_in(&session, &figma, Some(&figma)),
            Err(VaultError::RelationSelf)
        ));
        assert!(matches!(
            service.set_item_sign_in(&session, &figma, Some("missing")),
            Err(VaultError::RelationItemNotFound)
        ));
        service.set_item_sign_in(&session, &figma, Some(&google)).expect("sign in should link");
        service.set_item_sign_in(&session, &notion, Some(&google)).expect("sign in should link");

        let figma_relations = listed_relations(&service, &session, &figma);
        assert_eq!(figma_relations.sign_in_with.map(|item| item.title), Some("Google".to_string()));
        assert_eq!(ref_titles(&listed_relations(&service, &session, &google).signs_in_to), vec!["Figma", "Notion"]);

        // Stored encrypted with the other links, never as a readable id.
        let blob: Vec<u8> = service
            .connection
            .query_row("SELECT relations_ciphertext FROM items WHERE id = ?1", [&figma], |row| row.get(0))
            .expect("record");
        assert!(!String::from_utf8_lossy(&blob).contains(&google));

        let work = service.create_vault(&session, "Work").expect("vault should create");
        for id in [&figma, &google] {
            assert!(matches!(service.trash_item(&session, id), Err(VaultError::ItemHasRelations)));
            assert!(matches!(
                service.move_login_item(&session, id, &work.id),
                Err(VaultError::ItemRelationsBlockMove)
            ));
        }

        // The bridge sees the provider through the field and nothing about the linked account.
        let bridged = service.list_live_items(&session, None).expect("live");
        let bridged_figma = bridged.iter().find(|item| item.id == figma).expect("figma");
        assert_eq!(sign_in_provider_of(bridged_figma), Some("google".to_string()));
        assert!(bridged_figma.relations.is_empty());

        service.set_item_sign_in(&session, &figma, None).expect("clear");
        service.set_item_sign_in(&session, &notion, None).expect("clear");
        assert!(listed_relations(&service, &session, &google).is_empty());
        service.trash_item(&session, &google).expect("free once nothing signs in with it");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unlock_turns_legacy_sign_in_item_ids_into_a_provider_and_a_link() {
        let (path, mut service, session) = relation_service("relations-sign-in-legacy");
        let mut google_input = login_input("My account", vec![]);
        google_input.website = "https://accounts.google.com".into();
        let google = service.create_login_item(&session, google_input).expect("google").id;
        let okta = create_titled(&mut service, &session, "Company Okta");
        let gone = Uuid::new_v4().to_string();

        let mut input = login_input("Figma", vec![]);
        input.custom_fields = vec![sign_in_field(&google)];
        let figma = service.create_login_item(&session, input).expect("figma").id;
        let mut input = login_input("Wiki", vec![]);
        input.custom_fields = vec![sign_in_field(&okta)];
        let wiki = service.create_login_item(&session, input).expect("wiki").id;
        let mut input = login_input("Old", vec![]);
        input.custom_fields = vec![sign_in_field(&gone), sign_in_field("github")];
        let old = service.create_login_item(&session, input).expect("old").id;

        let session = service.unlock("master-password").expect("unlock should migrate");
        let items = service.list_login_items(&session, None).expect("items");
        let find = |id: &str| items.iter().find(|item| item.id == id).expect("listed").clone();

        let figma_item = find(&figma);
        assert_eq!(figma_item.custom_fields, vec![sign_in_field("google")]);
        assert_eq!(figma_item.relations.sign_in_with.map(|item| item.id), Some(google.clone()));
        let wiki_item = find(&wiki);
        assert_eq!(wiki_item.custom_fields, vec![sign_in_field("Company Okta")]);
        assert_eq!(wiki_item.relations.sign_in_with.map(|item| item.id), Some(okta.clone()));
        let old_item = find(&old);
        assert_eq!(old_item.custom_fields, vec![sign_in_field(&gone), sign_in_field("github")]);
        assert!(old_item.relations.is_empty());
        assert_eq!(sign_in_provider_of(&old_item), None, "a dangling id is not a provider");

        service.unlock("master-password").expect("a second unlock changes nothing");
        assert_eq!(ref_titles(&listed_relations(&service, &session, &google).signs_in_to), vec!["Figma"]);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn site_icons_are_cached_by_a_keyed_hash_and_encrypted() {
        let (path, mut service, session) = relation_service("site-icons");
        let domains = vec!["github.com".to_string(), "nothing.example".to_string(), "new.example".to_string()];
        let png = b"\x89PNG fake bytes";
        let stored = service.store_site_icon(&session, "GitHub.com", Some(png)).expect("store");
        assert_eq!(stored, Some(format!("data:image/png;base64,{}", BASE64.encode(png))));
        service.store_site_icon(&session, "nothing.example", None).expect("store miss");

        let cached = service.cached_site_icons(&session, &domains).expect("cache");
        assert_eq!(cached.get("github.com"), Some(&CachedSiteIcon { icon: stored.clone(), fresh: true }));
        assert_eq!(cached.get("nothing.example"), Some(&CachedSiteIcon { icon: None, fresh: true }));
        assert!(!cached.contains_key("new.example"), "never fetched means absent");

        // Neither the site name nor the icon is readable in the file.
        let rows: Vec<(Vec<u8>, Option<Vec<u8>>)> = service
            .connection
            .prepare("SELECT domain_hash, icon_ciphertext FROM site_icons")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows.len(), 2);
        for (hash, icon) in &rows {
            assert!(!String::from_utf8_lossy(hash).contains("github"));
            if let Some(icon) = icon {
                assert!(!String::from_utf8_lossy(icon).contains("base64,"));
            }
        }

        // An old entry is still shown but marked stale, so the app asks the site again.
        service
            .connection
            .execute("UPDATE site_icons SET fetched_at = '2020-01-01T00:00:00+00:00'", [])
            .unwrap();
        let stale = service.cached_site_icons(&session, &domains).expect("cache");
        assert_eq!(stale.get("github.com").map(|icon| icon.fresh), Some(false));
        assert!(stale.get("github.com").and_then(|icon| icon.icon.clone()).is_some());

        service.clear_site_icons().expect("clear");
        assert!(service.cached_site_icons(&session, &domains).expect("cache").is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn an_item_can_keep_its_letter_tile_and_a_duplicate_keeps_the_choice() {
        let (path, mut service, session) = relation_service("icon-mode");
        let id = create_titled(&mut service, &session, "Bank");
        let listed = |service: &VaultService| {
            service.list_login_items(&session, None).unwrap().into_iter().find(|item| item.id == id).unwrap()
        };
        assert_eq!(listed(&service).icon_mode, "auto");
        assert!(!serde_json::to_string(&listed(&service)).unwrap().contains("icon_mode"));

        service.set_item_icon_mode(&session, &id, "letter").expect("letter");
        assert_eq!(listed(&service).icon_mode, "letter");
        assert!(matches!(
            service.set_item_icon_mode(&session, &id, "emoji"),
            Err(VaultError::InvalidIconMode)
        ));
        let copy = service.duplicate_login_item(&session, &id, "Bank copy").expect("duplicate");
        assert_eq!(copy.icon_mode, "letter");

        let _ = std::fs::remove_file(path);
    }

    fn summary_input(title: &str, username: &str, custom_fields: Vec<CustomField>, tags: &[&str]) -> LoginItemInput {
        LoginItemInput {
            item_type: "login".into(),
            title: title.into(),
            username: username.into(),
            password: format!("{title}-secret-password"),
            website: String::new(),
            urls: vec![
                ItemUrl {
                    label: "first".into(),
                    url: format!("https://{}.example.com/login", title.to_lowercase()),
                    match_type: "domain".into(),
                },
                ItemUrl {
                    label: "second".into(),
                    url: "https://second.example.org".into(),
                    match_type: "exact".into(),
                },
            ],
            notes: format!("{title} private notes"),
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            custom_fields,
            favorite: false,
        }
    }

    #[test]
    fn summaries_carry_the_row_fields_and_never_a_secret() {
        let path = test_database_path("vault-summaries");
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service.setup_master_password("master-password").expect("setup");

        let account = service
            .create_login_item(&session, summary_input("Google", "me@gmail.com", vec![], &["Work", "mail"]))
            .expect("account");
        let user = service
            .create_login_item(
                &session,
                summary_input(
                    "Figma",
                    "",
                    vec![
                        CustomField {
                            label: String::new(),
                            value: "google".into(),
                            field_type: SIGN_IN_WITH_FIELD.into(),
                        },
                        CustomField {
                            label: "recovery".into(),
                            value: "concealed-recovery-code".into(),
                            field_type: "concealed".into(),
                        },
                    ],
                    &["work"],
                ),
            )
            .expect("user");
        let child = service
            .create_login_item(&session, summary_input("Child", "kid", vec![], &[]))
            .expect("child");
        let loose = service
            .create_login_item(&session, summary_input("Loose", "solo", vec![], &[]))
            .expect("loose");
        let archived = service
            .create_login_item(&session, summary_input("Parked", "old", vec![], &[]))
            .expect("archived");
        let trashed = service
            .create_login_item(&session, summary_input("Binned", "gone", vec![], &[]))
            .expect("trashed");
        service.set_item_sign_in(&session, &user.id, Some(&account.id)).expect("sign in link");
        service.set_item_parent(&session, &child.id, Some(&account.id)).expect("parent link");
        service.archive_item(&session, &archived.id).expect("archive");
        service.trash_item(&session, &trashed.id).expect("trash");

        let summaries = service.list_login_summaries(&session, None).expect("summaries");
        let full = service.list_login_items(&session, None).expect("full list");
        assert_eq!(
            summaries.iter().map(|summary| &summary.id).collect::<Vec<_>>(),
            full.iter().map(|item| &item.id).collect::<Vec<_>>(),
            "same items in the same order as the full list"
        );
        for item in &full {
            let summary = summaries.iter().find(|summary| summary.id == item.id).expect("summary");
            assert_eq!(summary.title, item.title);
            assert_eq!(summary.username, item.username);
            assert_eq!(summary.website, item.website);
            assert_eq!(summary.tags, item.tags);
            assert_eq!(summary.vault_id, item.vault_id);
            assert_eq!(summary.updated_at, item.updated_at);
            assert_eq!(summary.created_at, item.created_at);
            assert_eq!(summary.has_relations, !item.relations.is_empty(), "{}", item.title);
            assert_eq!(
                summary.parent_id.as_deref(),
                item.relations.parent.as_ref().map(|parent| parent.id.as_str())
            );
        }
        let by_id = |id: &str| summaries.iter().find(|summary| summary.id == id).expect("summary");
        assert_eq!(by_id(&user.id).sign_in_with.as_deref(), Some("google"));
        assert_eq!(by_id(&account.id).sign_in_with, None);
        assert_eq!(by_id(&child.id).parent_id.as_deref(), Some(account.id.as_str()));
        assert!(by_id(&account.id).has_relations && by_id(&user.id).has_relations);
        assert!(!by_id(&loose.id).has_relations);

        let json = serde_json::to_string(&summaries).expect("json");
        for secret in ["secret-password", "private notes", "concealed-recovery-code", "second.example.org", "recovery"] {
            assert!(!json.contains(secret), "summary payload leaks {secret}");
        }

        // A query still searches every decrypted value, in Rust, and answers with summaries.
        let hits = service.list_login_summaries(&session, Some("RECOVERY-code")).expect("search");
        assert_eq!(hits.iter().map(|hit| hit.id.as_str()).collect::<Vec<_>>(), vec![user.id.as_str()]);
        assert!(hits[0].has_relations);

        let archived_rows = service.list_archived_login_summaries(&session).expect("archived");
        assert_eq!(archived_rows.len(), 1);
        assert_eq!(archived_rows[0].title, "Parked");
        let trashed_rows = service.list_trashed_login_summaries(&session).expect("trashed");
        assert_eq!(trashed_rows.len(), 1);
        assert_eq!(trashed_rows[0].username, "gone");
        assert_eq!(service.list_all_login_summaries(&session).expect("all").len(), full.len());

        let detail = service.login_item_detail(&session, &user.id).expect("detail");
        assert_eq!(detail.password, "Figma-secret-password");
        assert_eq!(detail.urls.len(), 2);
        assert_eq!(detail.relations.sign_in_with.as_ref().map(|account| account.id.as_str()), Some(account.id.as_str()));
        assert!(matches!(
            service.login_item_detail(&session, "missing"),
            Err(VaultError::ItemNotFound)
        ));

        let _ = std::fs::remove_file(path);
    }
}
