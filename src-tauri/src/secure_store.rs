use keyring::Entry;
use thiserror::Error;

const SERVICE: &str = "app.passless.desktop";
const GITHUB_PAT_ACCOUNT: &str = "github_pat";

#[derive(Debug, Error)]
pub enum SecureStoreError {
    #[error("keychain error: {0}")]
    Keychain(#[from] keyring::Error),
}

pub fn save_github_pat(token: &str) -> Result<(), SecureStoreError> {
    Entry::new(SERVICE, GITHUB_PAT_ACCOUNT)?.set_password(token)?;
    Ok(())
}

pub fn load_github_pat() -> Result<Option<String>, SecureStoreError> {
    match Entry::new(SERVICE, GITHUB_PAT_ACCOUNT)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(SecureStoreError::Keychain(error)),
    }
}

pub fn delete_github_pat() -> Result<(), SecureStoreError> {
    match Entry::new(SERVICE, GITHUB_PAT_ACCOUNT)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(SecureStoreError::Keychain(error)),
    }
}
