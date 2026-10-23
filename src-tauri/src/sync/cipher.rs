//! Sync crypto: the random **sync key** that encrypts everything on the remote, the plaintext
//! manifest that carries it wrapped under the master password, and the envelope format.
//!
//! Why a separate key: each device's vault key is `Argon2id(master password, that device's salt)`,
//! so two devices that set up independently never share a vault key. The remote is encrypted
//! under one random 256-bit sync key instead; the manifest holds it wrapped under
//! `Argon2id(master password, manifest salt)`, and each device keeps its own copy encrypted under
//! its vault key (in the `settings` row) so later syncs — Touch ID unlocks included — need no
//! password. Only ciphertext and non-secret KDF parameters ever leave the device.

use super::error::{SyncError, SyncResult};
use crate::crypto::VaultKey;
use aes_gcm::aead::{Aead, OsRng, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

pub type SyncKey = [u8; 32];

pub const MANIFEST_FORMAT: u32 = 1;
const AAD_KEY: &[u8] = b"passless-sync/v1/sync-key";
const AAD_STATE: &[u8] = b"passless-sync/v1/state";

pub fn aad_state() -> &'static [u8] {
    AAD_STATE
}

/// Binds a blob to its attachment id, so the server cannot swap one attachment's ciphertext for
/// another's (or for the state file) without decryption failing.
pub fn aad_blob(attachment_id: &str) -> Vec<u8> {
    format!("passless-sync/v1/blob/{attachment_id}").into_bytes()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Envelope {
    pub v: u32,
    pub alg: String,
    pub nonce: String,
    pub ct: String,
}

pub fn seal_envelope(key: &[u8; 32], aad: &[u8], plaintext: &[u8]) -> SyncResult<Envelope> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| SyncError::Decrypt)?;
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext, aad })
        .map_err(|_| SyncError::Decrypt)?;
    Ok(Envelope {
        v: 1,
        alg: "A256GCM".to_string(),
        nonce: BASE64.encode(nonce),
        ct: BASE64.encode(ct),
    })
}

pub fn open_envelope(key: &[u8; 32], aad: &[u8], envelope: &Envelope) -> SyncResult<Vec<u8>> {
    if envelope.v != 1 || envelope.alg != "A256GCM" {
        return Err(SyncError::UnsupportedFormat(envelope.v));
    }
    let nonce = BASE64.decode(&envelope.nonce).map_err(|_| SyncError::Decrypt)?;
    let ct = BASE64.decode(&envelope.ct).map_err(|_| SyncError::Decrypt)?;
    if nonce.len() != 12 {
        return Err(SyncError::Decrypt);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| SyncError::Decrypt)?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), Payload { msg: &ct, aad })
        .map_err(|_| SyncError::Decrypt)
}

/// A remote file body: the envelope as JSON bytes.
pub fn seal(key: &[u8; 32], aad: &[u8], plaintext: &[u8]) -> SyncResult<Vec<u8>> {
    Ok(serde_json::to_vec(&seal_envelope(key, aad, plaintext)?)?)
}

pub fn open(key: &[u8; 32], aad: &[u8], body: &[u8]) -> SyncResult<Vec<u8>> {
    let envelope: Envelope = serde_json::from_slice(body).map_err(|_| SyncError::Decrypt)?;
    open_envelope(key, aad, &envelope)
}

/// Argon2id parameters, written out so a future change of the app's defaults cannot strand a
/// remote created under the old ones.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct KdfParams {
    pub algorithm: String,
    pub version: u32,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub salt: String,
}

impl KdfParams {
    /// Exactly what `crypto::derive_key` uses (`Argon2::default()`: Argon2id v0x13, 19 MiB, t=2, p=1),
    /// so a manifest written with the local salt unwraps with the local vault key itself.
    pub fn app_default(salt: &[u8]) -> Self {
        KdfParams {
            algorithm: "argon2id".to_string(),
            version: 0x13,
            memory_kib: Params::DEFAULT_M_COST,
            iterations: Params::DEFAULT_T_COST,
            parallelism: Params::DEFAULT_P_COST,
            salt: BASE64.encode(salt),
        }
    }

