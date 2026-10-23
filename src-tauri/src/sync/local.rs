//! The local side of sync: read the vault's rows into plaintext [`Record`]s, write merged records
//! back (re-encrypted under this device's vault key), and keep the per-device sync bookkeeping
//! (`sync_base`, the encrypted `sync_config` settings row).
//!
//! Works on the raw tables rather than through `VaultService`, because sync must write rows with
//! *given* ids and timestamps, which none of the user-facing operations do.

use super::error::{SyncError, SyncResult};
use super::merge::{BaseEntry, LocalOp, LocalRecord};
use super::records::{
    AttachmentRecord, FieldRecord, ItemRecord, Record, TagRecord,
    UrlRecord, VaultRecord,
};
use crate::crypto::{decrypt_string_from_blob, encrypt_string_to_blob, VaultKey};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::Sha256;
use std::collections::{BTreeMap, HashMap, HashSet};
use uuid::Uuid;

const DEFAULT_VAULT_ID: &str = "personal";

pub fn ensure_tables(conn: &Connection) -> SyncResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_base (
            key_hash TEXT PRIMARY KEY NOT NULL,
            hash TEXT NOT NULL,
            modified TEXT NOT NULL
        );",
    )?;
    Ok(())
}

fn hmac_hex(key: &VaultKey, domain: &str, data: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("32-byte key is a valid HMAC key");
    mac.update(domain.as_bytes());
    mac.update(data);
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Keyed content hash: equality of two records without the file holding a plaintext digest
/// anyone could dictionary-attack.
pub fn record_hash(key: &VaultKey, record: &Record) -> String {
    let json = serde_json::to_vec(record).expect("records always serialize");
    hmac_hex(key, "mimatory-sync-record:", &json)
}

/// `sync_base` is keyed by a keyed hash of the record key, because a tag's key contains its name.
fn base_key_hash(key: &VaultKey, record_key: &str) -> String {
    hmac_hex(key, "mimatory-sync-key:", record_key.as_bytes())
}

fn decrypt(key: &VaultKey, blob: &[u8]) -> SyncResult<String> {
    decrypt_string_from_blob(key, blob).map_err(|_| SyncError::Local("decrypt".to_string()))
}

fn encrypt(key: &VaultKey, value: &str) -> SyncResult<Vec<u8>> {
    encrypt_string_to_blob(key, value).map_err(|_| SyncError::Local("encrypt".to_string()))
}

pub fn local_salt(conn: &Connection) -> SyncResult<Vec<u8>> {
    let salt: String = conn
        .query_row("SELECT value FROM meta WHERE key = 'master_salt'", [], |row| row.get(0))
        .optional()?
        .ok_or(SyncError::Locked)?;
    BASE64.decode(salt).map_err(|_| SyncError::Local("salt".to_string()))
}

// ---------------------------------------------------------------- reading

fn read_vault(conn: &Connection, key: &VaultKey, id: &str) -> SyncResult<Option<VaultRecord>> {
    let row = conn
        .query_row(
            "SELECT name_ciphertext, icon, color, archived, created_at, updated_at
             FROM vaults WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((name, icon, color, archived, created_at, updated_at)) = row else {
        return Ok(None);
    };
    Ok(Some(VaultRecord {
        id: id.to_string(),
        name: decrypt(key, &name)?,
        icon,
        color,
        archived: archived != 0,
        created_at,
        updated_at,
    }))
}

fn read_tags(conn: &Connection, key: &VaultKey) -> SyncResult<Vec<TagRecord>> {
    let mut statement = conn.prepare(
        "SELECT vault_id, name_ciphertext, icon, color, created_at, updated_at FROM tags",
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
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(vault_id, name, icon, color, created_at, updated_at)| {
            Ok(TagRecord { vault_id, name: decrypt(key, &name)?, icon, color, created_at, updated_at })
        })
        .collect()
}

fn read_tag(conn: &Connection, key: &VaultKey, vault_id: &str, name: &str) -> SyncResult<Option<TagRecord>> {
    let hash = crate::vault::tag_name_hash(key, name);
    let row = conn
        .query_row(
            "SELECT name_ciphertext, icon, color, created_at, updated_at FROM tags
             WHERE vault_id = ?1 AND name_hash = ?2",
            params![vault_id, hash],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((name, icon, color, created_at, updated_at)) = row else {
        return Ok(None);
    };
    Ok(Some(TagRecord {
        vault_id: vault_id.to_string(),
        name: decrypt(key, &name)?,
        icon,
        color,
        created_at,
        updated_at,
    }))
}

pub fn read_item(conn: &Connection, key: &VaultKey, id: &str) -> SyncResult<Option<ItemRecord>> {
    let row = conn
        .query_row(
            "SELECT vault_id, item_type, title_ciphertext, favorite, archived, archived_by_vault,
                    trashed, deleted_at, created_at, updated_at, relations_ciphertext, icon_mode
             FROM items WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<Vec<u8>>>(10)?,
                    row.get::<_, String>(11)?,
                ))
            },
        )
        .optional()?;
    let Some((
        vault_id,
        item_type,
        title,
        favorite,
        archived,
        archived_by_vault,
        trashed,
        deleted_at,
        created_at,
        updated_at,
        relations,
        icon_mode,
    )) = row
    else {
        return Ok(None);
    };

    let mut statement = conn.prepare(
        "SELECT field_key, field_type, value_ciphertext FROM item_fields
         WHERE item_id = ?1 ORDER BY position, rowid",
    )?;
    let fields = statement
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Vec<u8>>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(field_key, field_type, value)| {
            Ok(FieldRecord { key: field_key, field_type, value: decrypt(key, &value)? })
        })
        .collect::<SyncResult<Vec<_>>>()?;

    let mut statement = conn.prepare(
        "SELECT label_ciphertext, url_ciphertext, match_type FROM item_urls
         WHERE item_id = ?1 ORDER BY position, rowid",
    )?;
    let urls = statement
        .query_map([id], |row| {
            Ok((
                row.get::<_, Option<Vec<u8>>>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(label, url, match_type)| {
            Ok(UrlRecord {
                label: label.map(|label| decrypt(key, &label)).transpose()?,
                url: decrypt(key, &url)?,
                match_type,
            })
        })
        .collect::<SyncResult<Vec<_>>>()?;

    let mut statement = conn.prepare(
        "SELECT tags.name_ciphertext FROM item_tags JOIN tags ON tags.id = item_tags.tag_id
         WHERE item_tags.item_id = ?1 ORDER BY item_tags.position, tags.rowid",
    )?;
    let tags = statement
        .query_map([id], |row| row.get::<_, Vec<u8>>(0))?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|name| decrypt(key, &name))
        .collect::<SyncResult<Vec<_>>>()?;

    let mut statement = conn.prepare(
        "SELECT id, file_name_ciphertext, byte_count, created_at FROM attachments
         WHERE item_id = ?1 ORDER BY created_at, id",
    )?;
    let attachments = statement
        .query_map([id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(attachment_id, file_name, byte_count, created_at)| {
            Ok(AttachmentRecord {
                id: attachment_id,
                file_name: decrypt(key, &file_name)?,
                byte_count,
                created_at,
            })
        })
        .collect::<SyncResult<Vec<_>>>()?;

    Ok(Some(ItemRecord {
        id: id.to_string(),
        vault_id,
        item_type,
        title: decrypt(key, &title)?,
        favorite: favorite != 0,
        archived: archived != 0,
        archived_by_vault: archived_by_vault != 0,
        trashed: trashed != 0,
        deleted_at,
        created_at,
        updated_at,
        relations: relations.map(|blob| decrypt(key, &blob)).transpose()?,
        icon_mode,
        fields,
        urls,
        tags,
        attachments,
    }))
}

/// The current local record for one key, or `None` when it does not exist.
pub fn read_record(conn: &Connection, key: &VaultKey, record_key: &str) -> SyncResult<Option<Record>> {
    if let Some(id) = record_key.strip_prefix("vault:") {
        return Ok(read_vault(conn, key, id)?.map(Record::Vault));
    }
    if let Some(rest) = record_key.strip_prefix("tag:") {
        let Some((vault_id, name)) = rest.split_once(':') else {
            return Ok(None);
        };
        return Ok(read_tag(conn, key, vault_id, name)?.map(Record::Tag));
    }
    if let Some(id) = record_key.strip_prefix("item:") {
        return Ok(read_item(conn, key, id)?.map(Record::Item));
    }
    Ok(None)
}

/// Every syncable record in the vault file (all vaults, archived and trashed items included).
pub fn snapshot(conn: &Connection, key: &VaultKey) -> SyncResult<BTreeMap<String, LocalRecord>> {
    let mut out = BTreeMap::new();
    let mut push = |record: Record| {
        let hash = record_hash(key, &record);
        out.insert(record.key(), LocalRecord { record, hash });
    };

    let vault_ids = conn
        .prepare("SELECT id FROM vaults")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in vault_ids {
        if let Some(vault) = read_vault(conn, key, &id)? {
            push(Record::Vault(vault));
        }
    }
    for tag in read_tags(conn, key)? {
        push(Record::Tag(tag));
    }
    let item_ids = conn
        .prepare("SELECT id FROM items")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in item_ids {
        if let Some(item) = read_item(conn, key, &id)? {
            push(Record::Item(item));
        }
    }
    Ok(out)
}

/// Decrypted bytes of one attachment, for upload.
pub fn attachment_bytes(conn: &Connection, key: &VaultKey, attachment_id: &str) -> SyncResult<Option<Vec<u8>>> {
    let blob = conn
        .query_row(
            "SELECT content_ciphertext FROM attachments WHERE id = ?1",
            [attachment_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?;
    let Some(blob) = blob else { return Ok(None) };
    let encoded = decrypt(key, &blob)?;
    BASE64
        .decode(encoded)
        .map(Some)
        .map_err(|_| SyncError::Local("attachment payload".to_string()))
}

pub fn has_attachment(conn: &Connection, attachment_id: &str) -> SyncResult<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM attachments WHERE id = ?1", [attachment_id], |_| Ok(()))
        .optional()?
        .is_some())
}

// ---------------------------------------------------------------- base

/// The base for the given record keys (entries for other keys are irrelevant to this merge).
pub fn load_base<'a>(
    conn: &Connection,
    key: &VaultKey,
    record_keys: impl IntoIterator<Item = &'a String>,
) -> SyncResult<BTreeMap<String, BaseEntry>> {
    ensure_tables(conn)?;
    let mut statement = conn.prepare("SELECT key_hash, hash, modified FROM sync_base")?;
    let stored: HashMap<String, BaseEntry> = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, BaseEntry { hash: row.get(1)?, modified: row.get(2)? }))
        })?
        .collect::<Result<_, _>>()?;
    let mut out = BTreeMap::new();
    for record_key in record_keys {
        if let Some(entry) = stored.get(&base_key_hash(key, record_key)) {
            out.insert(record_key.clone(), entry.clone());
        }
    }
    Ok(out)
}

