# AGENTS.md

## Project

Tauri v2 desktop password manager. React 18 + TypeScript frontend, Rust backend with encrypted SQLite vault. Also ships a Manifest V3 browser extension (autofill via local HTTP bridge on `127.0.0.1:17891`).

## Commands

```bash
npm run dev          # Vite dev server on :1430 (Tauri launches this automatically)
npm run build        # Runs: tailwindcss (extension CSS) → tsc → vite build
npm run test         # Vitest (jsdom environment, @testing-library/react)
npm run lint:fix     # biome check --write (JS/TS, CSS, JSON)
npm run tauri dev    # Full Tauri desktop app (builds frontend + Rust backend)
npm run tauri build  # Production .app bundle — the only build where the CSP takes effect
cd src-tauri && cargo test   # Rust unit tests (vault, storage, crypto, backups, bridge)
```

No CI workflows. No pre-commit hooks. Run `npm run build`, `npm run test` and `cargo test` manually before claiming work is done.

## Linting & Formatting

Biome (not ESLint/Prettier). Config: `biome.json`.

- JS/TS: 2-space indent, single quotes, no semicolons
- CSS: 2-space indent, double quotes, no trailing newline
- JSON: tab indent, sorted keys
- Linter auto-sorts imports, properties, attributes, and interface members
- Tailwind CSS requires `css.parser.tailwindDirectives: true` — without it every `@apply` is a parse error and Biome silently skips linting *and* formatting that file. (`noUnknownAtRules.ignore: ["tailwind"]` is a Biome 1.x workaround that does nothing here.)
- `browser-extension/popup.css` is excluded from checks: it is generated. Edit `popup.tailwind.css` instead.
- **Rust is not rustfmt-clean — never run `cargo fmt`.** It would rewrite the whole crate on top of whatever change you are making. Match the surrounding style by hand and keep lines under ~100 columns.

Run with: `npm run lint:fix` (or `npx biome check --write .`)

## Architecture

```
src/                  # React frontend
  main.tsx            # ReactDOM entry
  App.tsx             # Single-file UI: VaultWindow / SettingsWindow / QuickAccessWindow (no router, ~2900 lines)
  app/vaultApi.ts     # All Tauri invoke() calls — typed wrappers
  app/navigation.ts   # Sidebar nav items
  app/theme.ts        # Light/dark theme logic + the accent-colour list (see Design conformance)
  app/i18n.ts         # zh (fallback) / en / ja bundles, one flat object per locale; parity is tested
  app/lockScreen.ts securityPreferences.ts totpDisplay.ts  # extracted vault logic, unit-tested
  styles.css          # Tailwind + all custom CSS and the --color-* token values (~2050 lines)
  test/setup.ts       # Vitest setup (jest-dom matchers)

public/fonts/         # Self-hosted JetBrainsMonoNL-SemiBold.ttf (see Design conformance #5)

src-tauri/src/        # Rust backend
  lib.rs              # All #[tauri::command] handlers + AppState + plugin setup
  main.rs             # Just calls passless_lib::run()
  vault.rs            # VaultService: CRUD, encryption, session management
  storage.rs          # SQLite connection + schema + the 0600/0700 permission helpers
  crypto.rs           # AES-GCM + argon2 KDF
  secure_store.rs     # macOS Keychain (keyring crate)
  biometric.rs        # Touch ID via objc2-local-authentication
  browser_bridge.rs   # HTTP server on 127.0.0.1:17891 for browser extension
  github_sync.rs      # Encrypted vault sync to GitHub repos (ruling #2 wants this replaced)
  sync_history.rs     # On-disk vault snapshots: manual, and automatic before GitHub sync
  shell.rs            # Tray menu, ⌘⇧Space Quick Access window, autostart, single instance
  totp.rs             # TOTP code generation
  breach_check.rs     # Have I Been Pwned k-anonymity check
  import_1pux.rs      # 1Password .1pux import (see Known gaps — not trustworthy)
  json_transfer.rs    # Encrypted vault backup export/import (legacy plain JSON still reads)

docs/design/          # Cupertino Vault design spec — the UI source of truth (see Design conformance)
docs/superpowers/     # 2026-07-01 task-page spec: from a different project, do not copy its tokens
browser-extension/    # Manifest V3 extension (not built by Vite)
```

