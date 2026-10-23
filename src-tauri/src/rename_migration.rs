//! The app was renamed Passless → Mimatory on 2026-10-23 (owner: "名称以后都统一成mimatory，不再使用passless").
//! Two things moved with the name, and an existing install must find its data afterwards:
//!
//! - **The vault file.** Desktop keeps it at `<data dir>/Passless/passless.sqlite3`, now
//!   `<data dir>/Mimatory/mimatory.sqlite3` (phones: `passless.sqlite3` → `mimatory.sqlite3` in the app's own data
//!   directory). At startup the old file is **copied** (never moved, never deleted) into the new place with
//!   SQLite's `VACUUM INTO`, which reads one consistent snapshot even while an old build still has it open, then
//!   checked with `PRAGMA quick_check` and renamed into place, with a marker file beside it. A vault already at the
//!   new path is never touched. If the copy fails, `resolve_database_path` keeps answering with the old file, so a
//!   failed migration can never show an empty "set a master password" screen in front of real data.
//! - **The webview profile** (localStorage: language, sort, column widths, security preferences…), which Tauri
//!   and WebKit key by the bundle identifier `app.passless.desktop` → `app.mimatory.desktop`. It is copied once,
//!   best-effort, before any window exists; `src/app/storageMigration.ts` then renames the `passless-*` keys.
//!
//! The legacy names below are the only reason "passless" still appears in the Rust code (with the vault's
//! `MASTER_VERIFIER_TEXT`, which is encrypted data and must never change).

// Phones only use the vault half; the profile copy is desktop startup.
#![cfg_attr(mobile, allow(dead_code))]

use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::path::{Path, PathBuf};

pub const LEGACY_IDENTIFIER: &str = "app.passless.desktop";
pub const IDENTIFIER: &str = "app.mimatory.desktop";
/// Written next to a vault that was copied from the old location; its content names the source.
pub const MIGRATION_MARKER: &str = ".migrated-from-passless";

#[derive(Debug, PartialEq, Eq)]
pub enum DatabaseMigration {
    /// No vault at the old path: a fresh install, or one that was already migrated and cleaned up.
    NothingToMigrate,
    /// A vault already exists at the new path; it wins and the old one is left alone.
    NewVaultExists,
    Copied,
}

/// The vault every command opens: the new file once it exists, otherwise the old one if there is one (a
/// migration that has not run or failed), otherwise the new path (a fresh install creates it there).
pub fn resolve_database_path(current: PathBuf, legacy: PathBuf) -> PathBuf {
    if !current.exists() && legacy.is_file() {
        legacy
    } else {
        current
    }
}

/// Copies the vault at `legacy` to `current` unless `current` exists. Never modifies or removes `legacy`.
pub fn migrate_database(legacy: &Path, current: &Path) -> Result<DatabaseMigration, String> {
    if current.exists() {
        return Ok(DatabaseMigration::NewVaultExists);
    }
    if !legacy.is_file() {
        return Ok(DatabaseMigration::NothingToMigrate);
    }
    let directory = current
        .parent()
        .ok_or_else(|| "the new vault path has no parent directory".to_string())?;
    crate::storage::create_private_directory(directory).map_err(|error| error.to_string())?;

    let staging = with_suffix(current, ".migrating");
    remove_if_present(&staging)?;
    let result = copy_snapshot(legacy, &staging).and_then(|()| {
        crate::storage::set_private_permissions(&staging).map_err(|error| error.to_string())?;
        // Checked again right before the rename: rename replaces an existing file on Unix.
        if current.exists() {
            return Ok(DatabaseMigration::NewVaultExists);
        }
        fs::rename(&staging, current).map_err(|error| error.to_string())?;
        Ok(DatabaseMigration::Copied)
    });
    let _ = remove_if_present(&staging);
    let _ = remove_if_present(&with_suffix(&staging, "-journal"));
    if result == Ok(DatabaseMigration::Copied) {
        let marker = directory.join(MIGRATION_MARKER);
        let note = format!(
            "Copied from {} on {} (Passless → Mimatory rename). The original was left in place.\n",
            legacy.display(),
            chrono::Utc::now().to_rfc3339()
        );
        if fs::write(&marker, note).is_ok() {
            let _ = crate::storage::set_private_permissions(&marker);
        }
    }
    result
}

/// One consistent snapshot of `source` (including anything still in its journal) written to `target`.
fn copy_snapshot(source: &Path, target: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
        .map_err(|error| format!("copying the vault failed: {error}"))?;
    drop(connection);

    let copy = Connection::open_with_flags(target, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let check: String = copy
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if check != "ok" {
        return Err(format!("the copied vault failed its integrity check: {check}"));
    }
    Ok(())
}

/// Copies the directory `from` to `to` once: nothing happens when `to` exists or `from` does not. The copy is
/// built beside `to` and renamed into place, so a half-finished copy never looks like a finished one.
pub fn copy_directory_once(from: &Path, to: &Path) -> Result<bool, String> {
    if to.exists() || !from.is_dir() {
        return Ok(false);
    }
    let staging = with_suffix(to, ".migrating");
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    let result = copy_tree(from, &staging).and_then(|()| fs::rename(&staging, to));
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result.map(|()| true).map_err(|error| error.to_string())
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
        }
        // Symlinks and sockets (WebKit's) are skipped: the profile is preferences, not links.
    }
    Ok(())
}

