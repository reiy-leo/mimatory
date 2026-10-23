//! End-to-end sync tests: two (or three) real SQLite vault files with different salts and keys,
//! the real engine/merge/local code, against an in-memory store and — when
//! `MIMATORY_WEBDAV_URL` is set — a real WebDAV server (wsgidav).

use super::engine::{self, JoinOutcome};
use super::error::SyncError;
use super::local;
use super::records::Record;
use super::remote::{Precondition, RemoteObject, RemoteStore, STATE};
use super::webdav::WebDavStore;
use crate::crypto::{derive_key, encrypt_string_to_blob, generate_salt, VaultKey};
use crate::storage;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::{params, Connection};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

// ------------------------------------------------------------------ memory store

type Files = Arc<Mutex<HashMap<String, (Vec<u8>, u64)>>>;

struct MemStore {
    files: Files,
    /// Runs once before the next PUT of `vault.enc` — simulates another device writing in between.
    before_state_put: Option<Box<dyn FnOnce(&Files)>>,
    state_puts: usize,
}

impl MemStore {
    fn new(files: &Files) -> Self {
        MemStore { files: files.clone(), before_state_put: None, state_puts: 0 }
    }
}

impl RemoteStore for MemStore {
    fn prepare(&mut self) -> Result<(), SyncError> {
        Ok(())
    }
    fn get(&mut self, name: &str) -> Result<Option<RemoteObject>, SyncError> {
        Ok(self
            .files
            .lock()
            .unwrap()
            .get(name)
            .map(|(bytes, v)| RemoteObject { bytes: bytes.clone(), etag: format!("\"{v}\"") }))
    }
    fn put(&mut self, name: &str, bytes: Vec<u8>, pre: Precondition) -> Result<String, SyncError> {
        if name == STATE {
            self.state_puts += 1;
            if let Some(hook) = self.before_state_put.take() {
                hook(&self.files);
            }
        }
        let mut files = self.files.lock().unwrap();
        let current = files.get(name).map(|(_, v)| format!("\"{v}\""));
        match (&pre, &current) {
            (Precondition::IfNoneMatch, Some(_)) => return Err(SyncError::http(412)),
            (Precondition::IfMatch(tag), Some(cur)) if tag != cur => return Err(SyncError::http(412)),
            (Precondition::IfMatch(_), None) => return Err(SyncError::http(412)),
            _ => {}
        }
        let version = files.get(name).map(|(_, v)| v + 1).unwrap_or(1);
        files.insert(name.to_string(), (bytes, version));
        Ok(format!("\"{version}\""))
    }
}

// ------------------------------------------------------------------ devices

struct Device {
    conn: Connection,
    key: VaultKey,
    id: String,
    sync_key: Option<[u8; 32]>,
}

fn temp_path(name: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("synctest-{name}-{}-{nanos}", std::process::id())).join("vault.sqlite3")
}

fn device(name: &str, password: &str) -> Device {
    let path = temp_path(name);
    storage::initialize_database(&path).unwrap();
    let conn = storage::open_database(&path).unwrap();
    let salt = generate_salt();
    let key = derive_key(password, &salt).unwrap();
    conn.execute("INSERT INTO meta (key, value) VALUES ('master_salt', ?1)", [BASE64.encode(salt)]).unwrap();
    conn.execute(
        "INSERT INTO vaults (id, name_ciphertext, created_at, updated_at) VALUES ('personal', ?1, ?2, ?2)",
        params![encrypt_string_to_blob(&key, "Personal").unwrap(), "2026-10-01T00:00:00+00:00"],
    )
    .unwrap();
    Device { conn, key, id: name.to_string(), sync_key: None }
}

fn enc(d: &Device, value: &str) -> Vec<u8> {
    encrypt_string_to_blob(&d.key, value).unwrap()
}

