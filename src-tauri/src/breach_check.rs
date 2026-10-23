use crate::vault::LoginItem;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use thiserror::Error;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct BreachCheckResult {
    pub breached_passwords: Vec<String>,
}

#[derive(Debug, Error)]
pub enum BreachCheckError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
}

pub fn check_breached_passwords(
    items: &[LoginItem],
) -> Result<BreachCheckResult, BreachCheckError> {
    let client = Client::builder().user_agent("Mimatory").build()?;
    let mut breached_passwords = Vec::new();

    for item in items {
        if item.password.is_empty() {
            continue;
        }
        let (prefix, suffix) = sha1_prefix_suffix(&item.password);
        let response = client
            .get(format!("https://api.pwnedpasswords.com/range/{prefix}"))
            .send()?
            .text()?;
        if response
            .lines()
            .filter_map(|line| line.split_once(':'))
            .any(|(candidate, count)| {
                candidate.eq_ignore_ascii_case(&suffix) && count.trim() != "0"
            })
        {
            breached_passwords.push(item.title.clone());
        }
    }

    Ok(BreachCheckResult { breached_passwords })
}

pub fn sha1_prefix_suffix(password: &str) -> (String, String) {
    let digest = Sha1::digest(password.as_bytes());
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<String>();
    (hex[..5].to_string(), hex[5..].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_prefix_suffix_matches_known_password_hash() {
        let (prefix, suffix) = sha1_prefix_suffix("password");

        assert_eq!(prefix, "5BAA6");
        assert_eq!(suffix, "1E4C9B93F3F0682250B6CF8331B7EE68FD8");
    }
}