pub fn replace_base(conn: &Connection, key: &VaultKey, base: &BTreeMap<String, BaseEntry>) -> SyncResult<()> {
    ensure_tables(conn)?;
    conn.execute("DELETE FROM sync_base", [])?;
    let mut statement =
        conn.prepare("INSERT INTO sync_base (key_hash, hash, modified) VALUES (?1, ?2, ?3)")?;
    for (record_key, entry) in base {
        statement.execute(params![base_key_hash(key, record_key), entry.hash, entry.modified])?;
    }
    Ok(())
}

pub fn clear_base(conn: &Connection) -> SyncResult<()> {
    ensure_tables(conn)?;
    conn.execute("DELETE FROM sync_base", [])?;
    Ok(())
}

// ---------------------------------------------------------------- writing

fn ensure_vault_exists(conn: &Connection, key: &VaultKey, vault_id: &str) -> SyncResult<String> {
    let exists = conn
        .query_row("SELECT 1 FROM vaults WHERE id = ?1", [vault_id], |_| Ok(()))
        .optional()?
        .is_some();
    if exists {
        return Ok(vault_id.to_string());
    }
    // The item's vault was dissolved elsewhere while this item was edited: keep the item, in the
    // default vault (re-created if needed). The next sync pushes the move.
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO vaults (id, name_ciphertext, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(id) DO NOTHING",
        params![DEFAULT_VAULT_ID, encrypt(key, "Personal")?, now],
    )?;
    Ok(DEFAULT_VAULT_ID.to_string())
}