/// Writes an item the way `VaultService` lays it out (4 fixed fields, urls, tags).
fn put_item(d: &Device, id: &str, vault: &str, title: &str, password: &str, tags: &[&str], updated: &str) {
    d.conn
        .execute(
            "INSERT INTO items (id, vault_id, item_type, title_ciphertext, favorite, archived, created_at, updated_at)
             VALUES (?1, ?2, 'login', ?3, 0, 0, '2026-10-01T00:00:00+00:00', ?4)
             ON CONFLICT(id) DO UPDATE SET title_ciphertext = excluded.title_ciphertext,
               vault_id = excluded.vault_id, updated_at = excluded.updated_at",
            params![id, vault, enc(d, title), updated],
        )
        .unwrap();
    d.conn.execute("DELETE FROM item_fields WHERE item_id = ?1", [id]).unwrap();
    for (pos, (k, t, v)) in [("username", "text", "rei"), ("password", "password", password), ("notes", "notes", ""), ("custom_fields", "json", "[]")]
        .into_iter()
        .enumerate()
    {
        d.conn
            .execute(
                "INSERT INTO item_fields (id, item_id, field_key, field_type, value_ciphertext, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![uuid::Uuid::new_v4().to_string(), id, k, t, enc(d, v), pos as i64],
            )
            .unwrap();
    }
    d.conn.execute("DELETE FROM item_urls WHERE item_id = ?1", [id]).unwrap();
    d.conn
        .execute(
            "INSERT INTO item_urls (id, item_id, label_ciphertext, url_ciphertext, match_type, position)
             VALUES (?1, ?2, ?3, ?4, 'domain', 0)",
            params![uuid::Uuid::new_v4().to_string(), id, enc(d, "website"), enc(d, "https://example.com")],
        )
        .unwrap();
    d.conn.execute("DELETE FROM item_tags WHERE item_id = ?1", [id]).unwrap();
    for (pos, tag) in tags.iter().enumerate() {
        let hash = crate::vault::tag_name_hash(&d.key, tag);
        let existing: Option<String> = d
            .conn
            .query_row("SELECT id FROM tags WHERE vault_id = ?1 AND name_hash = ?2", params![vault, hash], |r| r.get(0))
            .ok();
        let tag_id = existing.unwrap_or_else(|| {
            let tid = uuid::Uuid::new_v4().to_string();
            d.conn
                .execute(
                    "INSERT INTO tags (id, vault_id, name_ciphertext, name_hash, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![tid, vault, enc(d, tag), hash, updated],
                )
                .unwrap();
            tid
        });
        d.conn
            .execute("INSERT INTO item_tags (item_id, tag_id, position) VALUES (?1, ?2, ?3)", params![id, tag_id, pos as i64])
            .unwrap();
    }
}

fn add_attachment(d: &Device, item: &str, att: &str, bytes: &[u8]) {
    d.conn
        .execute(
            "INSERT INTO attachments (id, item_id, file_name_ciphertext, content_ciphertext, byte_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '2026-10-02T00:00:00+00:00')",
            params![att, item, enc(d, "note.txt"), enc(d, &BASE64.encode(bytes)), bytes.len() as i64],
        )
        .unwrap();
}

fn title(d: &Device, id: &str) -> Option<String> {
    local::read_item(&d.conn, &d.key, id).unwrap().map(|i| i.title)
}

/// Plaintext view of a device's vault, for convergence checks.
fn plain(d: &Device) -> BTreeMap<String, Record> {
    local::snapshot(&d.conn, &d.key).unwrap().into_iter().map(|(k, v)| (k, v.record)).collect()
}

fn join(d: &mut Device, store: &mut dyn RemoteStore, password: &str) {
    match engine::join(store, &d.conn, &d.key).unwrap() {
        JoinOutcome::Ready(k) => d.sync_key = Some(k),
        JoinOutcome::NeedsPassword => d.sync_key = Some(engine::unlock_remote(store, password).unwrap()),
    }
    local::clear_base(&d.conn).unwrap();
}

fn sync(d: &mut Device, store: &mut dyn RemoteStore) -> engine::SyncReport {
    let key = d.sync_key.unwrap();
    engine::run(store, &mut d.conn, &d.key, &key, &d.id).unwrap()
}

// ------------------------------------------------------------------ scenarios

