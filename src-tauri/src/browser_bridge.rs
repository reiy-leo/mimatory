use crate::storage;
use crate::vault::{
    default_match_type, sign_in_provider_of, ItemUrl, LoginItem, LoginItemInput, LoginItemUpdate,
    PasskeyTarget, Session, VaultService,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Method, Response, Server, StatusCode};

pub type SharedSession = Arc<Mutex<Option<Session>>>;
pub type SharedBridgeToken = Arc<Mutex<Option<String>>>;

#[derive(Deserialize)]
struct FillRequest {
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
    fn from(item: LoginItem) -> Self {
        let sign_in_with = sign_in_provider_of(&item);
        Self { item, sign_in_with }
    }
}

#[derive(Serialize)]
struct BridgeError {
    error: String,
}

pub fn start_browser_bridge(session: SharedSession, bridge_token: SharedBridgeToken) {
    thread::spawn(move || {
        let Ok(server) = Server::http("127.0.0.1:17891") else {
            return;
        };

        for mut request in server.incoming_requests() {
            let method = request.method().clone();
            let path = request.url().to_string();
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
                        Ok(input) => match list_matches(&session, &input.origin) {
                            Ok(items) => json_response(&items),
                            Err(error) => error_response(StatusCode(423), error),
                        },
                        Err(error) => error_response(StatusCode(400), error.to_string()),
                    }
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
                _ => error_response(StatusCode(404), "not found".to_string()),
            };
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
        )
        .map_err(|error| error.to_string())
}

fn authorize(request: &tiny_http::Request, bridge_token: &SharedBridgeToken) -> Result<(), String> {
    let expected = bridge_token
        .lock()
        .map_err(|_| "bridge token lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "browser extension is not paired".to_string())?;
    let provided = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("X-Passless-Token"))
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

fn list_matches(session: &SharedSession, origin: &str) -> Result<Vec<BridgeMatch>, String> {
    let session = current_session(session)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    service
        .list_login_items_for_origin_everywhere(&session, origin)
        .map(|items| items.into_iter().map(BridgeMatch::from).collect())
        .map_err(|error| error.to_string())
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
            Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").expect("header"),
        )
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                .expect("header"),
        )
        .with_header(Header::from_bytes("Content-Type", "application/json").expect("header"))
}

#[cfg(test)]
mod tests {
    use super::{tokens_match, BridgeMatch};
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
    fn pairing_tokens_must_match_completely() {
        assert!(tokens_match("a-long-pairing-token", "a-long-pairing-token"));
        assert!(!tokens_match("a-long-pairing-token", "a-long-pairing-tokeX"));
        assert!(!tokens_match("a-long-pairing-token", "a-long-pairing-to"));
        assert!(!tokens_match("", "a-long-pairing-token"));
    }
}
