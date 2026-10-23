//! The logical records that sync: what a vault, a tag and an item *are*, in plaintext, independent of
//! how one device's SQLite file encrypts them. Remote state carries these (encrypted as a whole under
//! the sync key); each device re-encrypts them under its own vault key on apply.
//!
//! Left out on purpose: `use_count` / `last_used_at` (per-device usage stats that never touch
//! `updated_at`), the website-icon cache, `settings`, `audit_events` and field row ids (regenerated
//! on every save, so they would churn).

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Record {
    Vault(VaultRecord),
    Tag(TagRecord),
    Item(ItemRecord),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct VaultRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct TagRecord {
    pub vault_id: String,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct FieldRecord {
    pub key: String,
    pub field_type: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct UrlRecord {
    #[serde(default)]
    pub label: Option<String>,
    pub url: String,
    #[serde(default)]
    pub match_type: String,
}

/// Attachment metadata; the content travels as its own immutable blob (`blobs/<id>.bin`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AttachmentRecord {
    pub id: String,
    pub file_name: String,
    pub byte_count: i64,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ItemRecord {
    pub id: String,
    pub vault_id: String,
    pub item_type: String,
    pub title: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub archived_by_vault: bool,
    #[serde(default)]
    pub trashed: bool,
    #[serde(default)]
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// The decrypted relation JSON (`{parent, related, sign_in}`), kept verbatim.
    #[serde(default)]
    pub relations: Option<String>,
    #[serde(default)]
    pub icon_mode: String,
    #[serde(default)]
    pub fields: Vec<FieldRecord>,
    #[serde(default)]
    pub urls: Vec<UrlRecord>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<AttachmentRecord>,
}

pub fn vault_key(id: &str) -> String {
    format!("vault:{id}")
}

/// Tags have no stable id across devices (each device mints its own row id), so they are keyed by
/// vault and case-folded name — the same identity `UNIQUE (vault_id, name_hash)` enforces locally.
pub fn tag_key(vault_id: &str, name: &str) -> String {
    format!("tag:{vault_id}:{}", name.to_lowercase())
}

pub fn item_key(id: &str) -> String {
    format!("item:{id}")
}

impl Record {
    pub fn key(&self) -> String {
        match self {
            Record::Vault(vault) => vault_key(&vault.id),
            Record::Tag(tag) => tag_key(&tag.vault_id, &tag.name),
            Record::Item(item) => item_key(&item.id),
        }
    }

    pub fn updated_at(&self) -> &str {
        match self {
            Record::Vault(vault) => &vault.updated_at,
            Record::Tag(tag) => &tag.updated_at,
            Record::Item(item) => &item.updated_at,
        }
    }

    /// Apply order: vaults before tags before items (rows reference each other that way).
    pub fn rank(&self) -> u8 {
        match self {
            Record::Vault(_) => 0,
            Record::Tag(_) => 1,
            Record::Item(_) => 2,
        }
    }
}

pub fn key_rank(key: &str) -> u8 {
    if key.starts_with("vault:") {
        0
    } else if key.starts_with("tag:") {
        1
    } else {
        2
    }
}
