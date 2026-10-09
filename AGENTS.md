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
cd src-tauri && cargo test   # Rust unit tests (vault, storage, crypto, bridge)
```

No CI workflows. No pre-commit hooks. Run `npm run build`, `npm run test` and `cargo test` manually before claiming work is done.

## Workflow

**Commit and push at the end of every exchange** (owner instruction, 2026-10-08). Once the gates above
are green, commit the work from that turn and `git push` — do not wait to be asked again, and do not
accumulate uncommitted changes across turns. Stage by file name, never `git add -A`, and check
`git status` before committing so nothing suspicious (secrets, `src-tauri/gen/`, generated `popup.css`
 churn) gets pushed.

**Check i18n completeness before every commit** (owner instruction, 2026-10-09). Every user-facing string
added or changed in that turn — labels, notices, *and* error and success messages — must exist in all three
bundles in `src/app/i18n.ts`, and in `_locales/{en,zh,ja}/messages.json` too if it is popup text.
`npm run test` runs the gate that proves it (`src/app/i18n.test.ts`: named keys defined, no English
`defaultValue` fallback, runtime-built prefixes covered); fill the gap before committing, not after.

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
  App.tsx             # Single-file UI: VaultWindow / SettingsWindow / QuickAccessWindow (no router, ~3160 lines)
  app/vaultApi.ts     # All Tauri invoke() calls — typed wrappers
  app/navigation.ts   # Sidebar nav items
  app/theme.ts        # Light/dark theme logic only — the primary colour is a token, not a preference
  app/i18n.ts         # zh (fallback) / en / ja bundles, one flat object per locale; parity is tested
  app/lockScreen.ts securityPreferences.ts totpDisplay.ts  # extracted vault logic, unit-tested
  app/designContract.test.ts # executable DESIGN.md guard — see Design conformance
  styles.css          # Tailwind + all custom CSS and the Atlassian token values in :root (~2200 lines)
  test/setup.ts       # Vitest setup (jest-dom matchers)

src-tauri/src/        # Rust backend
  lib.rs              # All #[tauri::command] handlers + AppState + plugin setup
  main.rs             # Just calls passless_lib::run()
  vault.rs            # VaultService: CRUD, encryption, session management
  storage.rs          # SQLite connection + schema + the 0600/0700 permission helpers
  crypto.rs           # AES-GCM + argon2 KDF
  biometric.rs        # Touch ID via objc2-local-authentication
  browser_bridge.rs   # HTTP server on 127.0.0.1:17891 for browser extension
  shell.rs            # Tray menu, ⌘⇧Space Quick Access window, autostart, single instance
  totp.rs             # TOTP code generation
  breach_check.rs     # Have I Been Pwned k-anonymity check

DESIGN.md             # Atlassian design contract (revision 0.0.7) — the UI source of truth, see Design conformance
browser-extension/    # Manifest V3 extension (not built by Vite)
```

## Key Conventions