    pub fn derive(&self, password: &str) -> SyncResult<VaultKey> {
        if self.algorithm != "argon2id" || self.version != 0x13 {
            return Err(SyncError::InvalidRemote("unknown KDF".to_string()));
        }
        // Refuse absurd parameters a hostile server could plant to hang or exhaust the device.
        if self.memory_kib > 1024 * 1024 || self.iterations > 64 || self.parallelism > 16 {
            return Err(SyncError::InvalidRemote("KDF parameters out of range".to_string()));
        }
        let salt = BASE64
            .decode(&self.salt)
            .map_err(|_| SyncError::InvalidRemote("bad salt".to_string()))?;
        let params = Params::new(self.memory_kib, self.iterations, self.parallelism, Some(32))
            .map_err(|_| SyncError::InvalidRemote("bad KDF parameters".to_string()))?;
        let mut key = [0_u8; 32];
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
            .hash_password_into(password.as_bytes(), &salt, &mut key)
            .map_err(|_| SyncError::InvalidRemote("KDF failed".to_string()))?;
        Ok(key)
    }
}

/// `passless/manifest.json`, the one plaintext file on the remote. Nothing in it is secret.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Manifest {
    pub format: u32,
    pub app: String,
    pub kdf: KdfParams,
    /// The sync key, AES-256-GCM under `kdf.derive(master password)`.
    pub wrapped_key: Envelope,
    pub created_at: String,
}

pub fn generate_sync_key() -> SyncKey {
    let mut key = [0_u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

impl Manifest {
    /// A new remote: a fresh sync key wrapped under the local vault key, which *is*
    /// `Argon2id(master password, local salt)` with the app's default parameters — so creating the
    /// remote needs no password prompt.
    pub fn create(vault_key: &VaultKey, local_salt: &[u8], now: &str) -> SyncResult<(Manifest, SyncKey)> {
        let sync_key = generate_sync_key();
        let manifest = Manifest {
            format: MANIFEST_FORMAT,
            app: "passless".to_string(),
            kdf: KdfParams::app_default(local_salt),
            wrapped_key: seal_envelope(vault_key, AAD_KEY, &sync_key)?,
            created_at: now.to_string(),
        };
        Ok((manifest, sync_key))
    }

    pub fn parse(body: &[u8]) -> SyncResult<Manifest> {
        let manifest: Manifest = serde_json::from_slice(body)
            .map_err(|_| SyncError::InvalidRemote("manifest.json".to_string()))?;
        if manifest.format > MANIFEST_FORMAT {
            return Err(SyncError::UnsupportedFormat(manifest.format));
        }
        Ok(manifest)
    }

    /// Unwrap with an already-derived key (the local vault key when the salts match).
    pub fn unwrap_with_key(&self, key: &VaultKey) -> SyncResult<SyncKey> {
        let bytes = open_envelope(key, AAD_KEY, &self.wrapped_key)?;
        bytes.try_into().map_err(|_| SyncError::Decrypt)
    }

    /// Unwrap with the remote vault's master password (another device's vault, another salt).
    pub fn unwrap_with_password(&self, password: &str) -> SyncResult<SyncKey> {
        let key = self.kdf.derive(password)?;
        self.unwrap_with_key(&key).map_err(|_| SyncError::RemotePasswordWrong)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{derive_key, generate_salt};

    #[test]
    fn envelope_round_trips_and_binds_its_aad() {
        let key = generate_sync_key();
        let body = seal(&key, b"a", b"secret").unwrap();
        assert_eq!(open(&key, b"a", &body).unwrap(), b"secret");
        assert!(open(&key, b"b", &body).is_err());
        assert!(open(&generate_sync_key(), b"a", &body).is_err());
        assert!(!String::from_utf8_lossy(&body).contains("secret"));
    }

    #[test]
    fn manifest_unwraps_with_the_local_key_and_with_the_password_elsewhere() {
        let salt = generate_salt();
        let local = derive_key("correct horse", &salt).unwrap();
        let (manifest, sync_key) = Manifest::create(&local, &salt, "2026-10-23T00:00:00Z").unwrap();
        let manifest = Manifest::parse(&serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert_eq!(manifest.kdf.salt, BASE64.encode(salt));
        assert_eq!(manifest.unwrap_with_key(&local).unwrap(), sync_key);
        // Another device: its own salt and key, the same password typed once.
        let other = derive_key("correct horse", &generate_salt()).unwrap();
        assert!(manifest.unwrap_with_key(&other).is_err());
        assert_eq!(manifest.unwrap_with_password("correct horse").unwrap(), sync_key);
        assert!(matches!(
            manifest.unwrap_with_password("wrong"),
            Err(SyncError::RemotePasswordWrong)
        ));
    }
}
