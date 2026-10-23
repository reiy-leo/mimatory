# Sync — design (2026-10-23)

Owner request 2026-10-23: "添加google同步… 同时添加webdav，和navill项目一样支持两种方式". This **reverses** the
2026-10-09 "No sync of any kind" ruling. The model mirrors Navill's (`repo/navill/src/lib/sync/`): Google Drive
**or** WebDAV, one at a time; disconnect and switch freely; switching uploads the full local vault to the new
target and leaves the old target's data in place; merge, never overwrite; ETag / `If-Match`, and on 412 re-pull,
merge, retry.

Status: Rust core, Tauri commands and tests are done (branch `feat/sync`). **No UI yet** — see "Follow-up UI task".

## Code

| File | Role |
|---|---|
| `src-tauri/src/sync/records.rs` | The plaintext records that sync: `Vault`, `Tag`, `Item` (+ fields, urls, tag names, attachment metadata) |
| `sync/merge.rs` | Pure three-way merge (local × remote × base), tombstones, LWW. All rules unit-tested |
| `sync/local.rs` | SQLite side: snapshot → records, apply merged records (re-encrypted under this device's key), `sync_base` |
| `sync/cipher.rs` | Sync key, manifest (wrapped key + KDF params), AES-256-GCM envelopes with AAD |
| `sync/engine.rs` | One round (download → merge → upload with `If-Match` → apply) and the connect handshake |
| `sync/remote.rs` | `RemoteStore` trait: `get` (bytes + ETag), conditional `put` |
| `sync/webdav.rs` | WebDAV store (Basic auth, PROPFIND/MKCOL/GET/PUT, `If-Match`, `If-None-Match: *`) |
| `sync/google_drive.rs` | Drive `appDataFolder` store |
| `sync/oauth.rs` | Desktop Google OAuth: system browser, loopback `127.0.0.1:<random>`, PKCE S256, refresh, revoke |
| `sync/config.rs` | This device's config (provider, credentials, device id, sync key) — encrypted `settings` row |
| `sync/commands.rs` | Tauri commands, `sync:status` event, background trigger thread |
| `src/app/syncApi.ts` | Typed TS wrappers (no UI) |

## Remote layout

WebDAV — one folder in the server root, created on connect:

```
mimatory/
  manifest.json        plaintext, non-secret: format, KDF params + salt, wrapped sync key
  vault.enc            the whole merged state, AES-256-GCM under the sync key (AAD "mimatory-sync/v1/state")
  blobs/<attachment-id>.bin   one per attachment, AES-256-GCM under the sync key (AAD binds the id)
```

Renamed with the app on 2026-10-23 (Passless → Mimatory): folder `mimatory/`, manifest `app: "mimatory"`, AAD and
HMAC domain prefixes `mimatory-sync…`, env vars `MIMATORY_GOOGLE_CLIENT_ID` / `MIMATORY_GOOGLE_CLIENT_SECRET` /
`MIMATORY_WEBDAV_*`. No remote or `sync_base` data had been written by then, so nothing was migrated; a remote
written by a pre-rename build would not be readable (different folder and AAD).

Google Drive — the hidden `appDataFolder` (scope `drive.appdata`, invisible in the user's Drive and to other apps),
flat: `manifest.json`, `vault.enc`, `blobs.<attachment-id>.bin`.

`vault.enc` decrypts to `{format: 1, entries: {<record key>: {modified, device, record?}}}`; a missing `record` is
a tombstone. Record keys: `vault:<id>`, `tag:<vault id>:<lowercased name>` (tags have no cross-device id),
`item:<id>`. Envelope JSON: `{v: 1, alg: "A256GCM", nonce, ct}` (base64).

**Synced**: vaults (name, icon, colour, archived), tags (name, icon, colour), items (type, title, favourite,
archived, archived-by-vault, trashed + deleted_at, created/updated, encrypted relation JSON verbatim — parent,
related, sign-in links — icon mode, every field incl. custom-field JSON, passkey private keys and TOTP seeds, URLs
with autofill behaviour, tag names, attachments).
**Not synced**: `use_count` / `last_used_at` (per-device stats), the website-icon cache, `settings`,
`audit_events`, the master verifier/salt (each device keeps its own), field/url row ids (regenerated on save).

## Crypto — how a new device reads the data

Each device's vault key is `Argon2id(master password, that device's salt)`, so two independently set-up devices
never share a key, and the vault key must stay unpersisted (AGENTS.md). So the remote is encrypted under a
separate random 256-bit **sync key**:

1. **First device** (empty remote): generates the sync key and writes `manifest.json` with
   `kdf = {argon2id, v=19, m=19456 KiB, t=2, p=1, salt = this device's master salt}` and
   `wrapped_key = AES-GCM(vault key, sync key)`. Because the vault key *is* Argon2id(password, that salt) with the
   app's defaults, no password prompt is needed.
2. **Another device** connecting: tries to unwrap with its own vault key (works only if it shares the salt). It
   does not, so status becomes `needs_remote_password` and the UI asks once for **the remote vault's master
   password** (`sync_unlock_remote`): `Argon2id(password, manifest salt)` unwraps the sync key. A wrong password
   fails AES-GCM → `remote_password_wrong`.
3. A brand-new install sets up a local vault first (any master password — ideally the same), then connects as in 2.
4. Every device keeps its copy of the sync key **encrypted under its own vault key** in the `sync_config`
   settings row, together with the WebDAV app password or the Google refresh token. Nothing sync-related is on disk
   in plaintext; while locked none of it is readable and no round runs. Touch ID unlocks sync too (the vault key
   in the biometric session decrypts the row).

Only ciphertext and the non-secret KDF parameters leave the device. A hostile server can withhold or roll back
`vault.enc`, but cannot read or forge it (AEAD), swap a blob between attachments (AAD binds the id) or plant
absurd KDF params (capped at 1 GiB / t≤64 / p≤16).

## Merge

Per record key, three-way against the **base** (keyed HMAC of each record as last agreed; the `sync_base` table
holds `HMAC(vault key, record key) → HMAC(vault key, record JSON), modified` — no plaintext, not even tag names):

- only one side changed → that side wins (so a skewed clock never loses a one-sided edit);
- both changed, same content → nothing;
- both changed differently → **last writer wins** by `modified` (RFC 3339 compare), then device id (larger wins —
  the same on both devices);
- **delete vs edit → the edit wins**, whichever side deleted (never lose a change to a stale purge);
- a local change that did not bump `updated_at` (tag restyle, relation link) is stamped with the time the round
  noticed it.

Deletes (purge, tag removal, vault dissolve) become tombstones and stay in `vault.enc` (no pruning yet). Trash and
archive are ordinary state and sync as such. Apply order: vaults → tags → items, deletes reversed. A vault
tombstone is not applied while the vault still holds items locally (it would cascade them away); an item whose vault
was dissolved elsewhere lands in `personal`.

**Round**: GET `vault.enc` (+ETag) → decrypt → snapshot + base → merge → upload new attachment blobs → PUT
`vault.enc` with `If-Match` (or `If-None-Match: *` for the first write) → on 412 restart from GET (nothing local
touched yet; max 4 attempts, then `conflict` "412 前置条件失败") → download needed blobs → apply in one SQLite
transaction → store the new base. A record the user edited *during* the round (local hash ≠ snapshot hash) is
skipped and keeps its old base, so the next round pushes the edit.

**Drive has no `If-Match` on uploads**: the ETag is the file's `version`, re-read right before the upload. The
race window is that gap, not a whole round; a lost race only drops the other device's last write from the remote
until it syncs again (it still has the change locally, and its base still marks it unsynced).

**Weak WebDAV ETags**: some servers (wsgidav, likely others) derive the ETag from mtime-in-seconds + size, so two
same-size writes within one second look identical to `If-Match`. Encrypted states of different content usually
differ in size; residual risk accepted, same as Navill.

## Providers and switching

- One provider at a time. `sync_connect_webdav` / `sync_connect_google` replace whatever was configured, keep the
  device id, **reset the base**, and run a round — so every local record counts as unsynced and is merged into the
  new target (full upload; whatever the new target already held is merged, not overwritten). The old target keeps
  its data; disconnect deletes nothing remote.
- **WebDAV**: server URL, username, app password; credentials only on this device (encrypted). `https://` required
  (bare host gets `https://` prepended); `http://` only for loopback (tests) — owner decision 2026-10-23: no WebDAV without TLS. No redirects followed (Basic auth must
  not follow a server elsewhere). Folder: **`mimatory/`** (product name; matches the bundle/app data folder).
- **Google**: desktop only. `MIMATORY_GOOGLE_CLIENT_ID` (+ `MIMATORY_GOOGLE_CLIENT_SECRET` if the Desktop client
  needs it — Google treats an installed app's secret as non-confidential) are read with `option_env!` at **build
  time**; without the id `google_available` is false and connect returns `google_not_configured`. Consent opens in
  the system browser (`tauri_plugin_opener::open_url`), redirect to `http://127.0.0.1:<random port>`, PKCE S256,
  `access_type=offline&prompt=consent` for a refresh token. Each round refreshes the access token; `invalid_grant`
  → `google_reauth`. Disconnect revokes the refresh token (best effort). Waiting sign-in times out after 5 min or
  `sync_cancel_connect`.
- Timeouts: connect 10 s, request 60 s. reqwest errors are stripped of their URL before display.

## Commands and events (for the UI)

| Command | Args | Result |
|---|---|---|
| `sync_status` | — | `SyncStatus` |
| `sync_connect_webdav` | `url, username, password` | `SyncStatus` (after the first round, or `needs_remote_password`) |
| `sync_connect_google` | — | same; opens the browser and waits |
| `sync_cancel_connect` | — | — |
| `sync_unlock_remote` | `masterPassword` | `SyncStatus` after a round |
| `sync_disconnect` | — | `SyncStatus` |
| `sync_now` | — | `SyncStatus` |
| `sync_request` | — | — (debounced 3 s) |

Errors reject with `SyncErrorInfo {code, status, message}` — `code` is stable for i18n (`http`, `network`,
`remote_password_wrong`, `google_reauth`, `conflict`, …), `message` is short Chinese with the HTTP gloss
("401 未授权：用户名或应用密码不对", "412 前置条件失败"). `SyncStatus.state`: `locked | disconnected |
needs_remote_password | syncing | error | idle`. Events: `sync:status` (payload `SyncStatus`) on every change;
`vault:changed` when a round pulled anything (the window already reloads on it).

**Auto-sync** (`start_background`, one thread, 2 s tick): a round right after unlock, 3 s after the last
`sync_request`, and every 15 minutes while unlocked. Locked → nothing runs. A round already in flight makes a
second one a no-op (`busy` is swallowed).

## Tests (standalone crate, the full crate's `cargo test` OOMs here)

The e2e tests live in `src-tauri/src/sync/e2e.rs` (`#[cfg(test)]`), so a normal `cd src-tauri && cargo test`
on a Mac runs them (the WebDAV one only with `MIMATORY_WEBDAV_URL`/`_USER`/`_PASS` set). In the agent sandbox,
`/workspace/work/synctest` copies `crypto.rs`, `storage.rs` and `sync/*` (minus `commands.rs`) with a stub
`vault::tag_name_hash`; `sync.sh` re-copies. 33 tests: merge rules, cipher/manifest, WebDAV URL/ETag parsing,
PKCE (RFC 7636 vector), config encryption, and e2e with real SQLite vaults of **different salts/keys**: two devices
converge (items, tags + styling, attachments byte-exact, archive, trash, purge tombstone, edit-beats-delete, new
vault, vault dissolve, third device joining, idle round = no-op), a concurrent write → 412 → re-merge, an edit
during the round is not overwritten, nothing plaintext on the remote. The same convergence scenario runs against a
**real WebDAV server** (wsgidav 4.3.5 + cheroot, Basic auth) plus stale `If-Match` → 412, `If-None-Match` → 412,
wrong password → "401 未授权". Note: the sandbox has an HTTP proxy in the environment; run the WebDAV test with
the proxy variables unset or loopback goes to the proxy.

Not tested: Google Drive and OAuth against Google (needs Rei's client id), anything in a running Tauri window.

## Owner decisions (3 and 9 decided 2026-10-23; the rest still open)

1. **Different master passwords on two devices** — supported (the remote password is typed once per device). Should
   the app instead require the same master password, or offer to change the local one to match?
2. **Master-password change** (no such feature yet): the manifest stays wrapped under the *old* password, so a new
   device would need the old one. When a change feature lands it must re-wrap the manifest.
3. ~~**Both devices already have vaults**~~ — **decided (owner, 2026-10-23): merge.** Union, not first-device-wins
   (the current behaviour); both default "Personal" vaults have id `personal`, so they become one, LWW picks the name.
4. **Multi-vault**: all vaults sync, including archived ones. No per-vault opt-out.
5. **Attachments**: synced as separate blobs, no size cap, orphaned blobs (after an attachment/item is purged) are
   never deleted from the remote.
6. **Passkey private keys and TOTP seeds sync** (they are item fields). Excluding them would need a field filter.
7. **Website-icon cache is excluded** (each device refetches).
8. **Tombstones are kept forever** in `vault.enc` (small). Pruning after N days would resurrect deletions on a
   device offline longer than N.
9. ~~**`http://` WebDAV**~~ — **decided (owner, 2026-10-23): no WebDAV without TLS.** Plain `http://` stays refused
   except loopback (tests); no opt-in for a LAN NAS. Do not add one without the owner asking.
10. **Google on iOS/Android** is not wired (needs an iOS/Android OAuth client with a custom scheme / app link,
    not loopback). WebDAV works on every platform.
11. **Recovery**: sync is also the first recovery path — a remote plus the master password restores a lost vault on
    a new device. Still no recovery without the master password.

## Follow-up UI task (after the App.tsx split lands)

- Settings ▸ Sync pane: provider choice (Google Drive / WebDAV, 二选一), WebDAV form (URL, username, app password,
  hint that `mimatory/` is created in the root), Google button (hidden or disabled with a note when
  `google_available` is false), connected state (provider, URL/user, last sync, Sync Now, Disconnect / Switch).
- `needs_remote_password` → a sheet asking for the remote vault's master password (`syncApi.unlockRemote`).
- Errors: translate `SyncErrorInfo.code` in zh/en/ja (`i18n.ts`); show `status` with its gloss.
- Call `syncApi.request()` after every successful write in the window (create/update/trash/purge/archive/restore,
  favourite, tags, vaults, relations, attachments, icon mode) and on `vault:changed` from the bridge (ignore the
  ones a round itself emits if that loops — it will not: a round with nothing new pulls 0).
- Subscribe to `syncApi.onStatus` for a status line / spinner; Google connect needs a Cancel (`cancelConnect`).
- i18n for every new string, in all three bundles.