- **Frontend-backend bridge**: All Rust functions registered in `lib.rs` via `tauri::generate_handler![]`. Frontend calls them through `vaultApi.ts` wrappers using `@tauri-apps/api/core` `invoke()`.
- **Three windows**: `main`, `settings` (`/?view=settings`), and `quick-access` (`/?view=quick-access`, created on demand by `shell.rs`). Any new window label must also be added to `src-tauri/capabilities/main.json` `windows`, or its `invoke()` calls are denied at runtime.
- **No router**: `App.tsx` is one file with all state; the view is chosen from the `?view=` query param.
- **There are no native JavaScript dialogs.** wry declares `WKUIDelegate` conformance but implements none of `runJavaScriptAlertPanel` / `runJavaScriptConfirmPanel` / `runJavaScriptTextInputPanel`, so in this webview `window.confirm` resolves `false` and `window.prompt` returns `null` **without showing anything at all** — the call site just silently takes the "cancelled" branch. Ask in the page instead: `.confirm-layer` + `.confirm-dialog` (`role="alertdialog"`, DESIGN.md's blanket + overlay + `rounded-xlarge` + `--measure-modal` recipe), driven by a state flag and dismissed by its own button, Escape, and a full-bleed dismiss `<button>` behind the card. The same effect that closes the two field menus closes this, and it is why a transient panel must never rely on the browser to interrupt.
- **Shell integration** (`shell.rs`): tray menu, `⌘⇧Space` Quick Access (global-shortcut + positioner, anchored `TopCenter` from the keystroke and `TrayBottomCenter` from the tray), autostart via `MacosLauncher::LaunchAgent`, single-instance refocus. Window creation must happen inside `run_on_main_thread` — macOS forbids building a webview from the global-shortcut callback's thread.
- **The vault key is never persisted.** It lives only in the `AppState` session mutex for the unlocked lifetime. Do not add an OS Keychain entry for it, write a decrypted vault cache, or ship it inside any exported file.
- **There is no export, no import, and no sync.** The vault exists only as the on-disk SQLite file. `json_transfer.rs`, `github_sync.rs` and `sync_history.rs` were deleted on 2026-10-09 together with their two settings tabs, so a forgotten master password has no recovery path — do not re-add a transport without the owner asking for one.
- **File permissions**: use `storage::set_private_permissions` (0600, re-applied on every `open_database` so existing installs self-repair, and it covers the `-journal`/`-wal`/`-shm` sidecars) and `storage::create_private_directory` (0700). Any file the app writes — today that is only the decrypted attachment temp — must go through both. A decrypted temp copy has no other confidentiality.
- **CSP**: `tauri.conf.json` `app.security.csp` is `default-src 'self'` + `script-src 'self'`, with `ipc:`/`http://ipc.localhost` in `connect-src` and `data:` in `img-src` (built CSS embeds an SVG data URI) — those two must be listed by hand because Tauri's `set_csp` only injects script/style hashes. It applies **only to packaged builds**: `PROXY_DEV_SERVER = cfg!(all(dev, mobile))`, so on macOS `tauri dev` loads Vite's `http://localhost:1430` with no CSP. Verify with `npm run tauri build`.
- **Browser bridge**: the pairing token is compared in constant time (`tokens_match`). The server is `Access-Control-Allow-Origin: *` on `127.0.0.1:17891` and returns plaintext credentials to a paired client — do not widen its reach or add endpoints that expose more.
- **Two kinds of soft delete**: `items.archived` and `items.trashed` + `deleted_at`, each with its own view at the foot of the sidebar. Tags are relational (`tags`, `item_tags`), not a JSON column on the item.
- **The TOTP seed rests masked**: `fieldValueInputProps` gives an `otp` input `type="password"` unless that field is the focused one (`focusedOtpField` in `App.tsx`), so a saved key is only legible while it is being typed in. Import runs the other way — the QR button in `OtpFieldActions` reads an image off the clipboard and stores what it finds (`src/app/otpQrImport.ts`, decoded with `jsqr`): the `secret` parameter of an `otpauth://` link, or a bare base32 key, and nothing else. The app never renders a seed as a QR image, and there is no screen-region capture — clipboard only.
- **Design tokens**: `tailwind.config.js` `theme.extend` declares the token *names* and maps each to `var(--color-<name>)`; the *values* live only in `src/styles.css` `:root`. Add a color by adding to both, never by hardcoding a hex in a component rule. Colour keys are flat (`text`, `text-subtle`, `surface`, `background-brand-bold`, `border-input`), so utilities read `text-text-subtle` / `bg-background-brand-bold` — the key already contains the role the utility supplies. A new `--measure-*` goes in the same `:root` group and gets a `maxWidth`/`minWidth`/`gridTemplateColumns` key like the rest. `tailwind.config.js` is **not** hot-reloaded: add a key and the running dev server keeps compiling against the old config, so the first `@apply` of it fails with "class does not exist" behind Vite's error overlay until `npm run dev` restarts.
- **Geometry that is not a spacing step** lives in the same `:root` as `--measure-*` (window minimum, sidebar,
  resizer gutter, native titlebar strip, lock panel, content measure) and is reached through a named Tailwind key:
  `min-w-window`, `min-w-item-list`, `max-w-content`, `max-w-lock-panel`, `max-w-settings`, `max-w-detail-header`,
  `grid-cols-settings`, `grid-rows-titlebar`, `pt-titlebar`, `w-popup`. Never write `w-[244px]`; an arbitrary
  bracket is a number nobody chose, and `src/app/designContract.test.ts` fails the build on a hex/px/rem in one.
  The one sanctioned exception is a *composite* track list — `.app-shell`'s four-column template reads the vars
  directly (`var(--measure-sidebar) var(--item-list-width, …) …`) because no single utility can express it.
- **Token alias layers already exist** — three of them, in `:root`: the `--color-*` values, the 8 `--theme-*`
  semantic aliases, and the 16 `--passless-*` aliases (~60 rules read them). Component rules should read an
  alias, and a new alias must be *derived from* `--color-*`; don't add a fourth layer. The only literal ever
  assigned to an alias is the dark-mode override `--passless-sidebar-bg: #171d26`, which has no token equivalent.
- **Dark mode**: Tailwind `darkMode: ["selector", '[data-theme="dark"]']`. Set on `document.documentElement.dataset.theme`. Dark values are `--color-*` overrides in `:root[data-theme="dark"]`. See the dark-palette gap below before adding to it.
- **`src/styles.css` has two `@layer components` blocks.** The later one wins, but the earlier one is *not* dead — many selectors exist only there. Edit the later copy when a rule appears in both.
- **Extension CSS**: Built separately by `npm run build:extension-css`. Tailwind processes `browser-extension/popup.tailwind.css` → `popup.css`.
- **Extension i18n**: the popup is localised by Chrome, not by the app — `browser-extension/_locales/{en,zh,ja}/messages.json` plus `__MSG_key__` in `manifest.json`, and `chrome.i18n.getMessage` applied to `[data-i18n]` / `[data-i18n-placeholder]` by `popup.js` (`getUILanguage()` sets `document.documentElement.lang`). English is the in-file fallback so the popup still reads if a message is missing. The desktop app's own language picker stays in-app (`src/app/i18n.ts`); the two lists are independent.
- **Env vars**: Vite exposes `VITE_*` and `TAURI_*` prefixed env vars only.
- **macOS-first**: Touch ID uses `objc2-local-authentication`. There is no OS Keychain access — the `keyring` crate and `secure_store.rs` went with the GitHub PAT on 2026-10-09.
- **Database**: Each command opens a fresh `storage::open_default_database()` connection — no connection pooling.
- **Testing**: Co-located `*.test.ts` files next to source. Vitest globals available (`describe`/`it`/`expect` without imports). Setup file loads `@testing-library/jest-dom/vitest`. Rust tests live in each module's `#[cfg(test)] mod tests`; `src-tauri/tests/` does not exist.
- **The design contract is tested, not just documented**: `src/app/designContract.test.ts` reads `src/styles.css`,
  `src/App.tsx`, `browser-extension/popup.tailwind.css` and `popup.html` and fails the suite on a hex in a component
  rule (values belong in `:root`), a Tailwind default palette class, an arbitrary `px`/`rem` bracket, a self-hosted
  `@font-face`, or a focus ring that isn't `--border-width-focused` with a `--space-025` offset. Sentence case is
  only checked in the slots that can carry styling (`@apply`, `className`, `class`), because `uppercase` is also a
  legitimate password-generator option string. `npm run test` is the gate.

## Design conformance

`DESIGN.md` at the repo root is the UI contract: Atlassian's token-first manifest (revision 0.0.7,
`theme: light`), installed verbatim on 2026-10-08. It is vendored — do not edit it to describe a
project deviation; record the deviation here instead. The old "Cupertino Vault" spec and the
`docs/superpowers/` task-page spec were deleted in the same change, and with them all 9 of their
owner rulings; the ones that were still product decisions rather than design decisions are carried
below.