## Key Conventions

- **Frontend-backend bridge**: All Rust functions registered in `lib.rs` via `tauri::generate_handler![]`. Frontend calls them through `vaultApi.ts` wrappers using `@tauri-apps/api/core` `invoke()`.
- **Three windows**: `main`, `settings` (`/?view=settings`), and `quick-access` (`/?view=quick-access`, created on demand by `shell.rs`). Any new window label must also be added to `src-tauri/capabilities/main.json` `windows`, or its `invoke()` calls are denied at runtime.
- **No router**: `App.tsx` is one file with all state; the view is chosen from the `?view=` query param.
- **Shell integration** (`shell.rs`): tray menu, `⌘⇧Space` Quick Access (global-shortcut + positioner, anchored `TopCenter` from the keystroke and `TrayBottomCenter` from the tray), autostart via `MacosLauncher::LaunchAgent`, single-instance refocus. Window creation must happen inside `run_on_main_thread` — macOS forbids building a webview from the global-shortcut callback's thread.
- **The vault key is never persisted.** It lives only in the `AppState` session mutex for the unlocked lifetime. Do not cache it in the Keychain, write a decrypted vault cache, or embed it in a backup file.
- **Backup files are encrypted** (`json_transfer.rs`, format `passless-backup-v1`): Argon2id over a *typed backup password* plus a random per-file salt → AES-256-GCM envelope. Deliberately *not* keyed with the session key, so a backup restores on a fresh install with a different vault salt. Commands `export_backup_file`, `import_json_file`, `preview_import_file` all take `BackupRequest { path, password }`; pre-encryption plain JSON exports still import.
- **File permissions**: use `storage::set_private_permissions` (0600, re-applied on every `open_database` so existing installs self-repair, and it covers the `-journal`/`-wal`/`-shm` sidecars) and `storage::create_private_directory` (0700). Any file the app writes — snapshot, backup, decrypted attachment temp — must go through both. A decrypted temp copy has no other confidentiality.
- **CSP**: `tauri.conf.json` `app.security.csp` is `default-src 'self'` + `script-src 'self'`, with `ipc:`/`http://ipc.localhost` in `connect-src` and `data:` in `img-src` (built CSS embeds an SVG data URI) — those two must be listed by hand because Tauri's `set_csp` only injects script/style hashes. It applies **only to packaged builds**: `PROXY_DEV_SERVER = cfg!(all(dev, mobile))`, so on macOS `tauri dev` loads Vite's `http://localhost:1430` with no CSP. Verify with `npm run tauri build`.
- **Browser bridge**: the pairing token is compared in constant time (`tokens_match`). The server is `Access-Control-Allow-Origin: *` on `127.0.0.1:17891` and returns plaintext credentials to a paired client — do not widen its reach or add endpoints that expose more.
- **Two kinds of soft delete**: `items.archived` (reversible, surfaced in the UI) and `items.trashed` + `deleted_at` (Trash — see Known gaps). Tags are relational (`tags`, `item_tags`), not a JSON column on the item.
- **Design tokens**: `tailwind.config.js` `theme.extend` declares the token *names* and maps each to `var(--color-<name>)`; the *values* live only in `src/styles.css` `:root`. Add a color by adding to both, never by hardcoding a hex in a component rule.
- **Token alias layers already exist** — three of them, in `:root`: the `--color-*` values, the `--theme-*` semantic aliases (`styles.css:79-86`), and the `--passless-*` aliases (`styles.css:87-101`, read by ~110 rules, the ones the accent picker overrides). Component rules should read an alias, and a new alias must be *derived from* `--color-*`; don't add a fourth layer. The only literal assigned to an alias is a dark-mode override with no token equivalent, `--passless-sidebar-bg: #171d26`.
- **Dark mode**: Tailwind `darkMode: ["selector", '[data-theme="dark"]']`. Set on `document.documentElement.dataset.theme`. Dark values are `--color-*` overrides in `:root[data-theme="dark"]`.
- **`src/styles.css` has two `@layer base` and two `@layer components` blocks.** The later ones win, but the earlier ones are *not* dead — ~149 selectors exist only there. Edit the later copy when a rule appears in both.
- **Extension CSS**: Built separately by `npm run build:extension-css`. Tailwind processes `browser-extension/popup.tailwind.css` → `popup.css`.
- **Env vars**: Vite exposes `VITE_*` and `TAURI_*` prefixed env vars only.
- **macOS-first**: Keychain uses `apple-native` feature. Touch ID uses `objc2-local-authentication`. `keyring` crate is the cross-platform abstraction.
- **Database**: Each command opens a fresh `storage::open_default_database()` connection — no connection pooling.
- **Testing**: Co-located `*.test.ts` files next to source. Vitest globals available (`describe`/`it`/`expect` without imports). Setup file loads `@testing-library/jest-dom/vitest`. Rust tests live in each module's `#[cfg(test)] mod tests`; `src-tauri/tests/` does not exist.

