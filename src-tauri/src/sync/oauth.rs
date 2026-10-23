//! Google sign-in for a desktop app: the system browser, a loopback redirect on a random
//! `127.0.0.1` port and PKCE (RFC 8252 / Google's "Desktop app" client type). Only the
//! `drive.appdata` scope is requested — non-sensitive, so the consent screen needs no verification.
//!
//! The client id (and the desktop "secret", which Google documents as non-confidential for
//! installed apps) come from the build environment: `MIMATORY_GOOGLE_CLIENT_ID` and, if the client
//! requires it, `MIMATORY_GOOGLE_CLIENT_SECRET`. Without the id the Google option reports "not
//! configured". iOS/Android need a different client type (custom scheme), so they are not wired yet.

use super::error::{SyncError, SyncResult};
use super::remote::{CONNECT_TIMEOUT, REQUEST_TIMEOUT};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
pub const AUTH_TIMEOUT: Duration = Duration::from_secs(300);

/// Set by `sync_cancel_connect` to end a waiting sign-in early.
pub static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug)]
pub struct GoogleClient {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub token_url: String,
}

/// The OAuth client compiled into this build, if any.
pub fn google_client() -> Option<GoogleClient> {
    let client_id = option_env!("MIMATORY_GOOGLE_CLIENT_ID").map(str::trim).filter(|id| !id.is_empty())?;
    let client_secret = option_env!("MIMATORY_GOOGLE_CLIENT_SECRET")
        .map(str::trim)
        .filter(|secret| !secret.is_empty())
        .map(str::to_string);
    Some(GoogleClient { client_id: client_id.to_string(), client_secret, token_url: TOKEN_URL.to_string() })
}

pub fn google_available() -> bool {
    cfg!(desktop) && google_client().is_some()
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
}

pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
}

fn http() -> SyncResult<Client> {
    Ok(Client::builder().connect_timeout(CONNECT_TIMEOUT).timeout(REQUEST_TIMEOUT).build()?)
}

fn random_url_safe(bytes: usize) -> String {
    let mut buffer = vec![0_u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn authorization_url(client: &GoogleClient, redirect_uri: &str, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(AUTH_URL).expect("static URL");
    url.query_pairs_mut()
        .append_pair("client_id", &client.client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        // A refresh token, and a fresh one each connect (Google only returns it on consent).
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    url.to_string()
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Mimatory</title>\
<body style=\"font:16px -apple-system,system-ui,sans-serif;text-align:center;padding-top:20vh\">\
<p>Mimatory 已连接 Google Drive，可以关闭此页面。</p><p>Connected. You can close this tab.</p></body>";
const FAIL_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Mimatory</title>\
<body style=\"font:16px -apple-system,system-ui,sans-serif;text-align:center;padding-top:20vh\">\
<p>授权未完成，请回到 Mimatory 重试。</p><p>Sign-in did not complete.</p></body>";

fn respond(request: tiny_http::Request, body: &str) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
        .expect("static header");
    let _ = request.respond(tiny_http::Response::from_string(body).with_header(header));
}

/// Runs the whole interactive sign-in: listens on loopback, hands the consent URL to `open`
/// (the system browser), waits for the redirect, then exchanges the code.
pub fn authorize(client: &GoogleClient, open: impl FnOnce(&str) -> SyncResult<()>) -> SyncResult<Tokens> {
    CANCEL.store(false, Ordering::SeqCst);
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| SyncError::Network(e.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or_else(|| SyncError::Network("loopback".to_string()))?;
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let verifier = random_url_safe(48); // 64 chars, within PKCE's 43–128
    let state = random_url_safe(16);
    open(&authorization_url(client, &redirect_uri, &pkce_challenge(&verifier), &state))?;

    let deadline = Instant::now() + AUTH_TIMEOUT;
    let code = loop {
        if CANCEL.load(Ordering::SeqCst) || Instant::now() >= deadline {
            return Err(SyncError::OAuthCancelled);
        }
        let Some(request) = server
            .recv_timeout(Duration::from_millis(500))
            .map_err(|e| SyncError::Network(e.to_string()))?
        else {
            continue;
        };
        let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{}", request.url())) else {
            respond(request, FAIL_PAGE);
            continue;
        };
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        if pairs.get("state").map(String::as_str) != Some(state.as_str()) {
            // Not our redirect (a favicon request, or a stray page): ignore it.
            respond(request, FAIL_PAGE);
            continue;
        }
        if pairs.contains_key("error") {
            respond(request, FAIL_PAGE);
            return Err(SyncError::OAuthCancelled);
        }
        match pairs.get("code") {
            Some(code) => {
                respond(request, DONE_PAGE);
                break code.clone();
            }
            None => respond(request, FAIL_PAGE),
        }
    };

    let mut form = vec![
        ("code", code.as_str()),
        ("client_id", client.client_id.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    if let Some(secret) = &client.client_secret {
        form.push(("client_secret", secret.as_str()));
    }
    let response = http()?.post(&client.token_url).form(&form).send()?;
    let status = response.status();
    if !status.is_success() {
        return Err(SyncError::Http { status: status.as_u16(), detail: token_error(response) });
    }
    let tokens: TokenResponse = response.json()?;
    let refresh_token = tokens
        .refresh_token
        .ok_or_else(|| SyncError::InvalidRemote("Google returned no refresh token".to_string()))?;
    Ok(Tokens { access_token: tokens.access_token, refresh_token })
}

fn token_error(response: reqwest::blocking::Response) -> String {
    response.json::<TokenError>().map(|e| e.error).unwrap_or_default()
}

/// A fresh access token from the stored refresh token. `invalid_grant` (revoked, expired, or the
/// user removed the app) means the user has to connect again.
pub fn refresh(client: &GoogleClient, refresh_token: &str) -> SyncResult<String> {
    let mut form = vec![
        ("client_id", client.client_id.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = &client.client_secret {
        form.push(("client_secret", secret.as_str()));
    }
    let response = http()?.post(&client.token_url).form(&form).send()?;
    let status = response.status();
    if !status.is_success() {
        let error = token_error(response);
        if error == "invalid_grant" || status.as_u16() == 401 {
            return Err(SyncError::GoogleReauth);
        }
        return Err(SyncError::Http { status: status.as_u16(), detail: error });
    }
    Ok(response.json::<TokenResponse>()?.access_token)
}

/// Best effort: tell Google to drop the grant on disconnect.
pub fn revoke(token: &str) {
    if let Ok(client) = http() {
        let _ = client.post(REVOKE_URL).form(&[("token", token)]).send();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        // RFC 7636 Appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn authorization_url_asks_only_for_appdata_with_pkce() {
        let client = GoogleClient { client_id: "id.apps".into(), client_secret: None, token_url: TOKEN_URL.into() };
        let url = authorization_url(&client, "http://127.0.0.1:5555", "chal", "st");
        let parsed = url::Url::parse(&url).unwrap();
        let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(pairs["scope"], SCOPE);
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["redirect_uri"], "http://127.0.0.1:5555");
        assert_eq!(pairs["access_type"], "offline");
    }
}