fn two_devices_converge(store_a: &mut dyn RemoteStore, store_b: &mut dyn RemoteStore) {
    let mut a = device("A", "master pw");
    let mut b = device("B", "master pw");
    put_item(&a, "x", "personal", "GitHub", "hunter2", &["Work"], "2026-10-02T00:00:00+00:00");
    put_item(&a, "y", "personal", "Bank", "s3cret", &["Money"], "2026-10-02T00:00:00+00:00");
    add_attachment(&a, "x", "att-1", b"recovery codes 1234");
    a.conn.execute("UPDATE tags SET color = 'red', icon = 'star' WHERE vault_id = 'personal'", []).unwrap();
    put_item(&b, "z", "personal", "Mail", "pw-z", &[], "2026-10-03T00:00:00+00:00");

    // A creates the remote: manifest wrapped under A's own key, no password prompt.
    match engine::join(store_a, &a.conn, &a.key).unwrap() {
        JoinOutcome::Ready(k) => a.sync_key = Some(k),
        JoinOutcome::NeedsPassword => panic!("first device should create the remote"),
    }
    sync(&mut a, store_a);

    // B has another salt: the local key cannot unwrap, the master password can.
    assert!(matches!(engine::join(store_b, &b.conn, &b.key).unwrap(), JoinOutcome::NeedsPassword));
    assert!(matches!(engine::unlock_remote(store_b, "wrong"), Err(SyncError::RemotePasswordWrong)));
    join(&mut b, store_b, "master pw");
    let report = sync(&mut b, store_b);
    assert!(report.pulled >= 3, "B pulls A's items, tags: {report:?}");
    assert_eq!(title(&b, "x").as_deref(), Some("GitHub"));
    assert_eq!(local::attachment_bytes(&b.conn, &b.key, "att-1").unwrap().unwrap(), b"recovery codes 1234");
    sync(&mut a, store_a);
    assert_eq!(title(&a, "z").as_deref(), Some("Mail"));
    assert_eq!(plain(&a), plain(&b), "both vaults hold the same records");

    // Idle rounds change nothing.
    let idle = sync(&mut a, store_a);
    assert_eq!((idle.pulled, idle.pushed), (0, 0));

    // Concurrent edits to the same item: the later one wins everywhere.
    put_item(&a, "x", "personal", "GitHub (A)", "hunter2", &["Work"], "2026-10-10T00:00:00+00:00");
    put_item(&b, "x", "personal", "GitHub (B)", "hunter3", &["Work"], "2026-10-11T00:00:00+00:00");
    sync(&mut a, store_a);
    sync(&mut b, store_b);
    sync(&mut a, store_a);
    assert_eq!(title(&a, "x").as_deref(), Some("GitHub (B)"));
    assert_eq!(plain(&a), plain(&b));

    // Archive + trash state, a new vault, a purge.
    a.conn.execute("UPDATE items SET archived = 1, updated_at = '2026-10-12T00:00:00+00:00' WHERE id = 'y'", []).unwrap();
    b.conn
        .execute("UPDATE items SET trashed = 1, deleted_at = '2026-10-12T00:00:00+00:00', updated_at = '2026-10-12T00:00:00+00:00' WHERE id = 'z'", [])
        .unwrap();
    b.conn
        .execute(
            "INSERT INTO vaults (id, name_ciphertext, created_at, updated_at, color) VALUES ('work', ?1, ?2, ?2, 'blue')",
            params![enc(&b, "Work"), "2026-10-12T00:00:00+00:00"],
        )
        .unwrap();
    put_item(&b, "w", "work", "VPN", "vpn-pw", &["Infra"], "2026-10-12T00:00:00+00:00");
    sync(&mut a, store_a);
    sync(&mut b, store_b);
    sync(&mut a, store_a);
    assert_eq!(plain(&a), plain(&b));
    let y = local::read_item(&b.conn, &b.key, "y").unwrap().unwrap();
    assert!(y.archived);
    let z = local::read_item(&a.conn, &a.key, "z").unwrap().unwrap();
    assert!(z.trashed);
    assert_eq!(local::read_item(&a.conn, &a.key, "w").unwrap().unwrap().vault_id, "work");

    b.conn.execute("DELETE FROM items WHERE id = 'z'", []).unwrap();
    sync(&mut b, store_b);
    sync(&mut a, store_a);
    assert_eq!(title(&a, "z"), None, "purge propagates as a tombstone");

    // Delete on one side, edit on the other: the edit wins.
    a.conn.execute("DELETE FROM items WHERE id = 'w'", []).unwrap();
    put_item(&b, "w", "work", "VPN (edited)", "vpn-pw2", &["Infra"], "2026-10-13T00:00:00+00:00");
    sync(&mut a, store_a);
    sync(&mut b, store_b);
    sync(&mut a, store_a);
    assert_eq!(title(&a, "w").as_deref(), Some("VPN (edited)"));
    assert_eq!(plain(&a), plain(&b));

    // Dissolve "work" on B: move items to personal, delete the vault.
    put_item(&b, "w", "personal", "VPN (edited)", "vpn-pw2", &[], "2026-10-14T00:00:00+00:00");
    b.conn.execute("DELETE FROM tags WHERE vault_id = 'work'", []).unwrap();
    b.conn.execute("DELETE FROM vaults WHERE id = 'work'", []).unwrap();
    sync(&mut b, store_b);
    sync(&mut a, store_a);
    assert_eq!(plain(&a), plain(&b));
    let vaults: i64 = a.conn.query_row("SELECT COUNT(*) FROM vaults WHERE id = 'work'", [], |r| r.get(0)).unwrap();
    assert_eq!(vaults, 0);

    // A third device joins later and gets everything.
    let mut c = device("C", "master pw");
    join(&mut c, store_b, "master pw");
    sync(&mut c, store_b);
    assert_eq!(plain(&c), plain(&a));
}

