use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const CURRENT_SCHEMA_VERSION: i64 = 5;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("could not determine an app data directory")]
    MissingDataDirectory,
    #[error("filesystem error: {0}")]
    Filesystem(#[from] std::io::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Set once at startup on iOS/Android from Tauri's app data directory (the app sandbox), where
/// `dirs::data_dir()` is either missing (Android) or not the directory the OS backs up and wipes with the app.
static APP_DATA_DIRECTORY: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg_attr(not(mobile), allow(dead_code))]
pub fn set_app_data_directory(path: PathBuf) {
    let _ = APP_DATA_DIRECTORY.set(path);
}

const DATABASE_FILE: &str = "mimatory.sqlite3";
const DESKTOP_DIRECTORY: &str = "Mimatory";
/// Where builds before the 2026-10-23 rename kept the vault (see `rename_migration`).
const LEGACY_DATABASE_FILE: &str = "passless.sqlite3";
const LEGACY_DESKTOP_DIRECTORY: &str = "Passless";

/// (current path, legacy path) of the vault on this platform.
fn database_paths() -> Result<(PathBuf, PathBuf), StorageError> {
    if let Some(base_dir) = APP_DATA_DIRECTORY.get() {
        return Ok((base_dir.join(DATABASE_FILE), base_dir.join(LEGACY_DATABASE_FILE)));
    }
    let base_dir = dirs::data_dir().ok_or(StorageError::MissingDataDirectory)?;
    Ok((
        base_dir.join(DESKTOP_DIRECTORY).join(DATABASE_FILE),
        base_dir.join(LEGACY_DESKTOP_DIRECTORY).join(LEGACY_DATABASE_FILE),
    ))
}

/// The new vault path, or the pre-rename one while only that exists (a migration that failed or has not run).
pub fn default_database_path() -> Result<PathBuf, StorageError> {
    let (current, legacy) = database_paths()?;
    Ok(crate::rename_migration::resolve_database_path(current, legacy))
}

/// Copies a pre-rename vault to the new path once; on phones call it after `set_app_data_directory`.
pub fn migrate_legacy_database() -> Result<crate::rename_migration::DatabaseMigration, String> {
    let (current, legacy) = database_paths().map_err(|error| error.to_string())?;
    crate::rename_migration::migrate_database(&legacy, &current)
}

/// Where decrypted attachment copies go. `std::env::temp_dir()` on Android is `/data/local/tmp`, which an app
/// cannot write, so the phones use a folder inside their own sandbox instead.
pub fn temp_base_directory() -> PathBuf {
    match APP_DATA_DIRECTORY.get() {
        Some(base_dir) => base_dir.join("tmp"),
        None => std::env::temp_dir(),
    }
}

/// Encrypted at rest is only a defence if the file stays out of reach of other local
/// accounts and of a plain backup of the home folder, so every vault file is pinned
/// to owner-only instead of trusting whatever umask the process happened to start with.
/// SQLite creates its `-journal`, `-wal` and `-shm` sidecars from the umask too, so
/// any that already exist are tightened along with the database.
pub fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    apply_private_mode(path)?;

    for suffix in ["-journal", "-wal", "-shm"] {
        let mut sidecar = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        sidecar.push_str(suffix);
        let sidecar = path.with_file_name(sidecar);
        if sidecar.exists() {
            apply_private_mode(&sidecar)?;
        }
    }

    Ok(())
}