/// Where the webview keeps its profile for a bundle identifier, per desktop OS: WKWebView's default data
/// store on macOS, Tauri's `app_local_data_dir` (WebView2's `EBWebView`, WebKitGTK's storage) elsewhere.
pub fn webview_profile_directory(identifier: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return dirs::home_dir().map(|home| home.join("Library").join("WebKit").join(identifier));
    #[cfg(not(target_os = "macos"))]
    return dirs::data_local_dir().map(|base| base.join(identifier));
}

/// Desktop startup, before the Tauri builder creates any window (a webview opened on the new profile would
/// create it empty, and the copy would then never run). Failures are reported and never stop the app.
#[cfg(desktop)]
pub fn run_desktop() {
    match crate::storage::migrate_legacy_database() {
        Ok(DatabaseMigration::Copied) => eprintln!("Mimatory: copied the Passless vault to its new location"),
        Ok(_) => {}
        Err(error) => eprintln!("Mimatory: vault migration skipped, still using the Passless vault: {error}"),
    }
    if let (Some(from), Some(to)) = (
        webview_profile_directory(LEGACY_IDENTIFIER),
        webview_profile_directory(IDENTIFIER),
    ) {
        if let Err(error) = copy_directory_once(&from, &to) {
            eprintln!("Mimatory: could not copy the Passless preferences: {error}");
        }
    }
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "mimatory-rename-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).expect("scratch directory");
        directory
    }

    fn write_vault(path: &Path, value: &str) {
        fs::create_dir_all(path.parent().expect("parent")).expect("vault directory");
        let connection = Connection::open(path).expect("open vault");
        connection
            .execute_batch("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .expect("schema");
        connection
            .execute("INSERT INTO meta (key, value) VALUES ('probe', ?1)", [value])
            .expect("insert");
    }

    fn read_vault(path: &Path) -> String {
        Connection::open(path)
            .expect("open vault")
            .query_row("SELECT value FROM meta WHERE key = 'probe'", [], |row| row.get(0))
            .expect("probe row")
    }

    #[test]
    fn copies_the_old_vault_and_leaves_it_in_place() {
        let root = scratch("copy");
        let legacy = root.join("Passless").join("passless.sqlite3");
        let current = root.join("Mimatory").join("mimatory.sqlite3");
        write_vault(&legacy, "real data");

        assert_eq!(migrate_database(&legacy, &current), Ok(DatabaseMigration::Copied));
        assert_eq!(read_vault(&current), "real data");
        assert_eq!(read_vault(&legacy), "real data");
        assert!(root.join("Mimatory").join(MIGRATION_MARKER).is_file());
        assert!(!root.join("Mimatory").join("mimatory.sqlite3.migrating").exists());
        assert_eq!(resolve_database_path(current.clone(), legacy.clone()), current);
        // Running again changes nothing.
        assert_eq!(migrate_database(&legacy, &current), Ok(DatabaseMigration::NewVaultExists));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn never_overwrites_an_existing_new_vault() {
        let root = scratch("existing");
        let legacy = root.join("Passless").join("passless.sqlite3");
        let current = root.join("Mimatory").join("mimatory.sqlite3");
        write_vault(&legacy, "old");
        write_vault(&current, "new");

        assert_eq!(migrate_database(&legacy, &current), Ok(DatabaseMigration::NewVaultExists));
        assert_eq!(read_vault(&current), "new");
        assert!(!root.join("Mimatory").join(MIGRATION_MARKER).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_fresh_install_has_nothing_to_migrate() {
        let root = scratch("fresh");
        let legacy = root.join("Passless").join("passless.sqlite3");
        let current = root.join("Mimatory").join("mimatory.sqlite3");

        assert_eq!(migrate_database(&legacy, &current), Ok(DatabaseMigration::NothingToMigrate));
        assert!(!current.exists());
        assert_eq!(resolve_database_path(current.clone(), legacy), current);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_failed_copy_keeps_using_the_old_vault() {
        let root = scratch("failed");
        let legacy = root.join("Passless").join("passless.sqlite3");
        let current = root.join("Mimatory").join("mimatory.sqlite3");
        fs::create_dir_all(legacy.parent().expect("parent")).expect("dir");
        fs::write(&legacy, b"not a sqlite file").expect("write");

        assert!(migrate_database(&legacy, &current).is_err());
        assert!(!current.exists());
        assert!(!root.join("Mimatory").join("mimatory.sqlite3.migrating").exists());
        assert_eq!(resolve_database_path(current, legacy.clone()), legacy);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn the_new_identifier_is_the_bundle_identifier() {
        let config = include_str!("../tauri.conf.json");
        assert!(config.contains(&format!("\"identifier\": \"{IDENTIFIER}\"")));
    }

    #[test]
    fn copies_a_profile_directory_once() {
        let root = scratch("profile");
        let from = root.join(LEGACY_IDENTIFIER);
        let to = root.join(IDENTIFIER);
        fs::create_dir_all(from.join("localstorage")).expect("dir");
        fs::write(from.join("localstorage").join("file.db"), b"prefs").expect("write");

        assert_eq!(copy_directory_once(&from, &to), Ok(true));
        assert_eq!(fs::read(to.join("localstorage").join("file.db")).expect("copied"), b"prefs");
        assert!(from.join("localstorage").join("file.db").is_file());

        fs::write(from.join("localstorage").join("file.db"), b"changed").expect("write");
        assert_eq!(copy_directory_once(&from, &to), Ok(false));
        assert_eq!(fs::read(to.join("localstorage").join("file.db")).expect("kept"), b"prefs");
        let _ = fs::remove_dir_all(root);
    }
}