fn upsert_vault(conn: &Connection, key: &VaultKey, vault: &VaultRecord) -> SyncResult<()> {
    conn.execute(
        "INSERT INTO vaults (id, name_ciphertext, created_at, updated_at, icon, color, archived)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET name_ciphertext = excluded.name_ciphertext,
           created_at = excluded.created_at, updated_at = excluded.updated_at,
           icon = excluded.icon, color = excluded.color, archived = excluded.archived",
        params![
            vault.id,
            encrypt(key, &vault.name)?,
            vault.created_at,
            vault.updated_at,
            if vault.icon.is_empty() { "vault" } else { &vault.icon },
            vault.color,
            vault.archived as i64,
        ],
    )?;
    Ok(())
}

/// Finds or creates the tag row; returns its id.
fn tag_row(conn: &Connection, key: &VaultKey, vault_id: &str, name: &str) -> SyncResult<String> {
    let hash = crate::vault::tag_name_hash(key, name);
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM tags WHERE vault_id = ?1 AND name_hash = ?2",
            params![vault_id, hash],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO tags (id, vault_id, name_ciphertext, name_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, vault_id, encrypt(key, name)?, hash, now],
    )?;
    Ok(id)
}

fn upsert_tag(conn: &Connection, key: &VaultKey, tag: &TagRecord) -> SyncResult<bool> {
    let vault_exists = conn
        .query_row("SELECT 1 FROM vaults WHERE id = ?1", [&tag.vault_id], |_| Ok(()))
        .optional()?
        .is_some();
    if !vault_exists {
        return Ok(false);
    }
    let id = tag_row(conn, key, &tag.vault_id, &tag.name)?;
    conn.execute(
        "UPDATE tags SET name_ciphertext = ?1, icon = ?2, color = ?3, created_at = ?4, updated_at = ?5
         WHERE id = ?6",
        params![
            encrypt(key, &tag.name)?,
            if tag.icon.is_empty() { "tag" } else { &tag.icon },
            tag.color,
            tag.created_at,
            tag.updated_at,
            id
        ],
    )?;
    Ok(true)
}

