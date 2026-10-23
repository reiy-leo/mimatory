mod biometric;
mod breach_check;
mod browser_bridge;
mod crypto;
mod favicon;
mod import_1pux;
mod passkey;
mod rename_migration;
#[cfg(desktop)]
mod shell;
mod site_match;
mod storage;
mod totp;
mod vault;

use breach_check::BreachCheckResult;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;
use totp::TotpCode;
use vault::{
    generate_password, CachedSiteIcon, CustomField, LoginItem, LoginItemInput, LoginItemSummary, LoginItemUpdate,
    PasswordGeneratorOptions, PasswordStrength, Session, Tag, VaultError, VaultService, VaultSummary, WatchtowerReport,
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
        name: "Mimatory",
        database_ready: true,
        has_master_password,
        unlocked: state
            .session
            .lock()
            .map_err(|_| "session lock poisoned".to_string())?
            .is_some(),
    })
}

#[tauri::command(async)]
fn setup_master_password(
    password: String,
    state: State<AppState>,
) -> Result<Vec<LoginItemSummary>, String> {
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
        .list_login_summaries(&session, None)
        .map_err(String::from)
}

#[tauri::command(async)]
fn unlock_vault(password: String, state: State<AppState>) -> Result<Vec<LoginItemSummary>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = service.unlock(&password).map_err(String::from)?;
    let items = service
        .list_login_summaries(&session, None)
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

#[tauri::command(async)]
fn list_login_items(
    query: Option<String>,
    state: State<AppState>,
) -> Result<Vec<LoginItemSummary>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .list_login_summaries(&session, query.as_deref())
        .map_err(String::from)
}

/// One item, decrypted in full with its links resolved: the detail pane asks for it when a row is
/// selected, because the list commands return summaries only. `vault_id` names the vault the row came
/// from (All spans vaults), so the read does not wait on the session following the selection.
#[tauri::command(async)]
fn get_login_item(
    item_id: String,
    vault_id: Option<String>,
    state: State<AppState>,
) -> Result<LoginItem, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    let session = match vault_id.as_deref() {
        Some(id) if !id.is_empty() => session.for_vault(id),
        _ => session,
    };
    service
        .login_item_detail(&session, &item_id)
        .map_err(String::from)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
fn switch_vault(id: String, state: State<AppState>) -> Result<Vec<LoginItemSummary>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    let next_session = service
        .session_for_vault(&session, &id)
        .map_err(String::from)?;
    let items = service
        .list_login_summaries(&next_session, None)
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

/// Points the session at another vault without listing it. Selecting an item in All that lives in
/// another vault only needs the session to follow it (so edits act there); the window already holds
/// every vault's items, so decrypting that vault again here was pure delay.
#[tauri::command(async)]
fn focus_vault(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    let next_session = service
        .session_for_vault(&session, &id)
        .map_err(String::from)?;
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? = Some(next_session.clone());
    *state
        .biometric_session
        .lock()
        .map_err(|_| "biometric session lock poisoned".to_string())? = Some(next_session);
    Ok(())
}

#[tauri::command]
fn update_vault(
    color: String,
    icon: String,
    id: String,
    name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .update_vault(&session, &id, &name, &icon, &color)
        .map_err(String::from)
}

/// A vault parks what is in it as well, so the archive view is where its items go to be read. The
/// session stays put: archiving the open vault leaves the app looking at an empty one, and the
/// sidebar decides which vault to open instead.
#[tauri::command]
fn set_vault_archived(archived: bool, id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .set_vault_archived(&session, &id, archived)
        .map_err(String::from)
}

/// Empties a vault into `into_id` and drops the row. `into_id` may be null when the vault holds
/// nothing; the last vault in the file cannot be dissolved at all.
#[tauri::command]
fn dissolve_vault(id: String, into_id: Option<String>, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .dissolve_vault(&session, &id, into_id.as_deref())
        .map_err(String::from)
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
fn duplicate_login_item(
    id: String,
    title: String,
    state: State<AppState>,
) -> Result<LoginItem, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .duplicate_login_item(&session, &id, &title)
        .map_err(String::from)
}

/// The item leaves the vault the session is reading, so the caller's list changes underneath it —
/// this does not switch the app to the target vault.
#[tauri::command]
fn move_login_item(id: String, vault_id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .move_login_item(&session, &id, &vault_id)
        .map_err(String::from)
}

#[tauri::command]
fn trash_login_item(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.trash_item(&session, &id).map_err(String::from)
}