Two other directories hold design-adjacent markdown and are **not** the contract. `.agent/DESIGN.md`
is a verbatim extract of Apple's macOS Human Interface Guidelines — platform behaviour guidance
(traffic lights, window chrome, keyboard focus), consulted alongside `DESIGN.md`, never a source of
tokens or hex values. `.write-technical-spec/2026_10_08_cupertino_vault_ui_000/` is the dated work
record of the previous restyle; it names the deleted Cupertino spec as its source of truth and is kept
only as history. Read it for *why* something is shaped a certain way, never for what to build.

Binding rules that the codebase has historically broken, so they are stated here as well:

- **Sentence case everywhere.** Title Case, ALL CAPS and letter-spaced caps are banned, including
  component names in prose. Initialisms and proper nouns keep their caps (`SSH key`, `API credential`,
  `Wi-Fi`, `Touch ID`, `Watchtower`, `GitHub`).
- **Spacing is the 8px scale.** Use the `space-*` steps (`p-075` = 6px, `p-200` = 16px, `p-400` = 32px).
  Tailwind's own `1..96` steps land on the same grid (`p-4` = `p-200`), so `mt-7`/`gap-3.5` are off-scale.
- **Radius is chosen by component class**, from the t-shirt scale (`rounded-medium` for buttons and
  inputs, `rounded-large` for cards), not by taste.
