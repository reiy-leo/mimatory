use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

type HmacSha1 = Hmac<Sha1>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct TotpCode {
    pub code: String,
    pub seconds_remaining: u64,
}

#[derive(Debug, Error)]
pub enum TotpError {
    #[error("invalid TOTP secret")]
    InvalidSecret,
    #[error("clock error")]
    Clock,
}

pub fn generate_totp_now(secret: &str) -> Result<TotpCode, TotpError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| TotpError::Clock)?
        .as_secs();
    generate_totp_at(secret, now)
}

pub fn generate_totp_at(secret: &str, unix_seconds: u64) -> Result<TotpCode, TotpError> {
    let secret = normalize_secret(secret);
    let key = BASE32_NOPAD
        .decode(secret.as_bytes())
        .map_err(|_| TotpError::InvalidSecret)?;
    let counter = unix_seconds / 30;
    let mut mac = HmacSha1::new_from_slice(&key).map_err(|_| TotpError::InvalidSecret)?;
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[19] & 0x0f) as usize;
    let binary = ((u32::from(digest[offset]) & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    let code = binary % 1_000_000;
    Ok(TotpCode {
        code: format!("{code:06}"),
        seconds_remaining: 30 - (unix_seconds % 30),
    })
}

fn normalize_secret(secret: &str) -> String {
    secret
        .trim()
        .replace(' ', "")
        .replace('=', "")
        .to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_totp_matches_rfc_vector_truncated_to_six_digits() {
        let code = generate_totp_at("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59).expect("totp");

        assert_eq!(code.code, "287082");
        assert_eq!(code.seconds_remaining, 1);
    }
}
