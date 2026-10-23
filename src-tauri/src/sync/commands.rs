//! Tauri commands and the background trigger. Everything that touches the network runs on a
//! blocking thread (`spawn_blocking`), never on the main thread.
//!
//! Commands: `sync_status`, `sync_connect_webdav`, `sync_connect_google`, `sync_cancel_connect`,
//! `sync_unlock_remote`, `sync_disconnect`, `sync_now`, `sync_request`.
//! Events: `sync:status` (a [`SyncStatus`] after every change) and the existing `vault:changed`
//! when a round pulled anything into the local vault.
//! Failures cross the bridge as [`SyncErrorInfo`] (`{code, status, message}`), not prose.

use super::config::{self, Provider, SyncConfig};
use super::engine::{self, JoinOutcome, SyncReport};
use super::error::{SyncError, SyncErrorInfo, SyncResult};
use super::google_drive::DriveStore;
use super::local;
use super::oauth;
use super::remote::RemoteStore;
use super::webdav::{self, WebDavStore};
use crate::browser_bridge::SharedSession;
use crate::storage;
use crate::vault::Session;
use crate::AppState;
use chrono::Utc;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// After a write the UI calls `sync_request`; the round starts once writes have paused this long.
const DEBOUNCE: Duration = Duration::from_secs(3);
/// Periodic round while unlocked, to pick up other devices' changes.
const INTERVAL: Duration = Duration::from_secs(15 * 60);
const TICK: Duration = Duration::from_secs(2);

struct Runtime {
    /// Serialises rounds, connects and disconnects.
    lock: Mutex<()>,
    syncing: AtomicBool,
    last_error: Mutex<Option<SyncErrorInfo>>,
    requested_at: Mutex<Option<Instant>>,
    last_attempt: Mutex<Option<Instant>>,
}

static RUNTIME: Runtime = Runtime {
    lock: Mutex::new(()),
    syncing: AtomicBool::new(false),
    last_error: Mutex::new(None),
    requested_at: Mutex::new(None),
    last_attempt: Mutex::new(None),
};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SyncStatus {
    /// `locked` | `disconnected` | `needs_remote_password` | `syncing` | `error` | `idle`
    pub state: &'static str,
    /// `webdav` | `google` when connected.
    pub provider: Option<&'static str>,
    pub webdav_url: Option<String>,
    pub webdav_username: Option<String>,
    /// This build has a Google OAuth client and runs on desktop.
    pub google_available: bool,
    pub last_sync_at: Option<String>,
    pub last_error: Option<SyncErrorInfo>,
    pub last_report: Option<SyncReport>,
    /// Where the data lives on the remote (WebDAV folder; Drive's appDataFolder is hidden).
    pub remote_folder: &'static str,
}

static LAST_REPORT: Mutex<Option<SyncReport>> = Mutex::new(None);

fn set_error(error: Option<SyncErrorInfo>) {
    if let Ok(mut slot) = RUNTIME.last_error.lock() {
        *slot = error;
    }
}

fn info(error: SyncError) -> SyncErrorInfo {
    error.info()
}

fn open() -> SyncResult<rusqlite::Connection> {
    storage::open_default_database().map_err(|e| SyncError::Local(e.to_string()))
}

pub fn status(session: Option<&Session>) -> SyncStatus {
    let mut status = SyncStatus {
        state: "locked",
        provider: None,
        webdav_url: None,
        webdav_username: None,
        google_available: oauth::google_available(),
        last_sync_at: None,
        last_error: RUNTIME.last_error.lock().ok().and_then(|e| e.clone()),
        last_report: LAST_REPORT.lock().ok().and_then(|r| r.clone()),
        remote_folder: webdav::FOLDER,
    };
    let Some(session) = session else { return status };
    let loaded = open().and_then(|conn| config::load(&conn, session.key()));
    let config = match loaded {
        Ok(Some(config)) => config,
        Ok(None) => {
            status.state = "disconnected";
            status.last_error = None;
            return status;
        }
        Err(error) => {
            status.state = "error";
            status.last_error = Some(error.info());
            return status;
        }
    };
    status.provider = Some(config.provider.name());
    if let Provider::Webdav { url, username, .. } = &config.provider {
        status.webdav_url = Some(url.clone());
        status.webdav_username = Some(username.clone());
    }
    status.last_sync_at = config.last_sync_at.clone();
    status.state = if config.sync_key.is_none() {
        "needs_remote_password"
    } else if RUNTIME.syncing.load(Ordering::SeqCst) {
        "syncing"
    } else if status.last_error.is_some() {
        "error"
    } else {
        "idle"
    };
    status
}

fn publish(app: &AppHandle, session: Option<&Session>) -> SyncStatus {
    let status = status(session);
    let _ = app.emit("sync:status", &status);
    status
}

