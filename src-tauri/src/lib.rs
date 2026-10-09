mod biometric;
mod breach_check;
mod browser_bridge;
mod crypto;
mod shell;
mod storage;
mod totp;
mod vault;

use breach_check::BreachCheckResult;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;
use totp::TotpCode;
use vault::{
    generate_password, CustomField, LoginItem, LoginItemInput, LoginItemUpdate, PasswordGeneratorOptions,
    PasswordStrength, Session, Tag, VaultError, VaultService, VaultSummary, WatchtowerReport,
};

struct AppState {
    session: browser_bridge::SharedSession,
    biometric_session: browser_bridge::SharedSession,
    bridge_token: browser_bridge::SharedBridgeToken,
}

#[derive(Serialize)]
struct AppStatus {
    name: &'static str,
    database_ready: bool,
    has_master_password: bool,
    unlocked: bool,
}

#[tauri::command]
fn initialize_database(state: State<AppState>) -> Result<AppStatus, String> {
    let connection = storage::open_default_database()
        .map_err(|error| format!("failed to initialize database: {error}"))?;
    let service = VaultService::new(connection);
    let has_master_password = service.has_master_password().map_err(String::from)?;

    Ok(AppStatus {
        name: "Passless",
        database_ready: true,
        has_master_password,
        unlocked: state
            .session
            .lock()
            .map_err(|_| "session lock poisoned".to_string())?
            .is_some(),
    })
}

#[tauri::command]
fn setup_master_password(
    password: String,
    state: State<AppState>,
) -> Result<Vec<LoginItem>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = service
        .setup_master_password(&password)
        .map_err(String::from)?;
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? = Some(session.clone());
    *state
        .biometric_session
        .lock()
        .map_err(|_| "biometric session lock poisoned".to_string())? = Some(session.clone());
    service
        .list_login_items(&session, None)
        .map_err(String::from)
}

#[tauri::command]
fn unlock_vault(password: String, state: State<AppState>) -> Result<Vec<LoginItem>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = service.unlock(&password).map_err(String::from)?;
    let items = service
        .list_login_items(&session, None)
        .map_err(String::from)?;
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? = Some(session);
    *state
        .biometric_session
        .lock()
        .map_err(|_| "biometric session lock poisoned".to_string())? = state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())?
        .clone();
    Ok(items)
}

#[tauri::command]
fn lock_vault(state: State<AppState>) -> Result<(), String> {
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? = None;
    *state
        .bridge_token
        .lock()
        .map_err(|_| "bridge token lock poisoned".to_string())? = None;
    Ok(())
}

#[tauri::command]
fn list_login_items(
    query: Option<String>,
    state: State<AppState>,
) -> Result<Vec<LoginItem>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .list_login_items(&session, query.as_deref())
        .map_err(String::from)
}

#[tauri::command]
fn list_vaults(state: State<AppState>) -> Result<Vec<VaultSummary>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.list_vaults(&session).map_err(String::from)
}

#[tauri::command]
fn create_vault(name: String, state: State<AppState>) -> Result<VaultSummary, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    let vault = service.create_vault(&session, &name).map_err(String::from)?;
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? =
        Some(service.session_for_vault(&session, &vault.id).map_err(String::from)?);
    *state
        .biometric_session
        .lock()
        .map_err(|_| "biometric session lock poisoned".to_string())? = state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())?
        .clone();
    Ok(vault)
}

#[tauri::command]
fn switch_vault(id: String, state: State<AppState>) -> Result<Vec<LoginItem>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    let next_session = service
        .session_for_vault(&session, &id)
        .map_err(String::from)?;
    let items = service
        .list_login_items(&next_session, None)
        .map_err(String::from)?;
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? = Some(next_session);
    *state
        .biometric_session
        .lock()
        .map_err(|_| "biometric session lock poisoned".to_string())? = state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())?
        .clone();
    Ok(items)
}

#[tauri::command]
fn create_login_item(input: LoginItemInput, state: State<AppState>) -> Result<LoginItem, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .create_login_item(&session, input)
        .map_err(String::from)
}

#[tauri::command]
fn update_login_item(input: LoginItemUpdate, state: State<AppState>) -> Result<LoginItem, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .update_login_item(&session, input)
        .map_err(String::from)
}

#[tauri::command]
fn trash_login_item(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.trash_item(&session, &id).map_err(String::from)
}

#[tauri::command]
fn list_trashed_login_items(state: State<AppState>) -> Result<Vec<LoginItem>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .list_trashed_login_items(&session)
        .map_err(String::from)
}

#[tauri::command]
fn restore_trashed_login_item(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .restore_trashed_item(&session, &id)
        .map_err(String::from)
}

#[tauri::command]
fn purge_login_item(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.purge_item(&session, &id).map_err(String::from)
}

#[tauri::command]
fn archive_login_item(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.archive_item(&session, &id).map_err(String::from)
}

#[tauri::command]
fn restore_login_item(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.restore_item(&session, &id).map_err(String::from)
}

#[tauri::command]
fn list_archived_login_items(state: State<AppState>) -> Result<Vec<LoginItem>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .list_archived_login_items(&session)
        .map_err(String::from)
}

#[tauri::command]
fn set_login_favorite(id: String, favorite: bool, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .set_favorite(&session, &id, favorite)
        .map_err(String::from)
}