fn upsert_item(
    conn: &Connection,
    key: &VaultKey,
    item: &ItemRecord,
    blobs: &HashMap<String, Vec<u8>>,
) -> SyncResult<()> {
    let vault_id = ensure_vault_exists(conn, key, &item.vault_id)?;
    conn.execute(
        "INSERT INTO items (id, vault_id, item_type, title_ciphertext, favorite, archived, trashed,
                            deleted_at, created_at, updated_at, archived_by_vault,
                            relations_ciphertext, icon_mode)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET vault_id = excluded.vault_id, item_type = excluded.item_type,
           title_ciphertext = excluded.title_ciphertext, favorite = excluded.favorite,
           archived = excluded.archived, trashed = excluded.trashed, deleted_at = excluded.deleted_at,
           created_at = excluded.created_at, updated_at = excluded.updated_at,
           archived_by_vault = excluded.archived_by_vault,
           relations_ciphertext = excluded.relations_ciphertext, icon_mode = excluded.icon_mode",
        params![
            item.id,
            vault_id,
            item.item_type,
            encrypt(key, &item.title)?,
            item.favorite as i64,
            item.archived as i64,
            item.trashed as i64,
            item.deleted_at,
            item.created_at,
            item.updated_at,
            item.archived_by_vault as i64,
            item.relations.as_deref().map(|r| encrypt(key, r)).transpose()?,
            if item.icon_mode.is_empty() { "auto" } else { &item.icon_mode },
        ],
    )?;

    conn.execute("DELETE FROM item_fields WHERE item_id = ?1", [&item.id])?;
    for (position, field) in item.fields.iter().enumerate() {
        conn.execute(
            "INSERT INTO item_fields (id, item_id, field_key, field_type, value_ciphertext, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                item.id,
                field.key,
                field.field_type,
                encrypt(key, &field.value)?,
                position as i64
            ],
        )?;
    }

    conn.execute("DELETE FROM item_urls WHERE item_id = ?1", [&item.id])?;
    for (position, url) in item.urls.iter().enumerate() {
        conn.execute(
            "INSERT INTO item_urls (id, item_id, label_ciphertext, url_ciphertext, match_type, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                item.id,
                url.label.as_deref().map(|l| encrypt(key, l)).transpose()?,
                encrypt(key, &url.url)?,
                if url.match_type.is_empty() { "domain" } else { &url.match_type },
                position as i64
            ],
        )?;
    }

    conn.execute("DELETE FROM item_tags WHERE item_id = ?1", [&item.id])?;
    let mut seen = HashSet::new();
    for (position, name) in item.tags.iter().enumerate() {
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        let tag_id = tag_row(conn, key, &vault_id, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag_id, position) VALUES (?1, ?2, ?3)",
            params![item.id, tag_id, position as i64],
        )?;
    }

    let wanted: HashSet<&str> = item.attachments.iter().map(|a| a.id.as_str()).collect();
    let existing = conn
        .prepare("SELECT id FROM attachments WHERE item_id = ?1")?
        .query_map([&item.id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in existing.iter().filter(|id| !wanted.contains(id.as_str())) {
        conn.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
    }
    for attachment in &item.attachments {
        if has_attachment(conn, &attachment.id)? {
            // Attachments are immutable; it may have moved between items.
            conn.execute(
                "UPDATE attachments SET item_id = ?1 WHERE id = ?2",
                params![item.id, attachment.id],
            )?;
            continue;
        }
        let Some(bytes) = blobs.get(&attachment.id) else {
            return Err(SyncError::InvalidRemote(format!("missing attachment blob {}", attachment.id)));
        };
        conn.execute(
            "INSERT INTO attachments (id, item_id, file_name_ciphertext, content_ciphertext, byte_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                attachment.id,
                item.id,
                encrypt(key, &attachment.file_name)?,
                encrypt(key, &BASE64.encode(bytes))?,
                bytes.len() as i64,
                attachment.created_at
            ],
        )?;
    }
    Ok(())
}