- **Three shadow recipes only** (`shadow-raised`, `shadow-overlay`, `shadow-overflow`). Cards sitting on
  the default plane use borders, not shadows. Never hand-write a `box-shadow`.
- **Focus ring is 2px `border-focused` offset 2px**, with the ring radius = the component radius + 2px.
  `outline-none` is only allowed where this ring is applied in the same rule.
- **Semantic roles, not accent ramps**, for brand/danger/warning/success/information/discovery. The
  10 accent hues are decoration only (item-type icons, tags); they never stand in for a status.
- **Prose body text uses `text`, not `text-subtle`.** `text-subtle`/`text-subtlest` are for captions,
  metadata and helper text only.
- **No emoji or unicode glyphs as icons.** Use `lucide-react`. Rem for type, logical CSS properties for
  spacing. One `<h1>` per window, visible labels on every field.

### Deviations from the contract (deliberate, do not "fix" without the owner)

| Area | Contract says | This project does | Why |
|------|---------------|-------------------|-----|
| Fonts | "Atlassian Sans"/"Atlassian Mono" with a system fallback | System stack only: `system-ui, -apple-system, BlinkMacSystemFont` and `ui-monospace, SFMono-Regular, Menlo` | The Atlassian faces are proprietary and no webfont is shipped. The self-hosted `JetBrainsMonoNL-SemiBold.ttf` was deleted, which also cleared its unmet SIL OFL obligation. |
| Theme | `theme: light`; the package ships no dark token table | Light is the contract; `:root[data-theme="dark"]` re-points the tokens onto the hexes the app shipped before dark mode existed | **needs-design-decision** — a real dark palette is still owed and must come from the owner, not be invented here. |
| Primary | Brand blue `#1868DB`, not user-configurable | Adopted: `--color-background-brand-bold`. The 22-colour accent picker was deleted (`theme.ts` now only switches light/dark). | Settled by the owner on 2026-10-08. |
| Window chrome | Not addressed | Native macOS traffic lights (`titleBarStyle: "Overlay"`) + `data-tauri-drag-region` | Carried over from the previous rulings; native chrome was explicitly required. |
| Responsive | Fluid down to a single-pane layout | `minWidth: 960` in `tauri.conf.json`, and `styles.css` has no `@media` rules | Carried over from the previous `<820px`/`<560px` ruling; desktop-first for now. If the window ever becomes resizable below 960 this must be revisited. |
| Extension CSS | One token source | `browser-extension/popup.tailwind.css` duplicates the `:root` subset it needs | The popup is a separate document and cannot read `src/styles.css`. The two blocks **must stay in sync**; the shared config already covers names, so only values are duplicated. |

