use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::Argon2;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type VaultKey = [u8; 32];

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EncryptedPayload {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("key derivation failed")]
    KeyDerivation,
    #[error("encryption failed")]
    Encryption,
    #[error("decryption failed")]
    Decryption,
    #[error("payload serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0_u8; 16];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn derive_key(password: &str, salt: &[u8]) -> Result<VaultKey, CryptoError> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| CryptoError::KeyDerivation)?;
    Ok(key)
}

pub fn encrypt_string(key: &VaultKey, value: &str) -> Result<EncryptedPayload, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::Encryption)?;
    let mut nonce_bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, value.as_bytes())
        .map_err(|_| CryptoError::Encryption)?;

    Ok(EncryptedPayload {
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
}

pub fn decrypt_string(key: &VaultKey, payload: &EncryptedPayload) -> Result<String, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::Decryption)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&payload.nonce),
            payload.ciphertext.as_ref(),
        )
        .map_err(|_| CryptoError::Decryption)?;
    String::from_utf8(plaintext).map_err(|_| CryptoError::Decryption)
}

pub fn encrypt_string_to_blob(key: &VaultKey, value: &str) -> Result<Vec<u8>, CryptoError> {
    Ok(serde_json::to_vec(&encrypt_string(key, value)?)?)
}

pub fn decrypt_string_from_blob(key: &VaultKey, blob: &[u8]) -> Result<String, CryptoError> {
    let payload = serde_json::from_slice(blob)?;
    decrypt_string(key, &payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_payload_round_trips_with_same_password() {
        let salt = generate_salt();
        let key = derive_key("correct horse battery staple", &salt).expect("key should derive");

        let encrypted = encrypt_string(&key, "github-password").expect("value should encrypt");
        let decrypted = decrypt_string(&key, &encrypted).expect("value should decrypt");

        assert_eq!(decrypted, "github-password");
        assert_ne!(encrypted.ciphertext, b"github-password");
    }

    #[test]
    fn encrypted_payload_rejects_wrong_password_key() {
        let salt = generate_salt();
        let correct_key = derive_key("correct-password", &salt).expect("key should derive");
        let wrong_key = derive_key("wrong-password", &salt).expect("key should derive");

        let encrypted = encrypt_string(&correct_key, "secret").expect("value should encrypt");

        assert!(decrypt_string(&wrong_key, &encrypted).is_err());
    }
}
