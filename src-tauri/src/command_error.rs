//! The one error shape every vault command rejects with: `{ code, message, detail, status }`.
//!
//! `code` is stable and the frontend translates it (`errors.<code>` in src/app/i18n.ts, en/zh/ja), so no
//! English `Display` text reaches the UI as the message. `message` is the English text, kept for logs and
//! as the raw fallback the frontend shows after its generic line when it does not know a code. `detail`
//! carries the inner error of a wrapper variant (the SQLite or I/O message) and `status` an HTTP status,
//! which the UI always shows with its Chinese gloss ("401 未授权").
//!
//! Adding a variant to one of the error enums below means adding its code here *and* to `errorCodes` in
//! src/app/errors.ts — `every_code_is_known_to_the_frontend` reads that file and fails otherwise.

use serde::Serialize;

use crate::biometric::BiometricError;
use crate::breach_check::BreachCheckError;
use crate::crypto::CryptoError;
use crate::favicon::FaviconError;
use crate::import_1pux::Import1PuxError;
use crate::passkey::PasskeyError;
use crate::storage::StorageError;
use crate::totp::TotpError;
use crate::vault::VaultError;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl CommandError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), detail: None, status: None }
    }

    fn with_detail(code: &'static str, message: impl ToString, detail: impl ToString) -> Self {
        Self { code, message: message.to_string(), detail: Some(detail.to_string()), status: None }
    }

    /// A poisoned lock or a failed thread join: nothing the user can act on, shown as the generic line.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }

    /// A command that exists on every platform but only works on some (desktop-only bridge, no picker on
    /// phones).
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new("unsupported_platform", message)
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// Plain text from a helper that still speaks `String` (shell.rs autostart): no code to translate, so the
/// frontend shows its generic line with this text after it.
impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}

impl From<VaultError> for CommandError {
    fn from(error: VaultError) -> Self {
        let code = match &error {
            VaultError::MasterPasswordAlreadyConfigured => "master_password_already_set",
            VaultError::MasterPasswordMissing => "master_password_missing",
            VaultError::InvalidMasterPassword => "invalid_master_password",
            VaultError::Locked => "locked",
            VaultError::VaultNotFound => "vault_not_found",
            VaultError::PasskeyItemNotFound => "passkey_item_not_found",
            VaultError::TagNameEmpty => "tag_name_empty",
            VaultError::TagNotFound => "tag_not_found",
            VaultError::VaultNameEmpty => "vault_name_empty",
            VaultError::VaultDestinationRequired => "vault_destination_required",
            VaultError::VaultLastOne => "vault_last_one",
            VaultError::VaultLastOpen => "vault_last_open",
            VaultError::RelationSelf => "relation_self",
            VaultError::RelationCycle => "relation_cycle",
            VaultError::RelationItemNotFound => "relation_item_not_found",
            VaultError::ItemHasRelations => "item_has_relations",
            VaultError::ItemRelationsBlockMove => "item_relations_block_move",
            VaultError::InvalidIconMode => "invalid_icon_mode",
            VaultError::ItemNotFound => "item_not_found",
            VaultError::EmptyCharacterSet => "empty_character_set",
            VaultError::Database(inner) => return Self::with_detail("database", &error, inner),
            VaultError::Crypto(inner) => return Self::with_detail("crypto", &error, inner),
            VaultError::Serialization(inner) => return Self::with_detail("serialization", &error, inner),
        };
        Self::new(code, error.to_string())
    }
}

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        match &error {
            StorageError::MissingDataDirectory => Self::new("no_data_directory", error.to_string()),
            StorageError::Filesystem(inner) => Self::with_detail("filesystem", &error, inner),
            StorageError::Sqlite(inner) => Self::with_detail("database", &error, inner),
        }
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::with_detail("filesystem", "filesystem error", error)
    }
}

impl From<CryptoError> for CommandError {
    fn from(error: CryptoError) -> Self {
        Self::with_detail("crypto", "crypto error", error)
    }
}

impl From<Import1PuxError> for CommandError {
    fn from(error: Import1PuxError) -> Self {
        match error {
            Import1PuxError::Vault(inner) => Self::from(inner),
            Import1PuxError::Io(ref inner) => Self::with_detail("import_unreadable", &error, inner),
            Import1PuxError::Zip(ref inner) => Self::with_detail("import_not_1pux", &error, inner),
            Import1PuxError::Json(ref inner) => Self::with_detail("import_bad_json", &error, inner),
            Import1PuxError::NoData => Self::new("import_no_data", error.to_string()),
        }
    }
}