### Documented exceptions (checked in, not drift)

- `max-w-[45%]` on the Quick Access row's secondary line: a percentage of the row, so a long subtitle
  truncates while the title keeps its share. Not a scale step and not portable to another component.
- `.column-resize-handle`'s `linear-gradient` uses 1px/2px/3px stops. That is the hairline geometry of a 6px
  gutter (`--measure-resizer`), not spacing; the px stops are the only way to centre a 1px line.
- Structural bracket utilities — `grid-cols-[minmax(0,1fr)_auto]`, `grid-rows-[auto_auto_1fr]`,
  `transition-[background-color,color]` — carry no chosen measurement, so they stay inline. The guard only
  rejects a hex/px/rem hiding in a bracket (including inside `calc()`; offsets there read `var(--space-*)`).
- `.uppercase{text-transform:uppercase}` appears in the **compiled** CSS and nowhere in the source. Tailwind
  generates it because `uppercase` is a password-generator option string in a scanned file. Dead, harmless,
  do not "fix" it by renaming the option.

### Product decisions that outlived the old spec

Still open, owned by the same rulings about *roadmap* rather than visual design:

- `⌘K` should become search / command palette. Not done — `⌘K` currently locks the vault and `⌘F`
  only focuses the list search.

Closed by the owner — these are decided, not pending:

- **No sync of any kind.** The 2026-10-08 ruling dropped the iCloud Drive / Google Drive transport in
  favour of GitHub sync plus local snapshots; on 2026-10-09 the owner deleted that too. The vault is
  local-only. Do not build a GitHub, cloud-drive, or snapshot transport.
- **No import.** The 1Password importer (`import_1pux.rs`) was deleted on 2026-10-08 and the encrypted
  Passless backup reader (`json_transfer.rs`) followed on 2026-10-09, along with both settings tabs.
  There is no supported way to bring external data in. The related open question about `.1pux`
  collections flattening to a list died with the feature.

## Known gaps

Deliberately *not* implemented yet, recorded so nobody re-derives it. Design deviations and open product
decisions are in the section above.

- **Dark palette is owed**: `:root[data-theme="dark"]` only re-points the tokens onto the hexes the app
  shipped with before dark mode existed, because the Atlassian contract in `DESIGN.md` is light-only.
  It renders, but it is not a designed dark theme. `needs-design-decision` — do not invent Atlassian
  dark hexes locally.
