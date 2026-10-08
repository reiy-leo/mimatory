use crate::crypto::{
    decrypt_string, derive_key, encrypt_string, generate_salt, CryptoError, EncryptedPayload,
};
use crate::storage;
use crate::vault::{LoginItem, LoginItemInput};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use thiserror::Error;

const BACKUP_FORMAT: &str = "passless-backup-v1";
const BACKUP_KDF: &str = "argon2id";

/// The vault in the shape it is stored inside a backup. Plain JSON exports used to
/// write this file directly to disk; now it only ever exists as the decrypted
/// contents of an encrypted envelope.
#[derive(Debug, Deserialize, Serialize)]
pub struct JsonVaultExport {
    pub version: u32,
    pub exported_at: String,
    pub items: Vec<LoginItem>,
}

#[derive(Debug, Deserialize, Serialize)]
struct BackupEnvelope {
    format: String,
    kdf: String,
    /// Random per-file Argon2id salt, so a backup can be opened on a fresh install
    /// that has a different vault salt.
    salt: String,
    exported_at: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct JsonImportPreview {
    pub total_items: usize,
    pub sample_titles: Vec<String>,
    pub encrypted: bool,
}

#[derive(Debug, Error)]
pub enum JsonTransferError {
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("crypto error: {0}")]
    Crypto(#[from] CryptoError),
    #[error("encoding error: {0}")]
    Encoding(#[from] base64::DecodeError),
    #[error("a backup password is required")]
    MissingPassword,
    #[error("the backup password is wrong or the file is damaged")]
    WrongPassword,
}

pub fn write_backup(
    path: &Path,
    items: Vec<LoginItem>,
    password: &str,
) -> Result<usize, JsonTransferError> {
    if password.is_empty() {
        return Err(JsonTransferError::MissingPassword);
    }

    let count = items.len();
    let exported_at = Utc::now().to_rfc3339();
    let snapshot = JsonVaultExport {
        version: 1,
        exported_at: exported_at.clone(),
        items,
    };

    let salt = generate_salt();
    let key = derive_key(password, &salt)?;
    let payload = encrypt_string(&key, &serde_json::to_string(&snapshot)?)?;

    let envelope = BackupEnvelope {
        format: BACKUP_FORMAT.to_string(),
        kdf: BACKUP_KDF.to_string(),
        salt: BASE64.encode(salt),
        exported_at,
        nonce: BASE64.encode(payload.nonce),
        ciphertext: BASE64.encode(payload.ciphertext),
    };

    fs::write(path, serde_json::to_vec_pretty(&envelope)?)?;
    storage::set_private_permissions(path)?;
    Ok(count)
}

pub fn read_export(path: &Path, password: &str) -> Result<Vec<LoginItemInput>, JsonTransferError> {
    Ok(open_export(path, password)?
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

pub fn preview_export(path: &Path, password: &str) -> Result<JsonImportPreview, JsonTransferError> {
    let envelope = read_envelope(path)?;
    let encrypted = is_backup_envelope(&envelope);

    // An encrypted file with no password typed yet is the form's starting state, not
    // a failure — report it as encrypted so the UI can ask for the password.
    if encrypted && password.is_empty() {
        return Ok(JsonImportPreview {
            total_items: 0,
            sample_titles: Vec::new(),
            encrypted,
        });
    }

    let export = if encrypted {
        decrypt_envelope(&envelope, password)?
    } else {
        serde_json::from_value(envelope)?
    };

    Ok(JsonImportPreview {
        total_items: export.items.len(),
        sample_titles: export
            .items
            .iter()
            .take(5)
            .map(|item| item.title.clone())
            .collect(),
        encrypted,
    })
}

/// Older exports were plain JSON. They stay importable so a vault exported before
/// backups were encrypted can still be recovered.
fn open_export(path: &Path, password: &str) -> Result<JsonVaultExport, JsonTransferError> {
    let envelope = read_envelope(path)?;
    if is_backup_envelope(&envelope) {
        return decrypt_envelope(&envelope, password);
    }
    Ok(serde_json::from_value(envelope)?)
}

fn read_envelope(path: &Path) -> Result<serde_json::Value, JsonTransferError> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn is_backup_envelope(envelope: &serde_json::Value) -> bool {
    envelope.get("format").and_then(|value| value.as_str()) == Some(BACKUP_FORMAT)
}

fn decrypt_envelope(
    envelope: &serde_json::Value,
    password: &str,
) -> Result<JsonVaultExport, JsonTransferError> {
    if password.is_empty() {
        return Err(JsonTransferError::MissingPassword);
    }

    let backup: BackupEnvelope = serde_json::from_value(envelope.clone())?;
    let key = derive_key(password, &BASE64.decode(&backup.salt)?)?;
    let plaintext = decrypt_string(
        &key,
        &EncryptedPayload {
            nonce: BASE64.decode(&backup.nonce)?,
            ciphertext: BASE64.decode(&backup.ciphertext)?,
        },
    )
    .map_err(|_| JsonTransferError::WrongPassword)?;

    Ok(serde_json::from_str(&plaintext)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_backup_path(prefix: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "passless-{}-{}-{}.json",
            prefix,
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    }

    fn sample_item() -> LoginItem {
        LoginItem {
            id: "one".into(),
            item_type: "login".into(),
            title: "Example".into(),
            username: "alice".into(),
            password: "super-secret-value".into(),
            website: "https://example.com".into(),
            urls: vec![],
            notes: "".into(),
            tags: vec![],
            custom_fields: vec![],
            favorite: false,
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn preview_reports_count_and_sample_titles_for_plain_exports() {
        let path = temp_backup_path("preview");
        let payload = JsonVaultExport {
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            items: vec![sample_item()],
        };
        std::fs::write(&path, serde_json::to_vec(&payload).expect("json")).expect("write");

        let preview = preview_export(&path, "").expect("preview should parse");

        assert_eq!(preview.total_items, 1);
        assert_eq!(preview.sample_titles, vec!["Example"]);
        assert!(!preview.encrypted);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backup_files_do_not_contain_plaintext_secrets() {
        let path = temp_backup_path("sealed");

        write_backup(&path, vec![sample_item()], "backup-password").expect("backup should write");
        let contents = std::fs::read_to_string(&path).expect("backup should read");

        assert!(contents.contains(BACKUP_FORMAT));
        assert!(!contents.contains("super-secret-value"));
        assert!(!contents.contains("alice"));
        assert!(!contents.contains("Example"));

        // Without the password the file is only known to be encrypted.
        let preview = preview_export(&path, "").expect("preview should not fail");
        assert!(preview.encrypted);
        assert_eq!(preview.total_items, 0);

        let preview = preview_export(&path, "backup-password").expect("preview should decrypt");
        assert_eq!(preview.total_items, 1);
        assert_eq!(preview.sample_titles, vec!["Example"]);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backup_round_trips_items_with_the_same_password() {
        let path = temp_backup_path("roundtrip");

        write_backup(&path, vec![sample_item()], "backup-password").expect("backup should write");
        let items = read_export(&path, "backup-password").expect("backup should import");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Example");
        assert_eq!(items[0].password, "super-secret-value");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn backup_rejects_wrong_and_missing_passwords() {
        let path = temp_backup_path("reject");

        write_backup(&path, vec![sample_item()], "backup-password").expect("backup should write");

        assert!(matches!(
            read_export(&path, "not-the-password"),
            Err(JsonTransferError::WrongPassword)
        ));
        assert!(matches!(
            read_export(&path, ""),
            Err(JsonTransferError::MissingPassword)
        ));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn exporting_without_a_password_is_refused() {
        let path = temp_backup_path("empty-password");

        assert!(matches!(
            write_backup(&path, vec![sample_item()], ""),
            Err(JsonTransferError::MissingPassword)
        ));
        assert!(!path.exists());
    }
}
