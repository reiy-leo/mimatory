use crate::crypto::{decrypt_string, encrypt_string, CryptoError, EncryptedPayload};
use crate::storage;
use crate::vault::{LoginItem, LoginItemInput, Session};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SnapshotPayload {
    pub version: u32,
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub items: Vec<LoginItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SnapshotSummary {
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub item_count: usize,
}

#[derive(Debug, Error)]
pub enum SyncHistoryError {
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("crypto error: {0}")]
    Crypto(#[from] CryptoError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("snapshot not found")]
    NotFound,
}

pub fn create_snapshot(
    session: &Session,
    label: &str,
    items: Vec<LoginItem>,
) -> Result<SnapshotSummary, SyncHistoryError> {
    let id = Uuid::new_v4().to_string();
    let payload = SnapshotPayload {
        version: 1,
        id: id.clone(),
        label: label.to_string(),
        created_at: Utc::now().to_rfc3339(),
        items,
    };
    let encrypted = encrypt_string(session.key(), &serde_json::to_string(&payload)?)?;
    let path = snapshot_path(&id)?;
    if let Some(parent) = path.parent() {
        storage::create_private_directory(parent)?;
    }
    fs::write(&path, serde_json::to_vec(&encrypted)?)?;
    storage::set_private_permissions(&path)?;
    Ok(SnapshotSummary {
        id,
        label: payload.label,
        created_at: payload.created_at,
        item_count: payload.items.len(),
    })
}

pub fn list_snapshots(session: &Session) -> Result<Vec<SnapshotSummary>, SyncHistoryError> {
    let dir = history_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("snapshot") {
            continue;
        }
        if let Ok(payload) = read_snapshot_file(session, entry.path()) {
            snapshots.push(SnapshotSummary {
                id: payload.id,
                label: payload.label,
                created_at: payload.created_at,
                item_count: payload.items.len(),
            });
        }
    }
    snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(snapshots)
}

pub fn restore_snapshot(
    session: &Session,
    id: &str,
) -> Result<Vec<LoginItemInput>, SyncHistoryError> {
    let path = snapshot_path(id)?;
    if !path.exists() {
        return Err(SyncHistoryError::NotFound);
    }
    let payload = read_snapshot_file(session, path)?;
    Ok(payload
        .items
        .into_iter()
        .map(|item| LoginItemInput {
            item_type: item.item_type,
            title: item.title,
            username: item.username,
            password: item.password,
            website: item.website,
            urls: item.urls,
            notes: item.notes,
            tags: item.tags,
            custom_fields: item.custom_fields,
            favorite: item.favorite,
        })
        .collect())
}

fn read_snapshot_file(
    session: &Session,
    path: PathBuf,
) -> Result<SnapshotPayload, SyncHistoryError> {
    let encrypted: EncryptedPayload = serde_json::from_slice(&fs::read(path)?)?;
    Ok(serde_json::from_str(&decrypt_string(
        session.key(),
        &encrypted,
    )?)?)
}

fn history_dir() -> Result<PathBuf, SyncHistoryError> {
    Ok(storage::default_database_path()?
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "missing app data dir"))?
        .join("sync-history"))
}

fn snapshot_path(id: &str) -> Result<PathBuf, SyncHistoryError> {
    Ok(history_dir()?.join(format!("{id}.snapshot")))
}

impl From<storage::StorageError> for SyncHistoryError {
    fn from(value: storage::StorageError) -> Self {
        match value {
            storage::StorageError::Filesystem(error) => SyncHistoryError::Io(error),
            other => SyncHistoryError::Io(std::io::Error::other(other.to_string())),
        }
    }
}
