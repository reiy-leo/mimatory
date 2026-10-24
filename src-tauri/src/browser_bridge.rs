use crate::favicon;
use crate::passkey::{self, PASSKEY_CREDENTIAL_FIELD};
use crate::site_match;
use crate::storage;
use crate::vault::{
    default_match_type, sign_in_provider_of, ItemUrl, LoginItem, LoginItemInput, LoginItemUpdate,
    PasskeyTarget, Session, VaultService,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

pub type SharedSession = Arc<Mutex<Option<Session>>>;
pub type SharedBridgeToken = Arc<Mutex<Option<String>>>;

#[derive(Deserialize)]
struct FillRequest {
    origin: String,
    /// The one item the user picked in the float or the field menu. Absent (an old caller, the
    /// popup's Fill, Open & Fill) means every match for the page, as before.
    #[serde(default)]
    item_id: Option<String>,
}

/// `/match`: the page's logins as summaries, for the one-click float and the field menu.
#[derive(Deserialize)]
struct MatchRequest {
    origin: String,
}

#[derive(Deserialize)]
struct SaveRequest {
    title: String,
    username: String,
    password: String,
    website: String,
}

#[derive(Deserialize)]
struct PasskeyEventRequest {
    event_type: String,
    origin: String,
    rp_id: String,
    user_name: String,
    /// The login the user picked in the extension's save prompt.
    #[serde(default)]
    item_id: Option<String>,
    /// The prompt's "New Item" choice.
    #[serde(default)]
    new_item: bool,
}

/// A match as the extension receives it: the item exactly as before, plus the provider of a
/// "Sign in with…" item (`google`, …, or the name the user typed) so the popup can say "Sign in
/// with Google" instead of filling a password. Only the provider crosses — never the linked
/// account item, its title or its username.
#[derive(Serialize)]
struct BridgeMatch {
    #[serde(flatten)]
    item: LoginItem,
    #[serde(skip_serializing_if = "Option::is_none")]
    sign_in_with: Option<String>,
}

impl From<LoginItem> for BridgeMatch {
    fn from(mut item: LoginItem) -> Self {
        let sign_in_with = sign_in_provider_of(&item);
        // A passkey's private key stays in the app: the extension gets signatures, never the key.
        item.custom_fields.retain(|field| field.field_type != PASSKEY_CREDENTIAL_FIELD);
        Self { item, sign_in_with }
    }
}

/// One login the extension may offer on a page, without anything secret in it: no password, no
/// one-time-code seed, no notes, no custom field. The extension asks `/fill` for the item only once
/// the user picked it (2026-10-24, the one-click sign-in float). `icon` is the site's icon from the
/// app's encrypted cache when one is there (never fetched for this), else the letter badge.
#[derive(Debug, Serialize)]
struct MatchSummary {
    id: String,
    title: String,
    username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sign_in_with: Option<String>,
    /// Whether there is a password to fill at all (a passkey-only login has none): a yes/no, never
    /// the value.
    has_password: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_used_at: Option<String>,
    use_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
}

impl MatchSummary {
    fn from_item(item: &LoginItem, icon: Option<String>) -> Self {
        Self {
            id: item.id.clone(),
            title: item.title.clone(),
            username: item.username.clone(),
            sign_in_with: sign_in_provider_of(item),
            has_password: !item.password.is_empty(),
            last_used_at: item.last_used_at.clone(),
            use_count: item.use_count,
            icon,
        }
    }
}

/// Most recently used first (the float shows the first one); never-used items keep the bridge's
/// order (open vault first, then most recently edited) after them. Stored stamps are all
/// `Utc::now().to_rfc3339()`, so they order as strings.
fn order_by_recent_use(items: &mut [LoginItem]) {
    items.sort_by(|a, b| match (&a.last_used_at, &b.last_used_at) {
        (Some(a), Some(b)) => b.cmp(a),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
}

/// The host whose cached icon an item's tile shows: its first address, unless the user chose the
/// letter tile — the same rule as `itemIconDomain` in the window.
fn icon_domain(item: &LoginItem) -> Option<String> {
    if item.icon_mode == "letter" {
        return None;
    }
    let first = if item.website.trim().is_empty() {
        item.urls.first().map(|url| url.url.as_str()).unwrap_or("")
    } else {
        item.website.as_str()
    };
    let site = site_match::parse_site(first)?;
    if site.is_ip {
        return None;
    }
    favicon::normalize_domain(&site.host).ok()
}

/// `navigator.credentials.create()` handed to Mimatory (all binary values base64url).
#[derive(Deserialize)]
struct PasskeyCreateRequest {
    origin: String,
    #[serde(default)]
    rp_id: String,
    challenge: String,
    user_id: String,
    #[serde(default)]
    user_name: String,
    #[serde(default)]
    user_display_name: String,
    #[serde(default)]
    algorithms: Vec<i64>,
    #[serde(default)]
    exclude_credentials: Vec<String>,
    #[serde(default)]
    item_id: Option<String>,
    #[serde(default)]
    new_item: bool,
}

/// The accounts Mimatory can sign in with on this page: by RP ID, narrowed to the site's allow list.
#[derive(Deserialize)]
struct PasskeyListRequest {
    origin: String,
    #[serde(default)]
    rp_id: String,
    #[serde(default)]
    allow_credentials: Vec<String>,
}

#[derive(Deserialize)]
struct PasskeyGetRequest {
    origin: String,
    #[serde(default)]
    rp_id: String,
    challenge: String,
    credential_id: String,
}

/// One sign-in choice: what the picker shows, never the key.
#[derive(Serialize)]
struct PasskeyChoice {
    item_id: String,
    title: String,
    user_name: String,
    credential_id: String,
}

#[derive(Serialize)]
struct BridgeError {
    error: String,
}

pub fn start_browser_bridge(session: SharedSession, bridge_token: SharedBridgeToken, app: AppHandle) {
    thread::spawn(move || {
        let Ok(server) = Server::http("127.0.0.1:17891") else {
            return;
        };

        for mut request in server.incoming_requests() {
            let method = request.method().clone();
            let path = request.url().to_string();
            let mut writes =
                matches!(path.as_str(), "/save" | "/passkey-event" | "/passkey/create" | "/passkey/get");
            let response = match (method, path.as_str()) {
                (Method::Get, "/health") => json_response(&serde_json::json!({ "ok": true })),
                (Method::Options, _) => empty_response(),
                (Method::Post, "/fill") => {
                    if let Err(error) = authorize(&request, &bridge_token) {
                        let _ = request.respond(error_response(StatusCode(401), error));
                        continue;
                    }
                    let request_body = read_body(&mut request);
                    match serde_json::from_str::<FillRequest>(&request_body) {
                        Ok(input) => {
                            // A pick counts as a use (it orders the next float), so the window re-lists.
                            writes = input.item_id.is_some();
                            match list_matches(&session, &input.origin, input.item_id.as_deref()) {
                                Ok(items) => json_response(&items),
                                Err(error) => error_response(StatusCode(423), error),
                            }
                        }
                        Err(error) => error_response(StatusCode(400), error.to_string()),
                    }
                }
                (Method::Post, "/match") => {
                    if let Err(error) = authorize(&request, &bridge_token) {
                        let _ = request.respond(error_response(StatusCode(401), error));
                        continue;
                    }
                    let request_body = read_body(&mut request);
                    match serde_json::from_str::<MatchRequest>(&request_body) {
                        Ok(input) => match list_match_summaries(&session, &input.origin) {
                            Ok(items) => json_response(&items),
                            Err(error) => error_response(StatusCode(423), error),
                        },
                        Err(error) => error_response(StatusCode(400), error.to_string()),
                    }
                }
                // The float's "Unlock 密码库存": bring the main window (its lock screen) forward. The
                // master password is only ever typed there, never in a page.
                (Method::Post, "/unlock") => {
                    if let Err(error) = authorize(&request, &bridge_token) {
                        let _ = request.respond(error_response(StatusCode(401), error));
                        continue;
                    }
                    let unlocked = current_session(&session).is_ok();
                    if !unlocked {
                        show_main_window(&app);
                    }
                    json_response(&serde_json::json!({ "unlocked": unlocked }))
                }
                (Method::Post, "/save") => {
                    if let Err(error) = authorize(&request, &bridge_token) {
                        let _ = request.respond(error_response(StatusCode(401), error));
                        continue;
                    }
                    let request_body = read_body(&mut request);
                    match serde_json::from_str::<SaveRequest>(&request_body) {
                        Ok(input) => match save_login(&session, input) {
                            Ok(item) => json_response(&item),
                            Err(error) => error_response(StatusCode(423), error),
                        },
                        Err(error) => error_response(StatusCode(400), error.to_string()),
                    }
                }
                (Method::Post, "/passkey-event") => {
                    if let Err(error) = authorize(&request, &bridge_token) {
                        let _ = request.respond(error_response(StatusCode(401), error));
                        continue;
                    }
                    let request_body = read_body(&mut request);
                    match serde_json::from_str::<PasskeyEventRequest>(&request_body) {
                        Ok(input) => match save_passkey_event(&session, input) {
                            Ok(item) => json_response(&item),
                            Err(error) => error_response(StatusCode(423), error),
                        },
                        Err(error) => error_response(StatusCode(400), error.to_string()),
                    }
                }
                (Method::Post, "/passkey/create" | "/passkey/list" | "/passkey/get") => {
                    if let Err(error) = authorize(&request, &bridge_token) {
                        let _ = request.respond(error_response(StatusCode(401), error));
                        continue;
                    }
                    let request_body = read_body(&mut request);
                    let result = match path.as_str() {
                        "/passkey/create" => serde_json::from_str::<PasskeyCreateRequest>(&request_body)
                            .map_err(|error| (StatusCode(400), error.to_string()))
                            .and_then(|input| create_passkey(&session, input))
                            .map(|value| json_response(&value)),
                        "/passkey/list" => serde_json::from_str::<PasskeyListRequest>(&request_body)
                            .map_err(|error| (StatusCode(400), error.to_string()))
                            .and_then(|input| list_passkeys(&session, input))
                            .map(|value| json_response(&value)),
                        _ => serde_json::from_str::<PasskeyGetRequest>(&request_body)
                            .map_err(|error| (StatusCode(400), error.to_string()))
                            .and_then(|input| sign_with_passkey(&session, input))
                            .map(|value| json_response(&value)),
                    };
                    result.unwrap_or_else(|(status, error)| error_response(status, error))
                }
                _ => error_response(StatusCode(404), "not found".to_string()),
            };
            // Anything the extension saved shows up in the open window without a manual refresh.
            if writes && response.status_code().0 < 300 {
                let _ = app.emit("vault:changed", ());
            }
            let _ = request.respond(response);
        }
    });
}

fn save_passkey_event(
    session: &SharedSession,
    input: PasskeyEventRequest,
) -> Result<LoginItem, String> {
    let session = current_session(session)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let target = if input.new_item {
        PasskeyTarget::NewItem
    } else if let Some(id) = input.item_id.filter(|id| !id.trim().is_empty()) {
        PasskeyTarget::Item(id)
    } else {
        PasskeyTarget::Matching
    };
    service
        .save_passkey_everywhere(
            &session,
            input.event_type == "create",
            &input.origin,
            &input.rp_id,
            &input.user_name,
            &target,
            None,
        )
        .map_err(|error| error.to_string())
}

type BridgeResult<T> = Result<T, (StatusCode, String)>;

fn locked(error: String) -> (StatusCode, String) {
    (StatusCode(423), error)
}

fn bad_request(error: passkey::PasskeyError) -> (StatusCode, String) {
    (StatusCode(400), error.to_string())
}

/// Registers a new passkey on the item the user picked (or a matching / new login), across the open vaults.
fn create_passkey(session: &SharedSession, input: PasskeyCreateRequest) -> BridgeResult<passkey::Registration> {
    let session = current_session(session).map_err(locked)?;
    let rp_id = passkey::check_rp_id(&input.origin, &input.rp_id).map_err(bad_request)?;
    let connection = storage::open_default_database().map_err(|error| locked(error.to_string()))?;
    let mut service = VaultService::new(connection);
    let held = service
        .passkey_credentials_everywhere(&session, &rp_id)
        .map_err(|error| locked(error.to_string()))?;
    // excludeCredentials: the site already has one of these for this account (409 冲突).
    let excluded = input.exclude_credentials.iter().map(|id| id.trim_end_matches('=')).collect::<Vec<_>>();
    if held.iter().any(|(_, _, stored)| excluded.contains(&stored.credential_id.as_str())) {
        return Err((StatusCode(409), "excluded".to_string()));
    }
    let created = passkey::create(&passkey::CreateRequest {
        origin: &input.origin,
        rp_id: &rp_id,
        challenge: &input.challenge,
        user_handle: &input.user_id,
        user_name: &input.user_name,
        user_display_name: &input.user_display_name,
        algorithms: &input.algorithms,
    })
    .map_err(bad_request)?;
    let target = if input.new_item {
        PasskeyTarget::NewItem
    } else if let Some(id) = input.item_id.filter(|id| !id.trim().is_empty()) {
        PasskeyTarget::Item(id)
    } else {
        PasskeyTarget::Matching
    };
    let account = if input.user_name.trim().is_empty() { &input.user_display_name } else { &input.user_name };
    service
        .save_passkey_everywhere(&session, true, &input.origin, &rp_id, account, &target, Some(&created.stored))
        .map_err(|error| locked(error.to_string()))?;
    Ok(created.registration)
}

fn list_passkeys(session: &SharedSession, input: PasskeyListRequest) -> BridgeResult<Vec<PasskeyChoice>> {
    let session = current_session(session).map_err(locked)?;
    let rp_id = passkey::check_rp_id(&input.origin, &input.rp_id).map_err(bad_request)?;
    let connection = storage::open_default_database().map_err(|error| locked(error.to_string()))?;
    let service = VaultService::new(connection);
    let allowed = input.allow_credentials.iter().map(|id| id.trim_end_matches('=')).collect::<Vec<_>>();
    Ok(service
        .passkey_credentials_everywhere(&session, &rp_id)
        .map_err(|error| locked(error.to_string()))?
        .into_iter()
        .filter(|(_, _, stored)| allowed.is_empty() || allowed.contains(&stored.credential_id.as_str()))
        .map(|(_, item, stored)| PasskeyChoice {
            item_id: item.id,
            title: item.title,
            user_name: if stored.user_name.is_empty() { stored.user_display_name } else { stored.user_name },
            credential_id: stored.credential_id,
        })
        .collect())
}

fn sign_with_passkey(session: &SharedSession, input: PasskeyGetRequest) -> BridgeResult<passkey::Assertion> {
    let session = current_session(session).map_err(locked)?;
    let rp_id = passkey::check_rp_id(&input.origin, &input.rp_id).map_err(bad_request)?;
    let connection = storage::open_default_database().map_err(|error| locked(error.to_string()))?;
    let mut service = VaultService::new(connection);
    let wanted = input.credential_id.trim_end_matches('=');
    let (vault, item, stored) = service
        .passkey_credentials_everywhere(&session, &rp_id)
        .map_err(|error| locked(error.to_string()))?
        .into_iter()
        .find(|(_, _, stored)| stored.credential_id == wanted)
        .ok_or_else(|| (StatusCode(404), "passkey not found".to_string()))?;
    let assertion = passkey::assert(&stored, &input.origin, &rp_id, &input.challenge).map_err(bad_request)?;
    // A passkey sign-in counts as a use, like copying a password or Open & Fill.
    let _ = service.record_item_use(&vault, &item.id);
    Ok(assertion)
}

const TOKEN_HEADER: &str = "X-Mimatory-Token";
const LEGACY_TOKEN_HEADER: &str = "X-Passless-Token";

fn authorize(request: &tiny_http::Request, bridge_token: &SharedBridgeToken) -> Result<(), String> {
    let expected = bridge_token
        .lock()
        .map_err(|_| "bridge token lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "browser extension is not paired".to_string())?;
    let provided = request
        .headers()
        .iter()
        .find(|header| header.field.equiv(TOKEN_HEADER))
        // An extension from before the 2026-10-23 rename (Passless) still sends the old header name.
        .or_else(|| request.headers().iter().find(|header| header.field.equiv(LEGACY_TOKEN_HEADER)))
        .map(|header| header.value.as_str().to_string())
        .unwrap_or_default();
    if tokens_match(&provided, &expected) {
        Ok(())
    } else {
        Err("invalid browser pairing token".to_string())
    }
}

/// Any local process can read the pairing token out of the extension's storage, so the
/// bridge only slows down guessing: comparing every byte instead of returning at the
/// first mismatch keeps the answer time independent of how much of the token was right.
fn tokens_match(provided: &str, expected: &str) -> bool {
    let provided = provided.as_bytes();
    let expected = expected.as_bytes();
    if provided.len() != expected.len() {
        return false;
    }
    provided
        .iter()
        .zip(expected)
        .fold(0_u8, |differences, (a, b)| differences | (a ^ b))
        == 0
}

fn list_matches(
    session: &SharedSession,
    origin: &str,
    item_id: Option<&str>,
) -> Result<Vec<BridgeMatch>, String> {
    let session = current_session(session)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let mut items = service
        .list_login_items_for_origin_everywhere(&session, origin)
        .map_err(|error| error.to_string())?;
    if let Some(item_id) = item_id {
        // Still the origin's own matches: an id from another site finds nothing.
        items.retain(|item| item.id == item_id);
        for item in &items {
            let _ = service.record_item_use(&session.for_vault(&item.vault_id), &item.id);
        }
    }
    Ok(items.into_iter().map(BridgeMatch::from).collect())
}

/// The same matches as `/fill` (same origin rules, "never" addresses excluded), as summaries.
fn list_match_summaries(session: &SharedSession, origin: &str) -> Result<Vec<MatchSummary>, String> {
    let session = current_session(session)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let mut items = service
        .list_login_items_for_origin_everywhere(&session, origin)
        .map_err(|error| error.to_string())?;
    order_by_recent_use(&mut items);
    let domains = items.iter().filter_map(icon_domain).collect::<Vec<_>>();
    // Cache only; a failure just means letter badges.
    let icons = service.cached_site_icons(&session, &domains).unwrap_or_default();
    Ok(items
        .iter()
        .map(|item| {
            let icon = icon_domain(item)
                .and_then(|domain| icons.get(&domain))
                .and_then(|cached| cached.icon.clone());
            MatchSummary::from_item(item, icon)
        })
        .collect())
}

fn show_main_window(app: &AppHandle) {
    use tauri::Manager;
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

fn save_login(session: &SharedSession, input: SaveRequest) -> Result<LoginItem, String> {
    let session = current_session(session)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    // Every open vault (owner 2026-10-18): a password change updates the login in the vault it lives in;
    // a login seen for the first time is saved to the open vault.
    let existing = service
        .find_site_login_everywhere(&session, &input.website, &input.username)
        .map_err(|error| error.to_string())?;
    if let Some((vault, existing)) = existing {
        return service
            .update_login_item(
                &vault,
                LoginItemUpdate {
                    id: existing.id,
                    item_type: "login".to_string(),
                    title: if input.title.trim().is_empty() {
                        input.website.clone()
                    } else {
                        input.title
                    },
                    username: input.username,
                    password: input.password,
                    // Only the password changed: the item's websites, their labels, order and autofill
                    // behaviours are the user's, so an update from the extension keeps them all.
                    website: existing.website,
                    urls: existing.urls,
                    notes: existing.notes,
                    tags: existing.tags,
                    custom_fields: existing.custom_fields,
                    favorite: existing.favorite,
                },
            )
            .map_err(|error| error.to_string());
    }

    service
        .create_login_item(
            &session,
            LoginItemInput {
                item_type: "login".to_string(),
                title: if input.title.trim().is_empty() {
                    input.website.clone()
                } else {
                    input.title
                },
                username: input.username,
                password: input.password,
                website: input.website.clone(),
                urls: vec![ItemUrl {
                    label: "website".to_string(),
                    url: input.website,
                    match_type: default_match_type(),
                }],
                notes: "Saved from browser extension".to_string(),
                tags: vec!["browser".to_string()],
                custom_fields: vec![],
                favorite: false,
            },
        )
        .map_err(|error| error.to_string())
}

fn current_session(session: &SharedSession) -> Result<Session, String> {
    session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "vault is locked".to_string())
}

fn read_body(request: &mut tiny_http::Request) -> String {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    body
}

fn json_response<T: Serialize>(value: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    with_cors(Response::from_data(body))
}

fn empty_response() -> Response<std::io::Cursor<Vec<u8>>> {
    with_cors(Response::from_data(Vec::new())).with_status_code(StatusCode(204))
}

fn error_response(status: StatusCode, error: String) -> Response<std::io::Cursor<Vec<u8>>> {
    with_cors(Response::from_data(
        serde_json::to_vec(&BridgeError { error }).unwrap_or_default(),
    ))
    .with_status_code(status)
}

fn with_cors(response: Response<std::io::Cursor<Vec<u8>>>) -> Response<std::io::Cursor<Vec<u8>>> {
    response
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").expect("header"))
        .with_header(
            Header::from_bytes(
                "Access-Control-Allow-Headers",
                "Content-Type, X-Mimatory-Token, X-Passless-Token",
            )
            .expect("header"),
        )
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                .expect("header"),
        )
        .with_header(Header::from_bytes("Content-Type", "application/json").expect("header"))
}

#[cfg(test)]
mod tests {
    use super::{order_by_recent_use, tokens_match, BridgeMatch, MatchSummary};
    use crate::vault::{CustomField, LoginItem};

    fn item(fields: Vec<CustomField>) -> LoginItem {
        LoginItem {
            id: "id".into(),
            item_type: "login".into(),
            title: "Figma".into(),
            username: "rei@example.com".into(),
            password: String::new(),
            website: "https://figma.com".into(),
            urls: vec![],
            notes: String::new(),
            tags: vec![],
            custom_fields: fields,
            favorite: false,
            updated_at: String::new(),
            created_at: String::new(),
            use_count: 0,
            last_used_at: None,
            vault_id: String::new(),
            relations: Default::default(),
            icon_mode: "auto".into(),
        }
    }

    #[test]
    fn a_sign_in_with_match_tells_the_extension_the_provider_only() {
        let field = CustomField { label: String::new(), value: "google".into(), field_type: "sign_in_with".into() };
        let json = serde_json::to_value(BridgeMatch::from(item(vec![field]))).unwrap();
        assert_eq!(json["sign_in_with"], "google");
        assert_eq!(json["title"], "Figma");
        assert!(json.get("relations").is_none());
        assert!(json.get("icon_mode").is_none());

        let plain = serde_json::to_value(BridgeMatch::from(item(vec![]))).unwrap();
        assert!(plain.get("sign_in_with").is_none());
    }

    #[test]
    fn a_match_summary_carries_nothing_secret() {
        let otp = CustomField { label: "otp".into(), value: "JBSWY3DPEHPK3PXP".into(), field_type: "otp".into() };
        let mut login = item(vec![otp]);
        login.password = "hunter2-secret".into();
        login.notes = "the notes".into();
        let json = serde_json::to_value(MatchSummary::from_item(&login, None)).unwrap();
        let object = json.as_object().unwrap();
        for key in ["password", "notes", "custom_fields", "urls", "totp", "relations"] {
            assert!(!object.contains_key(key), "{key} must not cross /match");
        }
        let text = json.to_string();
        assert!(!text.contains("hunter2-secret"));
        assert!(!text.contains("JBSWY3DPEHPK3PXP"));
        assert_eq!(json["title"], "Figma");
        assert_eq!(json["username"], "rei@example.com");
        assert_eq!(json["has_password"], true);
        assert!(object.get("icon").is_none());
    }

    #[test]
    fn matches_are_ordered_by_most_recent_use() {
        let mut never = item(vec![]);
        never.id = "never".into();
        let mut old = item(vec![]);
        old.id = "old".into();
        old.last_used_at = Some("2026-01-01T00:00:00+00:00".into());
        let mut new = item(vec![]);
        new.id = "new".into();
        new.last_used_at = Some("2026-10-01T00:00:00+00:00".into());
        let mut items = vec![never, old, new];
        order_by_recent_use(&mut items);
        let ids = items.iter().map(|item| item.id.as_str()).collect::<Vec<_>>();
        assert_eq!(ids, ["new", "old", "never"]);
    }

    #[test]
    fn pairing_tokens_must_match_completely() {
        assert!(tokens_match("a-long-pairing-token", "a-long-pairing-token"));
        assert!(!tokens_match("a-long-pairing-token", "a-long-pairing-tokeX"));
        assert!(!tokens_match("a-long-pairing-token", "a-long-pairing-to"));
        assert!(!tokens_match("", "a-long-pairing-token"));
    }
}