## Design conformance

`docs/design/2026-10-07-cupertino-vault-design-spec.md` (Stitch "Cupertino Vault" export) is the UI target. On 2026-10-08 the owner ruled on the 9 conflicts between it and the code; these are settled, do not re-litigate them.

| # | Ruling | Status |
|---|--------|--------|
| 1 | `⌘K` becomes search / command palette | Not done — `⌘K` currently locks the vault (`App.tsx:490`); `⌘F` only focuses the list search |
| 2 | Sync moves to iCloud Drive / Google Drive files | Not done — `github_sync.rs` still owns sync |
| 3 | Traffic lights: native, never self-drawn | Done — `titleBarStyle: "Overlay"` + `data-tauri-drag-region` |
| 4 | Breakpoints `<820px` (two-pane) / `<560px` (single-pane) | Not done — `minWidth: 960` in `tauri.conf.json` prevents both, and `styles.css` has no `@media` rules at all |
| 5 | `-apple-system` UI, JetBrains Mono 600 for secrets | Done, **except the licence text below** |
| 6 | Primary is `#0572EC` and is *not* user-configurable | Not done — the 22-colour accent picker is live (`theme.ts` `themeColors`, `App.tsx:2377`); removing it is what makes the token layer the single source of colour |
| 7 | Dark mode supported | Partial — it renders, but the design package ships no dark token table, so `:root[data-theme="dark"]` (`styles.css:111`) re-points the app's pre-dark values onto the token names. A real dark palette is still owed |
| 8 | Explain `.1pux` category flattening | Unanswered — see Known gaps |
| 9 | Design tokens in `tailwind.config.js` `theme.extend` | Done — names there, values in `styles.css` `:root` |

## Known gaps

Deliberately *not* implemented yet, recorded so nobody re-derives it. Design rulings still open are in the table above.

- **Licence blocker**: `public/fonts/JetBrainsMonoNL-SemiBold.ttf` is redistributed, and the SIL Open Font License 1.1 text it requires has not been added. Do not ship or publish until it is.
- **Trash UI**: the `items.trashed` / `deleted_at` columns, the four Rust commands and the `vaultApi.trash/trashed/restoreFromTrash/purge` wrappers are implemented and registered; no screen calls them, and there is no Trash nav item in `navigation.ts`.
- **Tag filtering**: `tags` and `item_tags` are populated relationally, but the sidebar only switches to "items that have any tags". Per-tag filtering UI is not built.
- **Runtime verification outstanding**: tray, `⌘⇧Space`, the Quick Access window and autostart are written but have never been exercised in a running app. The CSP likewise has never been checked in a packaged build.
- **`.1pux` import is untrustworthy**: `import_1pux.rs` parses a shape it invented, and its only test asserts that invented shape, so passing tests do not prove it reads a real 1Password export. Ruling #8 (why the design's collections flatten to a list) is still unanswered because of this.
- **Remaining at-rest audit items** (the 2026-10-08 audit's #1 export encryption, #2 file permissions and #4 CSP + constant-time pairing are fixed): #3 attachment temp-file cleanup, #5 no rate limiting on the bridge or master-password attempts, #6 default security preferences / master-password strength enforced in Rust / zeroize on lock / key rotation.