fn store_for(provider: &Provider) -> SyncResult<Box<dyn RemoteStore>> {
    match provider {
        Provider::Webdav { url, username, password } => Ok(Box::new(WebDavStore::new(url, username, password)?)),
        Provider::Google { refresh_token } => {
            let client = oauth::google_client().ok_or(SyncError::GoogleNotConfigured)?;
            Ok(Box::new(DriveStore::new(client, refresh_token)?))
        }
    }
}

fn sync_once(session: &Session) -> SyncResult<SyncReport> {
    let _guard = RUNTIME.lock.try_lock().map_err(|_| SyncError::Busy)?;
    let mut conn = open()?;
    let mut config = config::load(&conn, session.key())?.ok_or(SyncError::NotConnected)?;
    let sync_key = config.sync_key()?.ok_or(SyncError::RemotePasswordRequired)?;
    let mut store = store_for(&config.provider)?;
    let report = engine::run(store.as_mut(), &mut conn, session.key(), &sync_key, &config.device_id)?;
    config.last_sync_at = Some(report.at.clone());
    config::save(&conn, session.key(), &config)?;
    Ok(report)
}

/// One round with status events around it. Returns the outcome for `sync_now`.
fn run_and_publish(app: &AppHandle, session: &Session) -> Result<SyncStatus, SyncErrorInfo> {
    if let Ok(mut last) = RUNTIME.last_attempt.lock() {
        *last = Some(Instant::now());
    }
    RUNTIME.syncing.store(true, Ordering::SeqCst);
    publish(app, Some(session));
    let result = sync_once(session);
    RUNTIME.syncing.store(false, Ordering::SeqCst);
    match result {
        Ok(report) => {
            set_error(None);
            let pulled = report.pulled;
            if let Ok(mut slot) = LAST_REPORT.lock() {
                *slot = Some(report);
            }
            if pulled > 0 {
                let _ = app.emit("vault:changed", ());
            }
            Ok(publish(app, Some(session)))
        }
        Err(SyncError::Busy) => Ok(publish(app, Some(session))),
        Err(error) => {
            let info = error.info();
            set_error(Some(info.clone()));
            publish(app, Some(session));
            Err(info)
        }
    }
}

/// Stores a new connection (provider switch included): resets the base so the first round treats
/// every local record as unsynced, which uploads the full local vault to the new target (the old
/// target keeps its data).
fn connect(
    app: &AppHandle,
    session: &Session,
    provider: Provider,
    mut store: Box<dyn RemoteStore>,
) -> Result<SyncStatus, SyncErrorInfo> {
    {
        let _guard = RUNTIME.lock.lock().map_err(|_| info(SyncError::Busy))?;
        let conn = open().map_err(info)?;
        let outcome = engine::join(store.as_mut(), &conn, session.key()).map_err(info)?;
        let device_id = config::load(&conn, session.key())
            .ok()
            .flatten()
            .map(|old| old.device_id)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut config = SyncConfig {
            provider,
            device_id,
            sync_key: None,
            last_sync_at: None,
            connected_at: Utc::now().to_rfc3339(),
        };
        if let JoinOutcome::Ready(key) = &outcome {
            config.set_sync_key(key);
        }
        local::clear_base(&conn).map_err(info)?;
        config::save(&conn, session.key(), &config).map_err(info)?;
        set_error(None);
        if let Ok(mut slot) = LAST_REPORT.lock() {
            *slot = None;
        }
        if matches!(outcome, JoinOutcome::NeedsPassword) {
            return Ok(publish(app, Some(session)));
        }
    }
    run_and_publish(app, session)
}

fn session_of(state: &State<AppState>) -> Result<Session, SyncErrorInfo> {
    crate::current_session(state).map_err(|_| info(SyncError::Locked))
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, SyncErrorInfo> + Send + 'static,
) -> Result<T, SyncErrorInfo> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| info(SyncError::Local(e.to_string())))?
}

#[tauri::command(async)]
pub fn sync_status(state: State<AppState>) -> SyncStatus {
    let session = state.session.lock().ok().and_then(|s| s.clone());
    status(session.as_ref())
}