#[tauri::command(async)]
fn list_trashed_login_items(state: State<AppState>) -> Result<Vec<LoginItemSummary>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .list_trashed_login_summaries(&session)
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

/// Sets or clears the one parent an item belongs to; the frontend re-lists afterwards.
#[tauri::command]
fn set_item_parent(
    id: String,
    parent_id: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .set_item_parent(&session, &id, parent_id.as_deref())
        .map_err(String::from)
}

#[tauri::command]
fn link_related_items(id: String, other_id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .link_related_items(&session, &id, &other_id)
        .map_err(String::from)
}

#[tauri::command]
fn unlink_related_items(id: String, other_id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .unlink_related_items(&session, &id, &other_id)
        .map_err(String::from)
}

/// Sets or clears the account an item signs in with ("Sign in with Google" → the Google login).
#[tauri::command]
fn set_item_sign_in(
    id: String,
    account_id: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .set_item_sign_in(&session, &id, account_id.as_deref())
        .map_err(String::from)
}

/// `auto` shows the website icon, `letter` keeps the letter tile.
#[tauri::command]
fn set_item_icon_mode(id: String, mode: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.set_item_icon_mode(&session, &id, &mode).map_err(String::from)
}

/// The cached website icons for these sites. Never touches the network: a site missing from the
/// answer has never been fetched, and the frontend decides whether to (the setting, the item).
#[tauri::command(async)]
fn cached_site_icons(
    domains: Vec<String>,
    state: State<AppState>,
) -> Result<HashMap<String, CachedSiteIcon>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    let domains: Vec<String> = domains
        .iter()
        .filter_map(|domain| favicon::normalize_domain(domain).ok())
        .take(500)
        .collect();
    service.cached_site_icons(&session, &domains).map_err(String::from)
}

/// Fetches one site's icon from the site itself (see favicon.rs for every rule it follows) and
/// caches it, or the miss, encrypted. `force` skips a fresh cache entry ("Refresh Icon"). Async and
/// on a blocking thread, so a slow site never holds up the window.
#[tauri::command]
async fn fetch_site_icon(
    domain: String,
    force: bool,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let session = current_session(&state)?;
    let domain = favicon::normalize_domain(&domain).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        if !force {
            let connection = storage::open_default_database().map_err(|error| error.to_string())?;
            let service = VaultService::new(connection);
            let cached = service
                .cached_site_icons(&session, std::slice::from_ref(&domain))
                .map_err(String::from)?;
            if let Some(entry) = cached.get(&domain).filter(|entry| entry.fresh) {
                return Ok(entry.icon.clone());
            }
        }
        // Unreachable and icon-less sites are both remembered as a miss, so neither is asked again
        // on every list render; the miss expires sooner than an icon does.
        let png = favicon::fetch_site_icon(&domain, &favicon::FetchPolicy::strict()).unwrap_or(None);
        let connection = storage::open_default_database().map_err(|error| error.to_string())?;
        let mut service = VaultService::new(connection);
        service
            .store_site_icon(&session, &domain, png.as_deref())
            .map_err(String::from)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Forgets every cached website icon (the "Download website icons" setting was turned off).
#[tauri::command]
fn clear_site_icons(state: State<AppState>) -> Result<(), String> {
    current_session(&state)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    service.clear_site_icons().map_err(String::from)
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

#[tauri::command(async)]
fn list_archived_login_items(state: State<AppState>) -> Result<Vec<LoginItemSummary>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .list_archived_login_summaries(&session)
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
/// All (owner 2026-10-18): the live items of every open vault, each with its `vault_id`.
#[tauri::command(async)]
fn list_all_login_items(state: State<AppState>) -> Result<Vec<LoginItemSummary>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.list_all_login_summaries(&session).map_err(String::from)
}

/// The sidebar's tags: one per name across the open vaults, not tied to the open one.
#[tauri::command(async)]
fn list_all_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.list_all_tags(&session).map_err(String::from)
}

#[tauri::command]
fn record_item_use(id: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.record_item_use(&session, &id).map_err(String::from)
}

#[tauri::command(async)]
fn list_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.list_tags(&session).map_err(String::from)
}

#[tauri::command]
fn update_tag(
    color: String,
    from: String,
    icon: String,
    name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service
        .update_tag_everywhere(&session, &from, &name, &icon, &color)
        .map_err(String::from)
}