#[tauri::command]
fn generate_password_command(options: PasswordGeneratorOptions) -> Result<String, String> {
    generate_password(options).map_err(String::from)
}

// A tag row lives only while some item names it, and it is addressed by name because a name is the
// only handle an item carries. How many items use it is counted from the live item list in the
// frontend, so the number beside a tag cannot disagree with what clicking that tag reveals.
#[tauri::command]
fn list_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.list_tags(&session).map_err(String::from)
}

#[tauri::command]
fn update_tag(from: String, icon: String, name: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .update_tag(&session, &from, &name, &icon)
        .map_err(String::from)
}

#[tauri::command]
fn delete_tag(name: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.delete_tag(&session, &name).map_err(String::from)
}

#[tauri::command]
fn password_strength(password: String) -> PasswordStrength {
    vault::password_strength(&password)
}

#[tauri::command]
fn generate_totp_code(secret: String) -> Result<TotpCode, String> {
    totp::generate_totp_now(&secret).map_err(|error| error.to_string())
}

#[tauri::command]
fn pick_attachment_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn attach_file_to_item(
    id: String,
    path: String,
    state: State<AppState>,
) -> Result<CustomField, String> {
    let session = current_session(&state)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    service
        .add_attachment(&session, &id, &PathBuf::from(path))
        .map_err(String::from)
}

#[tauri::command]
fn export_attachment_to_temp(id: String, state: State<AppState>) -> Result<String, String> {
    let session = current_session(&state)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let attachment = service
        .export_attachment(&session, &id)
        .map_err(String::from)?;
    let file_name = PathBuf::from(&attachment.file_name)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "attachment".to_string());
    let directory = std::env::temp_dir().join("Passless Attachments");
    storage::create_private_directory(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(file_name);
    fs::write(&path, attachment.bytes).map_err(|error| error.to_string())?;
    // The bytes here are already decrypted, so the temp copy cannot lean on the vault's
    // encryption for confidentiality.
    storage::set_private_permissions(&path).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn generate_browser_pairing_token(state: State<AppState>) -> Result<String, String> {
    let token = uuid::Uuid::new_v4().to_string();
    *state
        .bridge_token
        .lock()
        .map_err(|_| "bridge token lock poisoned".to_string())? = Some(token.clone());
    Ok(token)
}

#[tauri::command]
fn can_use_biometrics() -> Result<bool, String> {
    Ok(biometric::can_authenticate().is_ok())
}

#[tauri::command]
fn unlock_with_biometrics(state: State<AppState>) -> Result<Vec<LoginItem>, String> {
    biometric::authenticate("unlock your Passless vault").map_err(|error| error.to_string())?;
    let session = state
        .biometric_session
        .lock()
        .map_err(|_| "biometric session lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "Unlock with master password once before using Touch ID".to_string())?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let items = service
        .list_login_items(&session, None)
        .map_err(String::from)?;
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? = Some(session);
    Ok(items)
}

#[tauri::command]
fn watchtower_report(state: State<AppState>) -> Result<WatchtowerReport, String> {
    let session = current_session(&state)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    service.watchtower_report(&session).map_err(String::from)
}

#[tauri::command]
fn check_breached_passwords(state: State<AppState>) -> Result<BreachCheckResult, String> {
    let session = current_session(&state)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let items = service.export_login_items(&session).map_err(String::from)?;
    breach_check::check_breached_passwords(&items).map_err(|error| error.to_string())
}

fn current_session(state: &State<AppState>) -> Result<Session, String> {
    state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| String::from(VaultError::Locked))
}

#[tauri::command]
fn set_autostart(enabled: bool, app: tauri::AppHandle) -> Result<(), String> {
    shell::set_autostart(&app, enabled)
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    shell::autostart_enabled(&app)
}

#[tauri::command]
fn hide_quick_access(app: tauri::AppHandle) {
    shell::hide_quick_access(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session = Arc::new(Mutex::new(None));
    let biometric_session = Arc::new(Mutex::new(None));
    let bridge_token = Arc::new(Mutex::new(None));
    browser_bridge::start_browser_bridge(session.clone(), bridge_token.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            shell::focus_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| shell::setup(app))
        .manage(AppState {
            session,
            biometric_session,
            bridge_token,
        })
        .invoke_handler(tauri::generate_handler![
            initialize_database,
            setup_master_password,
            unlock_vault,
            lock_vault,
            list_login_items,
            list_vaults,
            create_vault,
            switch_vault,
            create_login_item,
            update_login_item,
            trash_login_item,
            list_trashed_login_items,
            restore_trashed_login_item,
            purge_login_item,
            archive_login_item,
            restore_login_item,
            list_archived_login_items,
            set_login_favorite,
            list_tags,
            update_tag,
            delete_tag,
            generate_password_command,
            password_strength,
            generate_totp_code,
            pick_attachment_file,
            attach_file_to_item,
            export_attachment_to_temp,
            generate_browser_pairing_token,
            can_use_biometrics,
            unlock_with_biometrics,
            watchtower_report,
            check_breached_passwords,
            set_autostart,
            is_autostart_enabled,
            hide_quick_access
        ])
        .run(tauri::generate_context!())
        .expect("error while running Passless");
}