#[tauri::command]
pub async fn sync_connect_webdav(
    url: String,
    username: String,
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<SyncStatus, SyncErrorInfo> {
    let session = session_of(&state)?;
    blocking(move || {
        let url = webdav::normalize_url(&url).map_err(info)?;
        let store = WebDavStore::new(&url, username.trim(), &password).map_err(info)?;
        let provider = Provider::Webdav { url, username: username.trim().to_string(), password };
        connect(&app, &session, provider, Box::new(store))
    })
    .await
}

#[tauri::command]
pub async fn sync_connect_google(state: State<'_, AppState>, app: AppHandle) -> Result<SyncStatus, SyncErrorInfo> {
    let session = session_of(&state)?;
    blocking(move || {
        if cfg!(mobile) {
            return Err(info(SyncError::GoogleUnsupportedPlatform));
        }
        let client = oauth::google_client().ok_or_else(|| info(SyncError::GoogleNotConfigured))?;
        let tokens = oauth::authorize(&client, |url| {
            tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| SyncError::Network(e.to_string()))
        })
        .map_err(info)?;
        let store = DriveStore::with_token(client, &tokens.refresh_token, tokens.access_token).map_err(info)?;
        let provider = Provider::Google { refresh_token: tokens.refresh_token };
        connect(&app, &session, provider, Box::new(store))
    })
    .await
}

/// Ends a Google sign-in that is waiting for the browser.
#[tauri::command]
pub fn sync_cancel_connect() {
    oauth::CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn sync_unlock_remote(
    master_password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<SyncStatus, SyncErrorInfo> {
    let session = session_of(&state)?;
    blocking(move || {
        {
            let _guard = RUNTIME.lock.lock().map_err(|_| info(SyncError::Busy))?;
            let conn = open().map_err(info)?;
            let mut config = config::load(&conn, session.key())
                .map_err(info)?
                .ok_or_else(|| info(SyncError::NotConnected))?;
            let mut store = store_for(&config.provider).map_err(info)?;
            let key = engine::unlock_remote(store.as_mut(), &master_password).map_err(info)?;
            config.set_sync_key(&key);
            config::save(&conn, session.key(), &config).map_err(info)?;
        }
        run_and_publish(&app, &session)
    })
    .await
}

#[tauri::command]
pub async fn sync_disconnect(state: State<'_, AppState>, app: AppHandle) -> Result<SyncStatus, SyncErrorInfo> {
    let session = session_of(&state)?;
    blocking(move || {
        let _guard = RUNTIME.lock.lock().map_err(|_| info(SyncError::Busy))?;
        let conn = open().map_err(info)?;
        if let Ok(Some(config)) = config::load(&conn, session.key()) {
            if let Provider::Google { refresh_token } = config.provider {
                std::thread::spawn(move || oauth::revoke(&refresh_token));
            }
        }
        config::clear(&conn).map_err(info)?;
        local::clear_base(&conn).map_err(info)?;
        set_error(None);
        if let Ok(mut slot) = LAST_REPORT.lock() {
            *slot = None;
        }
        Ok(publish(&app, Some(&session)))
    })
    .await
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>, app: AppHandle) -> Result<SyncStatus, SyncErrorInfo> {
    let session = session_of(&state)?;
    blocking(move || run_and_publish(&app, &session)).await
}

/// Debounced trigger for the UI to call after any local write (and on `vault:changed` from the
/// browser bridge). Cheap; the background loop runs the round.
#[tauri::command]
pub fn sync_request() {
    if let Ok(mut slot) = RUNTIME.requested_at.lock() {
        *slot = Some(Instant::now());
    }
}

fn ready_to_sync(session: &Session) -> bool {
    open()
        .and_then(|conn| config::load(&conn, session.key()))
        .ok()
        .flatten()
        .is_some_and(|config| config.sync_key.is_some())
}

/// The automatic triggers, one thread: a round right after unlock, `DEBOUNCE` after the last
/// `sync_request`, and every `INTERVAL` while unlocked. Locked → nothing runs and no key is held.
pub fn start_background(app: AppHandle, session: SharedSession) {
    std::thread::spawn(move || {
        let mut was_unlocked = false;
        loop {
            std::thread::sleep(TICK);
            let current = session.lock().ok().and_then(|s| s.clone());
            let Some(current) = current else {
                was_unlocked = false;
                continue;
            };
            let just_unlocked = !was_unlocked;
            was_unlocked = true;
            let requested = RUNTIME
                .requested_at
                .lock()
                .ok()
                .and_then(|slot| *slot)
                .is_some_and(|at| at.elapsed() >= DEBOUNCE);
            let interval_due = RUNTIME
                .last_attempt
                .lock()
                .ok()
                .map(|slot| slot.map_or(true, |at| at.elapsed() >= INTERVAL))
                .unwrap_or(false);
            if !(just_unlocked || requested || interval_due) {
                continue;
            }
            if requested {
                if let Ok(mut slot) = RUNTIME.requested_at.lock() {
                    *slot = None;
                }
            }
            if ready_to_sync(&current) {
                let _ = run_and_publish(&app, &current);
            } else if let Ok(mut last) = RUNTIME.last_attempt.lock() {
                *last = Some(Instant::now());
            }
        }
    });
}