- **Archive and Trash**: closed 2026-10-09, and both exercised in a running window against a throwaway vault. The item detail has a Move to trash and an Archive action, and each is a nav row at the foot of the sidebar carrying its own count. Neither view reads the live items — `visibleItems` returns nothing for them, and the rows come from `vaultApi.trashed()` / `vaultApi.archived()` — because the detail pane only ever edits live items, so a state row is not selectable and carries its own way back instead: 恢复 inline, plus 永久删除 through the purge confirm in the trash only. Restore, the count and the empty state all update live. `listTitle.*` names the place ("归档" / "废纸篓") while the nav row names the state ("已归档" / "Trash"), which is why the empty state reads "归档中没有项目。" and not "已归档中没有项目。". `updated_at` doubles as the deletion timestamp because `trash_item` writes both, which is why `LoginItem` needs no `deleted_at` field.
- **Tag filtering**: closed 2026-10-09. Tags are a collapsible sidebar section, not a nav row: picking one filters the item list (`src/app/itemTags.ts`), and the item form edits tags as chips. The aggregate "tagged items" list went with the row — a tag is the only way in, and the section keeps its empty state visible when there are none. Tags stay case-insensitive — the helpers mirror `normalized_tag_names` in `vault.rs`, so "Work" and "work" are one tag in the UI and in storage.
- **Sidebar scope**: `src/app/navigation.ts` is four rows in two groups. `group: 'vault'` (`vaults`/`favorites`) sits at the top and is what the vault holds; `group: 'footer'` (`archived`/`trash`) is pinned to the foot because it is what was taken out of it, and only the region above scrolls (`.sidebar-scroll`) so the two state rows are never pushed off the bottom. Every row shows a count. Tags and categories are `<nav className="section-nav">` groups with a text-only toggle (`SidebarSectionToggle`, chevron, `aria-expanded`) and no per-item icons; both fold independently, and the state is local to `VaultWindow`. The generator lives in the settings window as its own tab, and Watchtower's old sidebar row was a duplicate of that settings tab, so it is gone. The sidebar has no Settings button — ⌘, is the only way in.
- **Runtime verification outstanding**: tray, `⌘⇧Space`, the Quick Access window and autostart are written but have never been exercised in a running app. The CSP likewise has never been checked in a packaged build, and the browser extension popup has never been loaded in a browser. What *has* now been seen in a `tauri dev` window (2026-10-09, throwaway vault): the lock screen and unlock, the item list and sidebar counts, create + validation, the full Trash chain, the Archive chain in the same view shape (move in, restore, count and empty state moving live, and no purge button there), the purge confirm panel, the create-vault panel, the detail pane's empty state, the two field menus' Escape/outside dismissal, both sidebar sections folding, the two state rows staying inside a short window, ⌘, opening settings, and the settings window's generator tab (all three modes generate, 复制密码 puts the value on the clipboard). Everything else — every hover/pressed/disabled state, the rest of the settings tabs, TOTP, attachments — is still unconfirmed.
- **Create-vault closed 2026-10-09**: the header `+` opens the same in-app panel recipe as the purge
  confirm (`vault.createVault` + one labelled name field + 取消/Create, disabled submit until the name is
  non-empty), focused by an effect rather than `autoFocus`, dismissed by Escape, 取消, or the full-bleed
  backdrop `<button>`. Verified in a running window against a throwaway vault: open → type → Return creates
  the vault, switches the picker chip to it, opens a new-item draft, and banners `messages.createdVault`.
  Note that `aria-modal="true"` prunes the backdrop out of the macOS accessibility tree, so synthetic AX
  clicks cannot reach it — only the dialog's own buttons are addressable that way.
- **Rust errors are not translated**: every `catch` in `App.tsx` does `setError(String(nextError))`, so a
  backend failure renders as `Error: invalid master password` in zh and ja. The locale bundles are clean —
  `i18n.test.ts` now fails on a `t()` that carries a `defaultValue` for a literal key, on a named key that
  no locale defines, and on the runtime-built keys (`itemTypes.*`, `vault.customFieldDefaults.*`) the
  literal sweep cannot see. Fixing the Rust side needs error *codes*, not more strings; do not paper over it
  with per-message lookups in the frontend.
- **UI strings are translated**: App.tsx carries zero `defaultValue` fallbacks as of 2026-10-09, and the
  extension popup's 11 `chrome.i18n` keys (including the three `popup.js` builds at runtime) are present in
  all of `_locales/{en,zh,ja}/messages.json`. **Before any commit, re-run this sweep** — the owner's standing
  rule is that new user-facing text, including notices and errors, lands in all three locale bundles first.
- **Leftovers from the 2026-10-09 sync/backup deletion**: `VaultService::import_login_items`, `set_encrypted_setting` and `get_encrypted_setting` are now `pub fn`s with no caller (`cargo` cannot warn about them); the `settings` row `github_sync_settings`, any `~/Library/Application Support/app.passless.desktop/sync-history/*.snapshot`, and the Keychain item `app.passless.desktop` / `github_pat` are all unreachable but were not cleaned up.
- **Remaining at-rest audit items** (the 2026-10-08 audit's #1 export encryption, #2 file permissions and #4 CSP + constant-time pairing are fixed): #3 attachment temp-file cleanup, #5 no rate limiting on the bridge or master-password attempts, #6 default security preferences / master-password strength enforced in Rust / zeroize on lock / key rotation.

