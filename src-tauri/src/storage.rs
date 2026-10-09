use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const CURRENT_SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("could not determine an app data directory")]
    MissingDataDirectory,
    #[error("filesystem error: {0}")]
    Filesystem(#[from] std::io::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub fn default_database_path() -> Result<PathBuf, StorageError> {
    let base_dir = dirs::data_dir().ok_or(StorageError::MissingDataDirectory)?;
    Ok(base_dir.join("Passless").join("passless.sqlite3"))
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

pub fn open_default_database() -> Result<Connection, StorageError> {
    let database_path = default_database_path()?;
    initialize_database(&database_path)?;
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
            updated_at TEXT NOT NULL
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
            updated_at TEXT NOT NULL
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
            "passless-storage-{}-{}",
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
}
