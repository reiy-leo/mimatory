//! What the engine needs from a provider: named objects with a version tag (ETag) and conditional
//! writes. Names are logical (`manifest.json`, `vault.enc`, `blobs/<id>.bin`); each provider maps
//! them onto its own layout.

use super::error::SyncResult;
use std::time::Duration;

pub const MANIFEST: &str = "manifest.json";
pub const STATE: &str = "vault.enc";

pub fn blob_name(attachment_id: &str) -> String {
    format!("blobs/{attachment_id}.bin")
}

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Precondition {
    /// Unconditional (immutable blobs).
    None,
    /// Only if the object is still at this version — a concurrent writer makes it fail with 412.
    IfMatch(String),
    /// Only if the object does not exist yet.
    IfNoneMatch,
}

#[derive(Clone, Debug)]
pub struct RemoteObject {
    pub bytes: Vec<u8>,
    /// Empty when the server gives no ETag (then writes cannot be conditional).
    pub etag: String,
}

pub trait RemoteStore {
    /// Checks the account and creates the folder layout. Idempotent.
    fn prepare(&mut self) -> SyncResult<()>;
    fn get(&mut self, name: &str) -> SyncResult<Option<RemoteObject>>;
    /// Returns the new ETag (may be empty). A failed precondition is `SyncError::Http { status: 412 }`.
    fn put(&mut self, name: &str, bytes: Vec<u8>, precondition: Precondition) -> SyncResult<String>;
}