impl From<TotpError> for CommandError {
    fn from(error: TotpError) -> Self {
        let code = match error {
            TotpError::InvalidSecret => "totp_invalid_secret",
            TotpError::Clock => "clock",
        };
        Self::new(code, error.to_string())
    }
}

impl From<PasskeyError> for CommandError {
    fn from(error: PasskeyError) -> Self {
        let code = match error {
            PasskeyError::RpIdMismatch => "passkey_rp_mismatch",
            PasskeyError::InsecureOrigin => "passkey_insecure_origin",
            PasskeyError::UnsupportedAlgorithm => "passkey_unsupported_algorithm",
            PasskeyError::BadEncoding => "passkey_bad_encoding",
            PasskeyError::BadKey => "passkey_bad_key",
        };
        Self::new(code, error.to_string())
    }
}

impl From<FaviconError> for CommandError {
    fn from(error: FaviconError) -> Self {
        Self::with_detail("site_icon", "website icon error", error)
    }
}

impl From<BreachCheckError> for CommandError {
    fn from(error: BreachCheckError) -> Self {
        let BreachCheckError::Http(inner) = &error;
        let status = inner.status().map(|status| status.as_u16());
        let code = if status.is_some() { "http" } else { "network" };
        Self { code, message: error.to_string(), detail: Some(inner.to_string()), status }
    }
}

impl From<BiometricError> for CommandError {
    fn from(error: BiometricError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::internal(error.to_string())
    }
}

/// Every code this file can send, for the frontend parity test.
#[cfg(test)]
pub const CODES: &[&str] = &[
    "internal",
    "unsupported_platform",
    "master_password_already_set",
    "master_password_missing",
    "invalid_master_password",
    "locked",
    "vault_not_found",
    "passkey_item_not_found",
    "tag_name_empty",
    "tag_not_found",
    "vault_name_empty",
    "vault_destination_required",
    "vault_last_one",
    "vault_last_open",
    "relation_self",
    "relation_cycle",
    "relation_item_not_found",
    "item_has_relations",
    "item_relations_block_move",
    "invalid_icon_mode",
    "item_not_found",
    "empty_character_set",
    "database",
    "crypto",
    "serialization",
    "no_data_directory",
    "filesystem",
    "import_unreadable",
    "import_not_1pux",
    "import_bad_json",
    "import_no_data",
    "totp_invalid_secret",
    "clock",
    "passkey_rp_mismatch",
    "passkey_insecure_origin",
    "passkey_unsupported_algorithm",
    "passkey_bad_encoding",
    "passkey_bad_key",
    "site_icon",
    "http",
    "network",
    "biometric_unavailable",
    "biometric_timeout",
    "biometric_failed",
    "biometric_needs_password",
    "database_init",
    "autostart",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_errors_serialize_with_a_code() {
        let value = serde_json::to_value(CommandError::from(VaultError::InvalidMasterPassword)).unwrap();
        assert_eq!(value["code"], "invalid_master_password");
        assert_eq!(value["message"], "invalid master password");
        assert!(value.get("detail").is_none());
        assert!(value.get("status").is_none());
    }

    #[test]
    fn wrapper_errors_keep_the_inner_text_as_detail() {
        let error = CommandError::from(StorageError::Filesystem(std::io::Error::other("disk full")));
        assert_eq!(error.code, "filesystem");
        assert_eq!(error.detail.as_deref(), Some("disk full"));
    }

    #[test]
    fn import_errors_from_the_vault_keep_the_vault_code() {
        let error = CommandError::from(Import1PuxError::Vault(VaultError::Locked));
        assert_eq!(error.code, "locked");
        assert_eq!(CommandError::from(Import1PuxError::NoData).code, "import_no_data");
    }

    /// The frontend translates by code; a code it does not list would show the generic line only.
    #[test]
    fn every_code_is_known_to_the_frontend() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/app/errors.ts");
        let source = std::fs::read_to_string(path).expect("src/app/errors.ts");
        let missing: Vec<&str> =
            CODES.iter().copied().filter(|code| !source.contains(&format!("'{code}'"))).collect();
        assert!(missing.is_empty(), "codes missing from errors.ts: {missing:?}");
    }
}