#[tauri::command]
fn delete_tag(name: String, state: State<AppState>) -> Result<(), String> {
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let mut service = VaultService::new(connection);
    let session = current_session(&state)?;
    service.delete_tag_everywhere(&session, &name).map_err(String::from)
}

#[tauri::command]
fn password_strength(password: String) -> PasswordStrength {
    vault::password_strength(&password)
}

/// Where an address would fill under each autofill behaviour, for the editor's Autofill Behavior
/// box. Pure computation (Public Suffix List + the bundled related domains); no vault access.
#[tauri::command]
fn describe_website(url: String) -> Option<site_match::WebsiteScope> {
    site_match::describe(&url)
}

#[tauri::command]
fn generate_totp_code(secret: String) -> Result<TotpCode, String> {
    totp::generate_totp_now(&secret).map_err(|error| error.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn pick_attachment_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
}

/// File ▸ Import ▸ 1Password: pick a `.1pux` and read what it holds, writing nothing. None when the picker
/// was cancelled.
#[cfg(desktop)]
#[tauri::command]
fn preview_1pux_import(state: State<AppState>) -> Result<Option<import_1pux::ImportPreview>, String> {
    let session = current_session(&state)?;
    let Some(path) = rfd::FileDialog::new()
        .set_title("Import from 1Password")
        .add_filter("1Password export", &["1pux"])
        .pick_file()
    else {
        return Ok(None);
    };
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    import_1pux::preview(&path, &service, &session).map(Some).map_err(String::from)
}

#[cfg(mobile)]
#[tauri::command]
fn preview_1pux_import() -> Result<Option<import_1pux::ImportPreview>, String> {
    Err("importing is not available on this platform yet".to_string())
}

/// Async and off the main thread: a large export (attachments especially) takes seconds, and a synchronous
/// command would freeze the window — the import sheet's progress state could not even paint.
#[tauri::command]
async fn import_1pux_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<import_1pux::ImportSummary, String> {
    let session = current_session(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let connection = storage::open_default_database().map_err(|error| error.to_string())?;
        let mut service = VaultService::new(connection);
        import_1pux::import(std::path::Path::new(&path), &mut service, &session).map_err(String::from)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// rfd has no iOS/Android backend; the frontend hides the attach button there (src/app/platformFeatures.ts).
#[cfg(mobile)]
#[tauri::command]
fn pick_attachment_file() -> Result<Option<String>, String> {
    Err("attaching files is not available on this platform yet".to_string())
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
    let directory = storage::temp_base_directory().join("Mimatory Attachments");
    storage::create_private_directory(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(file_name);
    fs::write(&path, attachment.bytes).map_err(|error| error.to_string())?;
    // The bytes here are already decrypted, so the temp copy cannot lean on the vault's
    // encryption for confidentiality.
    storage::set_private_permissions(&path).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// A plain-text attachment for the in-app preview (a `.txt` row opens it). Read from the vault
/// and decoded in memory: unlike Export, nothing decrypted is written to disk.
#[tauri::command]
fn read_attachment_text(id: String, state: State<AppState>) -> Result<vault::AttachmentText, String> {
    let session = current_session(&state)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let attachment = service
        .export_attachment(&session, &id)
        .map_err(String::from)?;
    Ok(vault::text_preview(&attachment.file_name, &attachment.bytes, vault::TEXT_PREVIEW_LIMIT))
}

#[tauri::command]
fn generate_browser_pairing_token(state: State<AppState>) -> Result<String, String> {
    // The extension bridge only listens on desktop (see `run`); a token on a phone would pair nothing.
    if cfg!(mobile) {
        return Err("the browser extension bridge is desktop-only".to_string());
    }
    let token = uuid::Uuid::new_v4().to_string();
    *state
        .bridge_token
        .lock()
        .map_err(|_| "bridge token lock poisoned".to_string())? = Some(token.clone());
    Ok(token)
}

#[tauri::command]
fn can_use_biometrics(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(biometric::can_authenticate(&app).is_ok())
}

/// Async so the prompt never blocks the main thread: on iOS/Android the plugin call waits for a native
/// answer that is itself delivered on the main thread.
#[tauri::command]
async fn unlock_with_biometrics(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<LoginItemSummary>, String> {
    biometric::authenticate(&app, "unlock your Mimatory vault").map_err(|error| error.to_string())?;
    let session = state
        .biometric_session
        .lock()
        .map_err(|_| "biometric session lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "Unlock with master password once before using biometrics".to_string())?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    let items = service
        .list_login_summaries(&session, None)
        .map_err(String::from)?;
    *state
        .session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())? = Some(session);
    Ok(items)
}

#[tauri::command(async)]
fn watchtower_report(state: State<AppState>) -> Result<WatchtowerReport, String> {
    let session = current_session(&state)?;
    let connection = storage::open_default_database().map_err(|error| error.to_string())?;
    let service = VaultService::new(connection);
    service.watchtower_report(&session).map_err(String::from)
}

#[tauri::command(async)]
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
    #[cfg(desktop)]
    return shell::set_autostart(&app, enabled);
    #[cfg(mobile)]
    {
        let _ = (enabled, app);
        Err("launch at login is desktop-only".to_string())
    }
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    return shell::autostart_enabled(&app);
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
fn hide_quick_access(app: tauri::AppHandle) {
    #[cfg(desktop)]
    shell::hide_quick_access(&app);
    #[cfg(mobile)]
    let _ = app;
}

/// Linux is Wayland-only (owner ruling 2026-10-17: Hyprland, no X11). wry/tao are built without their X11
/// backends, but GTK itself still carries one, so an X11 session would get a half-working app — refuse it
/// up front instead, and pin GDK to Wayland so a stray DISPLAY (XWayland) never wins the backend probe.
/// Runs before any thread is spawned, which is what makes `set_var` sound here.
#[cfg(target_os = "linux")]
fn require_wayland() {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty());
    if !wayland {
        eprintln!(
            "Mimatory needs a Wayland session (it is built for Hyprland); X11 is not supported.\n\
             WAYLAND_DISPLAY is not set — start Mimatory from your Wayland compositor."
        );
        std::process::exit(1);
    }
    std::env::set_var("GDK_BACKEND", "wayland");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    require_wayland();
    // Before the builder: the main window's webview must open on the copied profile, not a fresh one.
    #[cfg(desktop)]
    rename_migration::run_desktop();

    let session = Arc::new(Mutex::new(None));
    let biometric_session = Arc::new(Mutex::new(None));
    let bridge_token = Arc::new(Mutex::new(None));
    #[cfg(desktop)]
    let bridge_session = (session.clone(), bridge_token.clone());

    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = shell::plugins(builder);
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    builder
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            // Phones have no `dirs::data_dir()` worth trusting (None on Android), so the vault goes in the
            // app's own sandboxed data directory there.
            #[cfg(mobile)]
            {
                use tauri::Manager;
                storage::set_app_data_directory(app.path().app_data_dir()?);
                if let Err(error) = storage::migrate_legacy_database() {
                    eprintln!("Mimatory: vault migration skipped: {error}");
                }
            }
            // The extension lives in a desktop browser; iOS and Android get no loopback listener at all.
            // Started here so its writes can tell the window to reload (`vault:changed`).
            #[cfg(desktop)]
            browser_bridge::start_browser_bridge(
                bridge_session.0.clone(),
                bridge_session.1.clone(),
                app.handle().clone(),
            );
            #[cfg(desktop)]
            shell::setup(app)?;
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .manage(AppState {
            session,
            biometric_session,
            bridge_token,
        })
        .invoke_handler(tauri::generate_handler![
            initialize_database,
            preview_1pux_import,
            import_1pux_file,
            setup_master_password,
            unlock_vault,
            lock_vault,
            list_login_items,
            get_login_item,
            list_vaults,
            create_vault,
            switch_vault,
            focus_vault,
            update_vault,
            set_vault_archived,
            dissolve_vault,
            create_login_item,
            update_login_item,
            duplicate_login_item,
            move_login_item,
            trash_login_item,
            list_trashed_login_items,
            restore_trashed_login_item,
            purge_login_item,
            archive_login_item,
            restore_login_item,
            list_archived_login_items,
            set_login_favorite,
            list_all_login_items,
            list_all_tags,
            record_item_use,
            set_item_parent,
            link_related_items,
            unlink_related_items,
            set_item_sign_in,
            set_item_icon_mode,
            cached_site_icons,
            fetch_site_icon,
            clear_site_icons,
            list_tags,
            update_tag,
            delete_tag,
            generate_password_command,
            password_strength,
            describe_website,
            generate_totp_code,
            pick_attachment_file,
            attach_file_to_item,
            export_attachment_to_temp,
            read_attachment_text,
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
        .expect("error while running Mimatory");
}
