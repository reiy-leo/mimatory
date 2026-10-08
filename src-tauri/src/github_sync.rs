use crate::crypto::{decrypt_string, encrypt_string, CryptoError, EncryptedPayload};
use crate::vault::{LoginItem, LoginItemInput, Session};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GitHubSyncConfig {
    pub repo_url: String,
    pub token: String,
    pub branch: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SyncSnapshot {
    pub version: u32,
    pub exported_at: String,
    pub items: Vec<LoginItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SyncResult {
    pub item_count: usize,
    pub commit_sha: Option<String>,
}

#[derive(Debug, Error)]
pub enum GitHubSyncError {
    #[error("invalid GitHub repo URL")]
    InvalidRepoUrl,
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("github api error: {0}")]
    GitHub(String),
    #[error("crypto error: {0}")]
    Crypto(#[from] CryptoError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug)]
struct RepoParts {
    owner: String,
    repo: String,
}

#[derive(Deserialize)]
struct ContentResponse {
    content: Option<String>,
    sha: Option<String>,
}

#[derive(Deserialize)]
struct PutResponse {
    commit: CommitResponse,
}

#[derive(Deserialize)]
struct CommitResponse {
    sha: String,
}

pub fn upload_snapshot(
    session: &Session,
    config: &GitHubSyncConfig,
    items: Vec<LoginItem>,
) -> Result<SyncResult, GitHubSyncError> {
    let snapshot = SyncSnapshot {
        version: 1,
        exported_at: Utc::now().to_rfc3339(),
        items,
    };
    let encrypted = encrypt_string(session.key(), &serde_json::to_string(&snapshot)?)?;
    let body = serde_json::to_vec(&encrypted)?;
    let repo = parse_repo_url(&config.repo_url)?;
    let client = github_client(config)?;
    let api_url = content_url(&repo, &config.path);
    let existing_sha = get_existing_sha(&client, config, &api_url)?;

    let mut payload = serde_json::json!({
        "message": "Update Passless encrypted vault",
        "content": BASE64.encode(body),
        "branch": normalized_branch(config),
    });
    if let Some(sha) = existing_sha {
        payload["sha"] = serde_json::Value::String(sha);
    }

    let response = client.put(api_url).json(&payload).send()?;
    if !response.status().is_success() {
        return Err(GitHubSyncError::GitHub(response.text()?));
    }
    let response: PutResponse = response.json()?;
    Ok(SyncResult {
        item_count: snapshot.items.len(),
        commit_sha: Some(response.commit.sha),
    })
}

pub fn download_snapshot(
    session: &Session,
    config: &GitHubSyncConfig,
) -> Result<Vec<LoginItemInput>, GitHubSyncError> {
    let repo = parse_repo_url(&config.repo_url)?;
    let client = github_client(config)?;
    let response = client
        .get(content_url(&repo, &config.path))
        .query(&[("ref", normalized_branch(config))])
        .send()?;
    if !response.status().is_success() {
        return Err(GitHubSyncError::GitHub(response.text()?));
    }

    let content: ContentResponse = response.json()?;
    let encoded = content
        .content
        .ok_or_else(|| GitHubSyncError::GitHub("missing content".to_string()))?
        .replace('\n', "");
    let encrypted_bytes = BASE64
        .decode(encoded)
        .map_err(|_| GitHubSyncError::GitHub("invalid base64 content".to_string()))?;
    let payload: EncryptedPayload = serde_json::from_slice(&encrypted_bytes)?;
    let snapshot: SyncSnapshot = serde_json::from_str(&decrypt_string(session.key(), &payload)?)?;

    Ok(snapshot
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

fn get_existing_sha(
    client: &Client,
    config: &GitHubSyncConfig,
    api_url: &str,
) -> Result<Option<String>, GitHubSyncError> {
    let response = client
        .get(api_url)
        .query(&[("ref", normalized_branch(config))])
        .send()?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(GitHubSyncError::GitHub(response.text()?));
    }
    Ok(response.json::<ContentResponse>()?.sha)
}

fn github_client(config: &GitHubSyncConfig) -> Result<Client, GitHubSyncError> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(USER_AGENT, "Passless".parse().expect("static header"));
    headers.insert(
        ACCEPT,
        "application/vnd.github+json"
            .parse()
            .expect("static header"),
    );
    headers.insert(
        AUTHORIZATION,
        format!("Bearer {}", config.token)
            .parse()
            .map_err(|_| GitHubSyncError::GitHub("invalid token".to_string()))?,
    );
    Ok(Client::builder().default_headers(headers).build()?)
}

fn content_url(repo: &RepoParts, path: &str) -> String {
    format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        repo.owner,
        repo.repo,
        path.trim_start_matches('/')
    )
}

fn normalized_branch(config: &GitHubSyncConfig) -> String {
    if config.branch.trim().is_empty() {
        "main".to_string()
    } else {
        config.branch.trim().to_string()
    }
}

fn parse_repo_url(repo_url: &str) -> Result<RepoParts, GitHubSyncError> {
    let trimmed = repo_url
        .trim()
        .trim_end_matches(".git")
        .trim_end_matches('/');
    let marker = "github.com/";
    let Some((_, suffix)) = trimmed.split_once(marker) else {
        return Err(GitHubSyncError::InvalidRepoUrl);
    };
    let mut parts = suffix.split('/');
    let owner = parts.next().unwrap_or_default();
    let repo = parts.next().unwrap_or_default();
    if owner.is_empty() || repo.is_empty() {
        return Err(GitHubSyncError::InvalidRepoUrl);
    }
    Ok(RepoParts {
        owner: owner.to_string(),
        repo: repo.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{initialize_database, open_database};
    use crate::vault::{LoginItemInput, VaultService};

    #[test]
    fn sync_snapshot_round_trips_through_crypto() {
        let path =
            std::env::temp_dir().join(format!("passless-sync-{}.sqlite3", uuid::Uuid::new_v4()));
        initialize_database(&path).expect("database should initialize");
        let connection = open_database(&path).expect("database should open");
        let mut service = VaultService::new(connection);
        let session = service
            .setup_master_password("master-password")
            .expect("setup");
        service
            .create_login_item(
                &session,
                LoginItemInput {
                    item_type: "login".into(),
                    title: "GitHub".into(),
                    username: "octo@example.com".into(),
                    password: "secret".into(),
                    website: "https://github.com".into(),
                    urls: vec![],
                    notes: "".into(),
                    tags: vec!["code".into()],
                    custom_fields: vec![],
                    favorite: true,
                },
            )
            .expect("item should create");

        let items = service
            .export_login_items(&session)
            .expect("items should export");
        let snapshot = SyncSnapshot {
            version: 1,
            exported_at: "now".into(),
            items,
        };
        let encrypted = encrypt_string(
            session.key(),
            &serde_json::to_string(&snapshot).expect("json"),
        )
        .expect("snapshot should encrypt");
        let decrypted: SyncSnapshot =
            serde_json::from_str(&decrypt_string(session.key(), &encrypted).expect("decrypt"))
                .expect("json should parse");

        assert_eq!(decrypted.items.len(), 1);
        assert_eq!(decrypted.items[0].title, "GitHub");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn parse_repo_url_accepts_https_urls() {
        let repo = parse_repo_url("https://github.com/example/private-vault.git")
            .expect("url should parse");
        assert_eq!(repo.owner, "example");
        assert_eq!(repo.repo, "private-vault");
    }
}