fn delete_record(conn: &Connection, key: &VaultKey, record_key: &str) -> SyncResult<bool> {
    if let Some(id) = record_key.strip_prefix("item:") {
        conn.execute("DELETE FROM items WHERE id = ?1", [id])?;
        return Ok(true);
    }
    if let Some(rest) = record_key.strip_prefix("tag:") {
        if let Some((vault_id, name)) = rest.split_once(':') {
            conn.execute(
                "DELETE FROM tags WHERE vault_id = ?1 AND name_hash = ?2",
                params![vault_id, crate::vault::tag_name_hash(key, name)],
            )?;
        }
        return Ok(true);
    }
    if let Some(id) = record_key.strip_prefix("vault:") {
        // Never cascade items away: a vault that still holds anything here stays (and is pushed
        // back next sync). Dissolving elsewhere moves the items first, so normally it is empty.
        let holds: i64 = conn.query_row("SELECT COUNT(*) FROM items WHERE vault_id = ?1", [id], |r| r.get(0))?;
        if holds > 0 {
            return Ok(false);
        }
        conn.execute("DELETE FROM vaults WHERE id = ?1", [id])?;
        return Ok(true);
    }
    Ok(false)
}

/// Applies the merge's local ops in one transaction. An op is skipped (and its key returned) when
/// the record changed locally since `snapshot` was taken — the user edited it mid-sync — so the
/// edit is never overwritten; the next sync merges it.
pub fn apply(
    conn: &mut Connection,
    key: &VaultKey,
    ops: &[LocalOp],
    snapshot: &BTreeMap<String, LocalRecord>,
    blobs: &HashMap<String, Vec<u8>>,
    base: &BTreeMap<String, BaseEntry>,
    old_base: &BTreeMap<String, BaseEntry>,
) -> SyncResult<Vec<String>> {
    let tx = conn.transaction()?;
    let mut skipped = Vec::new();
    for op in ops {
        let record_key = op.key();
        let current = read_record(&tx, key, record_key)?.map(|r| record_hash(key, &r));
        let expected = snapshot.get(record_key).map(|l| l.hash.clone());
        if current != expected {
            skipped.push(record_key.to_string());
            continue;
        }
        let done = match op {
            LocalOp::Upsert(_, Record::Vault(vault)) => {
                upsert_vault(&tx, key, vault)?;
                true
            }
            LocalOp::Upsert(_, Record::Tag(tag)) => upsert_tag(&tx, key, tag)?,
            LocalOp::Upsert(_, Record::Item(item)) => {
                upsert_item(&tx, key, item, blobs)?;
                true
            }
            LocalOp::Delete(_) => delete_record(&tx, key, record_key)?,
        };
        if !done {
            skipped.push(record_key.to_string());
        }
    }
    // The new base, except that a skipped key keeps its old base so the next merge still sees
    // the local side as changed.
    let mut next = base.clone();
    for record_key in &skipped {
        next.remove(record_key);
        if let Some(entry) = old_base.get(record_key) {
            next.insert(record_key.clone(), entry.clone());
        }
    }
    replace_base(&tx, key, &next)?;
    tx.commit()?;
    Ok(skipped)
}