#[test]
fn two_devices_converge_through_memory_store() {
    let files: Files = Arc::default();
    let (mut sa, mut sb) = (MemStore::new(&files), MemStore::new(&files));
    two_devices_converge(&mut sa, &mut sb);
    // Nothing on the remote is plaintext.
    for (name, (bytes, _)) in files.lock().unwrap().iter() {
        let text = String::from_utf8_lossy(bytes);
        for secret in ["hunter2", "GitHub", "recovery codes", "Work", "s3cret"] {
            assert!(!text.contains(secret), "{name} leaks {secret}");
        }
    }
}

#[test]
fn a_concurrent_write_412s_and_the_round_remerges() {
    let files: Files = Arc::default();
    let mut a = device("A412", "pw");
    let mut b = device("B412", "pw");
    let mut store_a = MemStore::new(&files);
    let mut store_b = MemStore::new(&files);
    join(&mut a, &mut store_a, "pw");
    sync(&mut a, &mut store_a);
    join(&mut b, &mut store_b, "pw");
    sync(&mut b, &mut store_b);

    put_item(&a, "fromA", "personal", "From A", "a", &[], "2026-10-05T00:00:00+00:00");
    put_item(&b, "fromB", "personal", "From B", "b", &[], "2026-10-05T00:00:00+00:00");
    // Just before A writes, B completes a whole round (with its own store) — A's If-Match fails.
    let b_key = b.sync_key.unwrap();
    let b_conn_path: std::path::PathBuf = b.conn.path().unwrap().into();
    let b_vault_key = b.key;
    store_a.before_state_put = Some(Box::new(move |files: &Files| {
        let mut other = MemStore::new(files);
        let mut conn = storage::open_database(&b_conn_path).unwrap();
        engine::run(&mut other, &mut conn, &b_vault_key, &b_key, "B412").unwrap();
    }));
    sync(&mut a, &mut store_a);
    assert!(store_a.state_puts >= 2, "A retried after 412");
    sync(&mut b, &mut store_b);
    assert_eq!(title(&a, "fromB").as_deref(), Some("From B"));
    assert_eq!(title(&b, "fromA").as_deref(), Some("From A"));
    assert_eq!(plain(&a), plain(&b));
}