#[cfg(unix)]
fn apply_private_mode(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn apply_private_mode(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
pub fn create_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(path)?;
    // A vault whose files are unreadable but whose folder is listable still leaks
    // account names through the file names.
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
pub fn create_private_directory(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

pub fn initialize_database(path: &Path) -> Result<(), StorageError> {
    if let Some(parent) = path.parent() {
        create_private_directory(parent)?;
    }

    let connection = Connection::open(path)?;
    set_private_permissions(path)?;
    apply_schema(&connection)?;
    Ok(())
}

/// Set once the default database has had its schema applied in this process. Every command opens
/// its own connection, and re-running the whole schema (and its column checks) on each one cost
/// real time when the list, its icons and the side panels all load at once after unlocking.
static DEFAULT_SCHEMA_READY: std::sync::OnceLock<()> = std::sync::OnceLock::new();

pub fn open_default_database() -> Result<Connection, StorageError> {
    let database_path = default_database_path()?;
    if DEFAULT_SCHEMA_READY.get().is_none() {
        initialize_database(&database_path)?;
        let _ = DEFAULT_SCHEMA_READY.set(());
    }
    open_database(&database_path)
}

pub fn open_database(path: &Path) -> Result<Connection, StorageError> {
    let connection = Connection::open(path)?;
    // Re-applied on every open so a vault created before this existed, or a sidecar
    // SQLite just created with the process umask, gets repaired rather than staying open.
    set_private_permissions(path)?;
    // Foreign keys are a per-connection pragma, so the declared ON DELETE CASCADE
    // behaviour only applies to connections opened through here.
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    // Reads now run off the main thread beside the window's writes and the browser bridge, so a
    // connection waits for a lock instead of failing at once with "database is locked".
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(connection)
}

fn apply_schema(connection: &Connection) -> Result<(), StorageError> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vaults (
            id TEXT PRIMARY KEY NOT NULL,
            name_ciphertext BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            /* Last, because ALTER TABLE on an existing vault appends them here. */
            icon TEXT NOT NULL DEFAULT 'vault',
            color TEXT NOT NULL DEFAULT '',
            archived INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY NOT NULL,
            vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
            item_type TEXT NOT NULL,
            title_ciphertext BLOB NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            trashed INTEGER NOT NULL DEFAULT 0,
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            /* Set on the rows a *vault* archiving flipped, so restoring the vault does not also
               restore an item the user had already archived on its own. */
            archived_by_vault INTEGER NOT NULL DEFAULT 0,
            /* The item's parent and related-item links (schema 3), encrypted JSON of ids under the
               vault key; NULL for an item with none. */
            relations_ciphertext BLOB,
            /* Schema 4: 'auto' shows the website icon when there is one, 'letter' keeps the letter
               tile. Plaintext like `favorite`: a two-state display choice, no content. */
            icon_mode TEXT NOT NULL DEFAULT 'auto'
        );

        /* Schema 4: website icons, one row per site for every vault (they share one key). The site is
           a keyed blind index (HMAC under the vault key), the icon a normalised PNG encrypted under
           it, so the file names no site. A NULL icon is a remembered miss, retried after a while. */
        CREATE TABLE IF NOT EXISTS site_icons (
            domain_hash BLOB PRIMARY KEY NOT NULL,
            icon_ciphertext BLOB,
            fetched_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY NOT NULL,
            vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
            name_ciphertext BLOB NOT NULL,
            name_hash BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            /* Last, because ALTER TABLE on an existing vault appends them here. */
            icon TEXT NOT NULL DEFAULT 'tag',
            color TEXT NOT NULL DEFAULT '',
            UNIQUE (vault_id, name_hash)
        );

        CREATE TABLE IF NOT EXISTS item_tags (
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (item_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS item_fields (
            id TEXT PRIMARY KEY NOT NULL,
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            field_key TEXT NOT NULL,
            field_type TEXT NOT NULL,
            value_ciphertext BLOB NOT NULL,
            position INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS item_urls (
            id TEXT PRIMARY KEY NOT NULL,
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            label_ciphertext BLOB,
            url_ciphertext BLOB NOT NULL,
            match_type TEXT NOT NULL DEFAULT 'domain',
            position INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value_ciphertext BLOB NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY NOT NULL,
            event_type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY NOT NULL,
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            file_name_ciphertext BLOB NOT NULL,
            content_ciphertext BLOB NOT NULL,
            byte_count INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        ",
    )?;

    if !has_column(connection, "item_urls", "label_ciphertext")? {
        connection.execute("ALTER TABLE item_urls ADD COLUMN label_ciphertext BLOB", [])?;
    }

    if !has_column(connection, "item_urls", "match_type")? {
        connection.execute(
            "ALTER TABLE item_urls ADD COLUMN match_type TEXT NOT NULL DEFAULT 'domain'",
            [],
        )?;
    }

    if !has_column(connection, "items", "trashed")? {
        connection.execute(
            "ALTER TABLE items ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !has_column(connection, "items", "deleted_at")? {
        connection.execute("ALTER TABLE items ADD COLUMN deleted_at TEXT", [])?;
    }

    if !has_column(connection, "tags", "icon")? {
        connection.execute(
            "ALTER TABLE tags ADD COLUMN icon TEXT NOT NULL DEFAULT 'tag'",
            [],
        )?;
    }

    if !has_column(connection, "tags", "color")? {
        connection.execute(
            "ALTER TABLE tags ADD COLUMN color TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    if !has_column(connection, "vaults", "icon")? {
        connection.execute(
            "ALTER TABLE vaults ADD COLUMN icon TEXT NOT NULL DEFAULT 'vault'",
            [],
        )?;
    }

    if !has_column(connection, "vaults", "color")? {
        connection.execute(
            "ALTER TABLE vaults ADD COLUMN color TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    if !has_column(connection, "vaults", "archived")? {
        connection.execute(
            "ALTER TABLE vaults ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !has_column(connection, "items", "archived_by_vault")? {
        connection.execute(
            "ALTER TABLE items ADD COLUMN archived_by_vault INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !has_column(connection, "items", "relations_ciphertext")? {
        connection.execute("ALTER TABLE items ADD COLUMN relations_ciphertext BLOB", [])?;
    }

    if !has_column(connection, "items", "icon_mode")? {
        connection.execute(
            "ALTER TABLE items ADD COLUMN icon_mode TEXT NOT NULL DEFAULT 'auto'",
            [],
        )?;
    }

    if !has_column(connection, "items", "use_count")? {
        connection.execute(
            "ALTER TABLE items ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !has_column(connection, "items", "last_used_at")? {
        connection.execute("ALTER TABLE items ADD COLUMN last_used_at TEXT", [])?;
    }

    // Schema 5 (2026-10-18): icons are now looked up through Google first and stored at their own
    // resolution (up to 192px) instead of a fixed 64px PNG. The cached 64px icons are dropped once,
    // so every tile refetches a sharp one without the user doing anything.
    let stored_version: Option<i64> = connection
        .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| {
            row.get::<_, String>(0)
        })
        .ok()
        .and_then(|value| value.parse().ok());
    if stored_version.is_some_and(|version| version < 5) {
        connection.execute("DELETE FROM site_icons", [])?;
    }

    connection.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [CURRENT_SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, StorageError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns.iter().any(|name| name == column))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_database(name: &str) -> (PathBuf, PathBuf) {
        let temp_dir = std::env::temp_dir().join(format!(
            "mimatory-storage-{}-{}",
            name,
            std::process::id()
        ));
        (temp_dir.clone(), temp_dir.join("vault.sqlite3"))
    }

    fn table_names(connection: &Connection) -> Vec<String> {
        connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .expect("table query should prepare")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("table query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("table names should collect")
    }

    #[cfg(unix)]
    #[test]
    fn vault_files_are_readable_only_by_their_owner() {
        use std::os::unix::fs::PermissionsExt;

        let (temp_dir, database_path) = temp_database("permissions");

        initialize_database(&database_path).expect("database should initialize");
        open_database(&database_path).expect("database should reopen");

        let file_mode = fs::metadata(&database_path)
            .expect("database should be readable")
            .permissions()
            .mode();
        let directory_mode = fs::metadata(&temp_dir)
            .expect("directory should be readable")
            .permissions()
            .mode();

        assert_eq!(file_mode & 0o777, 0o600, "vault file mode: {:o}", file_mode);
        assert_eq!(directory_mode & 0o777, 0o700, "vault dir mode: {:o}", directory_mode);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn initialize_database_creates_vault_tables() {
        let (temp_dir, database_path) = temp_database("create");

        initialize_database(&database_path).expect("database should initialize");

        let connection = Connection::open(&database_path).expect("database should reopen");
        let tables = table_names(&connection);

        for expected in [
            "meta",
            "vaults",
            "items",
            "item_fields",
            "item_urls",
            "tags",
            "item_tags",
            "settings",
        ] {
            assert!(tables.contains(&expected.to_string()), "missing table {expected}");
        }

        let schema_version: String = connection
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .expect("schema version should exist");

        assert_eq!(schema_version, CURRENT_SCHEMA_VERSION.to_string());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn initialize_database_adds_tags_and_trash_to_a_version_one_database() {
        let (temp_dir, database_path) = temp_database("upgrade");
        fs::create_dir_all(&temp_dir).expect("temp dir should exist");

        {
            let connection = Connection::open(&database_path).expect("database should open");
            connection.execute_batch("
                CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE vaults (
                    id TEXT PRIMARY KEY NOT NULL,
                    name_ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE items (
                    id TEXT PRIMARY KEY NOT NULL,
                    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
                    item_type TEXT NOT NULL,
                    title_ciphertext BLOB NOT NULL,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO vaults (id, name_ciphertext, created_at, updated_at)
                VALUES ('personal', x'00', '2026-01-01', '2026-01-01');
                INSERT INTO items (
                    id, vault_id, item_type, title_ciphertext, favorite, archived, created_at, updated_at
                ) VALUES ('legacy-item', 'personal', 'login', x'00', 0, 0, '2026-01-01', '2026-01-02');
                INSERT INTO meta (key, value) VALUES ('schema_version', '1');
            ").expect("version one schema should build");
        }

        initialize_database(&database_path).expect("database should upgrade");
        initialize_database(&database_path).expect("upgrading twice should be harmless");

        let connection = Connection::open(&database_path).expect("database should reopen");

        assert!(table_names(&connection).contains(&"tags".to_string()));
        assert!(has_column(&connection, "items", "trashed").expect("column check should run"));
        assert!(
            has_column(&connection, "items", "deleted_at").expect("column check should run")
        );

        let (trashed, deleted_at): (i64, Option<String>) = connection
            .query_row(
                "SELECT trashed, deleted_at FROM items WHERE id = 'legacy-item'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("legacy item should survive the upgrade");

        assert_eq!(trashed, 0);
        assert_eq!(deleted_at, None);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn initialize_database_adds_tag_styling_to_tags_that_already_exist() {
        let (temp_dir, database_path) = temp_database("tag-icon");
        fs::create_dir_all(&temp_dir).expect("temp dir should exist");

        {
            let connection = Connection::open(&database_path).expect("database should open");
            connection.execute_batch("
                CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE vaults (
                    id TEXT PRIMARY KEY NOT NULL,
                    name_ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE tags (
                    id TEXT PRIMARY KEY NOT NULL,
                    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
                    name_ciphertext BLOB NOT NULL,
                    name_hash BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (vault_id, name_hash)
                );
                INSERT INTO vaults (id, name_ciphertext, created_at, updated_at)
                VALUES ('personal', x'00', '2026-01-01', '2026-01-01');
                INSERT INTO tags (
                    id, vault_id, name_ciphertext, name_hash, created_at, updated_at
                ) VALUES ('work', 'personal', x'01', x'02', '2026-01-01', '2026-01-02');
                INSERT INTO meta (key, value) VALUES ('schema_version', '2');
            ").expect("icon-less tags table should build");
        }

        initialize_database(&database_path).expect("database should upgrade");
        initialize_database(&database_path).expect("upgrading twice should be harmless");

        let connection = Connection::open(&database_path).expect("database should reopen");
        assert!(has_column(&connection, "tags", "icon").expect("column check should run"));
        assert!(has_column(&connection, "tags", "color").expect("column check should run"));

        let (icon, color, name_ciphertext): (String, String, Vec<u8>) = connection
            .query_row(
                "SELECT icon, color, name_ciphertext FROM tags WHERE id = 'work'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("the existing tag should survive the upgrade");

        assert_eq!(icon, "tag");
        assert_eq!(color, "");
        assert_eq!(name_ciphertext, vec![1]);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn initialize_database_adds_vault_styling_to_vaults_that_already_exist() {
        let (temp_dir, database_path) = temp_database("vault-icon");
        fs::create_dir_all(&temp_dir).expect("temp dir should exist");

        {
            let connection = Connection::open(&database_path).expect("database should open");
            connection.execute_batch("
                CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE vaults (
                    id TEXT PRIMARY KEY NOT NULL,
                    name_ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE items (
                    id TEXT PRIMARY KEY NOT NULL,
                    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
                    item_type TEXT NOT NULL,
                    title_ciphertext BLOB NOT NULL,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    trashed INTEGER NOT NULL DEFAULT 0,
                    deleted_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO vaults (id, name_ciphertext, created_at, updated_at)
                VALUES ('personal', x'03', '2026-01-01', '2026-01-01');
                INSERT INTO items (
                    id, vault_id, item_type, title_ciphertext, favorite, archived, trashed,
                    created_at, updated_at
                ) VALUES ('plain-item', 'personal', 'login', x'04', 0, 0, 0, '2026-01-01', '2026-01-02');
                INSERT INTO meta (key, value) VALUES ('schema_version', '2');
            ").expect("styling-less vaults table should build");
        }

        initialize_database(&database_path).expect("database should upgrade");
        initialize_database(&database_path).expect("upgrading twice should be harmless");

        let connection = Connection::open(&database_path).expect("database should reopen");
        for column in ["icon", "color", "archived"] {
            assert!(
                has_column(&connection, "vaults", column).expect("column check should run"),
                "vaults.{column} should be added"
            );
        }
        assert!(
            has_column(&connection, "items", "archived_by_vault").expect("column check should run")
        );

        let (icon, color, archived, name_ciphertext): (String, String, i64, Vec<u8>) = connection
            .query_row(
                "SELECT icon, color, archived, name_ciphertext FROM vaults WHERE id = 'personal'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("the existing vault should survive the upgrade");

        assert_eq!(icon, "vault");
        assert_eq!(color, "");
        assert_eq!(archived, 0);
        assert_eq!(name_ciphertext, vec![3]);

        let archived_by_vault: i64 = connection
            .query_row(
                "SELECT archived_by_vault FROM items WHERE id = 'plain-item'",
                [],
                |row| row.get(0),
            )
            .expect("the existing item should survive the upgrade");

        assert_eq!(archived_by_vault, 0);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn initialize_database_adds_item_relations_to_a_version_two_database() {
        let (temp_dir, database_path) = temp_database("relations");
        fs::create_dir_all(&temp_dir).expect("temp dir should exist");

        {
            let connection = Connection::open(&database_path).expect("database should open");
            connection.execute_batch("
                CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE vaults (
                    id TEXT PRIMARY KEY NOT NULL,
                    name_ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT 'vault',
                    color TEXT NOT NULL DEFAULT '',
                    archived INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE items (
                    id TEXT PRIMARY KEY NOT NULL,
                    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
                    item_type TEXT NOT NULL,
                    title_ciphertext BLOB NOT NULL,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    trashed INTEGER NOT NULL DEFAULT 0,
                    deleted_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived_by_vault INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO vaults (id, name_ciphertext, created_at, updated_at)
                VALUES ('personal', x'05', '2026-01-01', '2026-01-01');
                INSERT INTO items (
                    id, vault_id, item_type, title_ciphertext, created_at, updated_at
                ) VALUES ('kept-item', 'personal', 'login', x'06', '2026-01-01', '2026-01-02');
                INSERT INTO meta (key, value) VALUES ('schema_version', '2');
            ").expect("relation-less items table should build");
        }

        initialize_database(&database_path).expect("database should upgrade");
        initialize_database(&database_path).expect("upgrading twice should be harmless");

        let connection = Connection::open(&database_path).expect("database should reopen");
        assert!(
            has_column(&connection, "items", "relations_ciphertext").expect("column check should run")
        );
        let (relations, title): (Option<Vec<u8>>, Vec<u8>) = connection
            .query_row(
                "SELECT relations_ciphertext, title_ciphertext FROM items WHERE id = 'kept-item'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the existing item should survive the upgrade");
        assert_eq!(relations, None);
        assert_eq!(title, vec![6]);

        let schema_version: String = connection
            .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| row.get(0))
            .expect("schema version should exist");
        assert_eq!(schema_version, CURRENT_SCHEMA_VERSION.to_string());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn initialize_database_adds_icon_mode_and_the_site_icon_cache_to_a_version_three_database() {
        let (temp_dir, database_path) = temp_database("site-icons");
        fs::create_dir_all(&temp_dir).expect("temp dir should exist");

        {
            let connection = Connection::open(&database_path).expect("database should open");
            connection.execute_batch("
                CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE vaults (
                    id TEXT PRIMARY KEY NOT NULL,
                    name_ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT 'vault',
                    color TEXT NOT NULL DEFAULT '',
                    archived INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE items (
                    id TEXT PRIMARY KEY NOT NULL,
                    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
                    item_type TEXT NOT NULL,
                    title_ciphertext BLOB NOT NULL,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    trashed INTEGER NOT NULL DEFAULT 0,
                    deleted_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived_by_vault INTEGER NOT NULL DEFAULT 0,
                    relations_ciphertext BLOB
                );
                INSERT INTO vaults (id, name_ciphertext, created_at, updated_at)
                VALUES ('personal', x'05', '2026-01-01', '2026-01-01');
                INSERT INTO items (
                    id, vault_id, item_type, title_ciphertext, created_at, updated_at,
                    relations_ciphertext
                ) VALUES ('kept-item', 'personal', 'login', x'06', '2026-01-01', '2026-01-02', x'07');
                INSERT INTO meta (key, value) VALUES ('schema_version', '3');
            ").expect("version three tables should build");
        }

        initialize_database(&database_path).expect("database should upgrade");
        initialize_database(&database_path).expect("upgrading twice should be harmless");

        let connection = Connection::open(&database_path).expect("database should reopen");
        assert!(table_names(&connection).contains(&"site_icons".to_string()));
        let (mode, relations): (String, Option<Vec<u8>>) = connection
            .query_row(
                "SELECT icon_mode, relations_ciphertext FROM items WHERE id = 'kept-item'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the existing item should survive the upgrade");
        assert_eq!(mode, "auto");
        assert_eq!(relations, Some(vec![7]));
        let schema_version: String = connection
            .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| row.get(0))
            .expect("schema version should exist");
        assert_eq!(schema_version, "5");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn upgrading_to_version_five_drops_the_low_resolution_icon_cache_once() {
        let (temp_dir, database_path) = temp_database("icon-cache-v5");
        fs::create_dir_all(&temp_dir).expect("temp dir should exist");
        initialize_database(&database_path).expect("database should build");
        let count = |connection: &Connection| -> i64 {
            connection.query_row("SELECT count(*) FROM site_icons", [], |row| row.get(0)).unwrap()
        };
        {
            let connection = Connection::open(&database_path).expect("database should open");
            connection
                .execute_batch("
                    INSERT INTO site_icons (domain_hash, icon_ciphertext, fetched_at)
                    VALUES (x'01', x'02', '2026-10-17T00:00:00Z');
                    UPDATE meta SET value = '4' WHERE key = 'schema_version';
                ")
                .expect("a version four cache row should insert");
        }
        initialize_database(&database_path).expect("database should upgrade");
        let connection = Connection::open(&database_path).expect("database should reopen");
        assert_eq!(count(&connection), 0);
        connection
            .execute(
                "INSERT INTO site_icons (domain_hash, icon_ciphertext, fetched_at)
                 VALUES (x'03', x'04', '2026-10-18T00:00:00Z')",
                [],
            )
            .expect("a fresh icon should insert");
        drop(connection);
        initialize_database(&database_path).expect("reopening should be harmless");
        let connection = Connection::open(&database_path).expect("database should reopen");
        assert_eq!(count(&connection), 1, "a version five cache survives later opens");

        let _ = fs::remove_dir_all(temp_dir);
    }
}
