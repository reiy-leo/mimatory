//! One sync round and the connect handshake, provider-agnostic (`RemoteStore`).
//!
//! Round: download `vault.enc` (+ETag) → decrypt → three-way merge with the local snapshot and the
//! base → upload any new attachment blobs → write the merged state with `If-Match` (or
//! `If-None-Match: *` for the first write) → only then apply the pulled changes locally and store
//! the new base. A 412 (another device wrote in between) restarts the round from the download;
//! nothing local has been touched yet at that point.

use super::cipher::{self, Manifest, SyncKey};
use super::error::{SyncError, SyncResult};
use super::local;
use super::merge::{merge, LocalOp, RemoteState, STATE_FORMAT};
use super::records::Record;
use super::remote::{blob_name, Precondition, RemoteStore, MANIFEST, STATE};
use crate::crypto::VaultKey;
use chrono::Utc;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};

const MAX_ATTEMPTS: usize = 4;

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct SyncReport {
    /// Records changed locally by this round (pulled from the remote).
    pub pulled: usize,
    /// Records this device wrote to the remote.
    pub pushed: usize,
    /// Pulled changes that were skipped because the record was edited during the round.
    pub deferred: usize,
    pub at: String,
}

pub enum JoinOutcome {
    Ready(SyncKey),
    /// The remote belongs to a vault with another salt (another device's setup) and the local
    /// vault key does not unwrap it: ask for that vault's master password once.
    NeedsPassword,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

/// Connect handshake: create the remote (manifest wrapped under the local vault key) when it is
/// empty, otherwise try to unwrap the existing manifest with the local vault key.
pub fn join(store: &mut dyn RemoteStore, conn: &Connection, vault_key: &VaultKey) -> SyncResult<JoinOutcome> {
    store.prepare()?;
    for _ in 0..MAX_ATTEMPTS {
        match store.get(MANIFEST)? {
            Some(object) => {
                let manifest = Manifest::parse(&object.bytes)?;
                return Ok(match manifest.unwrap_with_key(vault_key) {
                    Ok(key) => JoinOutcome::Ready(key),
                    Err(_) => JoinOutcome::NeedsPassword,
                });
            }
            None => {
                let salt = local::local_salt(conn)?;
                let (manifest, key) = Manifest::create(vault_key, &salt, &now())?;
                match store.put(MANIFEST, serde_json::to_vec_pretty(&manifest)?, Precondition::IfNoneMatch) {
                    Ok(_) => return Ok(JoinOutcome::Ready(key)),
                    // Another device created it a moment ago: read theirs.
                    Err(error) if error.is_conflict() => continue,
                    Err(error) => return Err(error),
                }
            }
        }
    }
    Err(SyncError::ConflictRetriesExhausted)
}

/// The user typed the remote vault's master password.
pub fn unlock_remote(store: &mut dyn RemoteStore, password: &str) -> SyncResult<SyncKey> {
    let object = store.get(MANIFEST)?.ok_or(SyncError::NotConnected)?;
    Manifest::parse(&object.bytes)?.unwrap_with_password(password)
}

pub fn decode_state(sync_key: &SyncKey, bytes: &[u8]) -> SyncResult<RemoteState> {
    let plain = cipher::open(sync_key, cipher::aad_state(), bytes)?;
    let state: RemoteState = serde_json::from_slice(&plain)?;
    if state.format > STATE_FORMAT {
        return Err(SyncError::UnsupportedFormat(state.format));
    }
    Ok(state)
}

pub fn encode_state(sync_key: &SyncKey, state: &RemoteState) -> SyncResult<Vec<u8>> {
    cipher::seal(sync_key, cipher::aad_state(), &serde_json::to_vec(state)?)
}

pub fn run(
    store: &mut dyn RemoteStore,
    conn: &mut Connection,
    vault_key: &VaultKey,
    sync_key: &SyncKey,
    device: &str,
) -> SyncResult<SyncReport> {
    local::ensure_tables(conn)?;
    for _ in 0..MAX_ATTEMPTS {
        let (remote, etag) = match store.get(STATE)? {
            Some(object) => (decode_state(sync_key, &object.bytes)?, Some(object.etag)),
            None => (RemoteState::default(), None),
        };
        let snapshot = local::snapshot(conn, vault_key)?;
        let keys: BTreeSet<&String> = snapshot.keys().chain(remote.entries.keys()).collect();
        let base = local::load_base(conn, vault_key, keys)?;
        let stamp = now();
        let outcome = merge(&snapshot, &base, &remote, device, &stamp, |record| {
            local::record_hash(vault_key, record)
        });

        if outcome.remote_dirty {
            // Blobs first, so the state never references an attachment the remote lacks.
            let present = remote.attachment_ids();
            for id in outcome.remote.attachment_ids().difference(&present) {
                if let Some(bytes) = local::attachment_bytes(conn, vault_key, id)? {
                    let sealed = cipher::seal(sync_key, &cipher::aad_blob(id), &bytes)?;
                    store.put(&blob_name(id), sealed, Precondition::None)?;
                }
            }
            let body = encode_state(sync_key, &outcome.remote)?;
            let precondition = match &etag {
                None => Precondition::IfNoneMatch,
                Some(tag) => Precondition::IfMatch(tag.clone()),
            };
            match store.put(STATE, body, precondition) {
                Ok(_) => {}
                Err(error) if error.is_conflict() => continue,
                Err(error) => return Err(error),
            }
        }

        // Download the attachments the pulled items need, outside the write transaction.
        let mut blobs = HashMap::new();
        for op in &outcome.local_ops {
            if let LocalOp::Upsert(_, Record::Item(item)) = op {
                for attachment in &item.attachments {
                    if blobs.contains_key(&attachment.id) || local::has_attachment(conn, &attachment.id)? {
                        continue;
                    }
                    let object = store
                        .get(&blob_name(&attachment.id))?
                        .ok_or_else(|| SyncError::InvalidRemote(format!("blob {} missing", attachment.id)))?;
                    let bytes = cipher::open(sync_key, &cipher::aad_blob(&attachment.id), &object.bytes)?;
                    blobs.insert(attachment.id.clone(), bytes);
                }
            }
        }

        let skipped = local::apply(conn, vault_key, &outcome.local_ops, &snapshot, &blobs, &outcome.base, &base)?;
        return Ok(SyncReport {
            pulled: outcome.local_ops.len() - skipped.len(),
            pushed: outcome.pushed,
            deferred: skipped.len(),
            at: stamp,
        });
    }
    Err(SyncError::ConflictRetriesExhausted)
}