#[test]
fn a_record_edited_during_the_round_is_not_overwritten() {
    let files: Files = Arc::default();
    let mut a = device("Aedit", "pw");
    let mut b = device("Bedit", "pw");
    let (mut sa, mut sb) = (MemStore::new(&files), MemStore::new(&files));
    put_item(&a, "x", "personal", "Old", "p", &[], "2026-10-02T00:00:00+00:00");
    join(&mut a, &mut sa, "pw");
    sync(&mut a, &mut sa);
    join(&mut b, &mut sb, "pw");
    sync(&mut b, &mut sb);
    put_item(&b, "x", "personal", "Remote edit", "p", &[], "2026-10-03T00:00:00+00:00");
    sync(&mut b, &mut sb);

    // A takes a snapshot, then the user edits x before the apply step.
    let snapshot = local::snapshot(&a.conn, &a.key).unwrap();
    put_item(&a, "x", "personal", "Typed during sync", "p", &[], "2026-10-04T00:00:00+00:00");
    let remote_record = {
        let obj = sa.get(STATE).unwrap().unwrap();
        let state = engine::decode_state(&a.sync_key.unwrap(), &obj.bytes).unwrap();
        state.entries["item:x"].record.clone().unwrap()
    };
    let ops = vec![super::merge::LocalOp::Upsert("item:x".into(), remote_record)];
    let skipped = local::apply(&mut a.conn, &a.key, &ops, &snapshot, &HashMap::new(), &BTreeMap::new(), &BTreeMap::new()).unwrap();
    assert_eq!(skipped, vec!["item:x".to_string()]);
    assert_eq!(title(&a, "x").as_deref(), Some("Typed during sync"));
    // The next round sees A's edit as newer and pushes it.
    sync(&mut a, &mut sa);
    sync(&mut b, &mut sb);
    assert_eq!(title(&b, "x").as_deref(), Some("Typed during sync"));
}

#[test]
fn sync_config_is_encrypted_at_rest() {
    use super::config::{self, Provider, SyncConfig};
    let d = device("cfg", "pw");
    let cfg = SyncConfig {
        provider: Provider::Webdav { url: "https://dav.example/".into(), username: "rei".into(), password: "app-pass-123".into() },
        device_id: "dev".into(),
        sync_key: Some(BASE64.encode([7_u8; 32])),
        last_sync_at: None,
        connected_at: "now".into(),
    };
    config::save(&d.conn, &d.key, &cfg).unwrap();
    let raw: Vec<u8> = d.conn.query_row("SELECT value_ciphertext FROM settings WHERE key = 'sync_config'", [], |r| r.get(0)).unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("app-pass-123"));
    assert!(!format!("{:?}", cfg).contains("app-pass-123"));
    assert_eq!(config::load(&d.conn, &d.key).unwrap(), Some(cfg));
    let other = derive_key("pw", &generate_salt()).unwrap();
    assert!(config::load(&d.conn, &other).is_err());
}

/// Against a real WebDAV server, e.g.:
/// `wsgidav --host 127.0.0.1 --port 18080 --root /tmp/dav --auth-file …` and
/// `MIMATORY_WEBDAV_URL=http://127.0.0.1:18080/ MIMATORY_WEBDAV_USER=… MIMATORY_WEBDAV_PASS=…`.
#[test]
fn two_devices_converge_through_webdav() {
    let Ok(url) = std::env::var("MIMATORY_WEBDAV_URL") else {
        eprintln!("MIMATORY_WEBDAV_URL not set; skipping WebDAV e2e");
        return;
    };
    let user = std::env::var("MIMATORY_WEBDAV_USER").unwrap_or_default();
    let pass = std::env::var("MIMATORY_WEBDAV_PASS").unwrap_or_default();
    let mut sa = WebDavStore::new(&url, &user, &pass).unwrap();
    let mut sb = WebDavStore::new(&url, &user, &pass).unwrap();
    two_devices_converge(&mut sa, &mut sb);

    // Conditional writes are honoured by the server.
    let obj = sa.get(STATE).unwrap().unwrap();
    assert!(!obj.etag.is_empty(), "server returns an ETag");
    // (A different size: wsgidav's ETag is inode-mtime(seconds)-size, so an identical-size rewrite
    // within the same second keeps the same ETag — a server weakness noted in .agent/sync.md.)
    let mut grown = obj.bytes.clone();
    grown.push(b' ');
    sa.put(STATE, grown, Precondition::IfMatch(obj.etag.clone())).unwrap();
    let err = sb.put(STATE, obj.bytes.clone(), Precondition::IfMatch(obj.etag.clone())).unwrap_err();
    assert!(err.is_conflict(), "stale If-Match → 412, got {err}");
    let err = sb.put(super::remote::MANIFEST, b"x".to_vec(), Precondition::IfNoneMatch).unwrap_err();
    assert!(err.is_conflict());

    // Wrong credentials map to 401 with its gloss.
    let mut bad = WebDavStore::new(&url, &user, "wrong-password").unwrap();
    let err = bad.prepare().unwrap_err();
    assert_eq!(err.http_status(), Some(401));
    assert!(err.to_string().starts_with("401 未授权"));
}
