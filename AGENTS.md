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

No CI workflows. No pre-commit hooks. Run the gates manually before claiming work is done, but run only the
ones the turn's diff needs: this is a 6-core/12-thread Intel machine and a full `cargo test` plus `vite build`
together saturate every core, so the whole computer stops responding for minutes. `.cargo/config.toml` caps
cargo at 3 jobs — do not raise it, and prefix long builds with `nice -n 10`.

- `src/**` touched: `npm run build` + `npm run test` + `npm run lint:fix`.
- `src-tauri/**` touched: `cd src-tauri && cargo test`. Use `cargo check` while chasing a type error, and
  `cargo test --no-run` once so later runs only relink the test binary.
- `npm run tauri build` only when the packaged build itself is under test (CSP, bundling): it is a release
  build of all 545 dependency crates and costs minutes of all-core CPU.

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
- **There is no text selection and no native context menu.** `@layer base` sets `user-select: none` on `*` and re-enables `text` only for `input`, `textarea`, `select` and `[contenteditable="true"]`, and one `useEffect` in `App()` (registered *before* its `?view=` early returns, so it runs in all three windows) calls `preventDefault()` on every `contextmenu` event on `window`. The webview's own "Reload" / "Save As…" / spelling panel is therefore unreachable and a credential can never be highlighted into the system clipboard by accident. Anything the user *should* be able to copy stays reachable through an explicit button (复制密码, the field menus), not through selection. A right-click that must do something installs its own `onContextMenu` on the row — that is how the tag menu opens, and it is why a category row, which has no handler, simply does nothing.
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
- **`src/styles.css` has two `@layer components` blocks.** The later one wins, but the earlier one is *not* dead — many selectors exist only there. Edit the later copy when a rule appears in both. Re-point a `background` there and it is `background-color`: the shorthand resets `background-image`/`-repeat`/`-position`, and `@layer base` hangs the `select` chevron off exactly those, so a "just change the colour" edit tiles the chevron across the control.
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
- **Archive and Trash**: closed 2026-10-09, and both exercised in a running window against a throwaway vault. The item detail reaches both from the ellipsis menu in its header (below), and each is a nav row at the foot of the sidebar carrying its own count. Neither view reads the live items — `visibleItems` returns nothing for them, and the rows come from `vaultApi.trashed()` / `vaultApi.archived()` — because the detail pane only ever edits live items, so a state row is not selectable and carries its own way back instead: 恢复 inline, plus 永久删除 through the purge confirm in the trash only. Restore, the count and the empty state all update live. `listTitle.*` names the place ("归档" / "废纸篓") while the nav row names the state ("已归档" / "Trash"), which is why the empty state reads "归档中没有项目。" and not "已归档中没有项目。". `updated_at` doubles as the deletion timestamp because `trash_item` writes both, which is why `LoginItem` needs no `deleted_at` field.
- **Tag filtering and tag metadata**: closed 2026-10-09. Tags are a collapsible sidebar section, not a nav row: picking one filters the item list (`src/app/itemTags.ts`), and the item form edits tags as chips. The aggregate "tagged items" list went with the row — a tag is the only way in, and the section keeps its empty state visible when there are none. Tags stay case-insensitive — the helpers mirror `normalized_tag_names` in `vault.rs`, so "Work" and "work" are one tag in the UI and in storage. A tag owns two styling columns beyond its name: `tags.icon` (`TEXT NOT NULL DEFAULT 'tag'`) and `tags.color` (`TEXT NOT NULL DEFAULT ''`), both read by `list_tags` and written by `update_tag`, and the row is addressed **by name, never by id** — no tag id crosses the bridge, so `update_tag` takes `from` + new `name` + `icon` + `color` and the rename propagates through `item_tags` for free because an item's tags are decrypted from the rows it links to. Four positionals made the invoke unreadable, so the bridge takes one patch object (`vaultApi.updateTag({ color, from, icon, name })`). Counts still come from the live item list, not SQL, so `tagRows(counts, tags)` joins the backend styling onto those counts by `tagKey` and falls back to `defaultTagIcon` / `defaultTagColor` for a tag no row covers — and because the styling is *not* in the item list, the sidebar only shows a new icon or colour once `list_tags` re-runs, which the `[items, mode]` effect does after every save. `src/app/tagIcons.ts` holds 42 pickable lucide glyphs and the 11 colour options (the 10 `accentHues` plus "none"); the stored colour is the **bare hue name**, never a class, and `tagColorOptions` writes each `text-accent-icon-*` / `bg-accent-icon-*` pair out in full because Tailwind scans source text for whole class names — a runtime-built `text-accent-icon-${hue}` compiles to nothing. Because the picker's accessible names are built at runtime, `tagIcons.*` and `tagColors.*` are both derived families `i18n.test.ts` checks, which means it reads `tagIcons.ts` with two regexes that must stay narrow: the icon one anchors on `{ icon: <Component>, name: 'x' }` so it does not also match the colour names.
- **Item actions live behind one ellipsis in the detail header**: closed 2026-10-10. The header's right side is 编辑 + an `Ellipsis` icon button (`aria-label` `vault.itemActions`) and nothing else — 归档 and 移到废纸篓 were deleted as buttons on 2026-10-10, and the whole set now sits in a `.add-more-menu` anchored to the trigger (`itemMenuWidth` 220, right-aligned to it). The six rows, in the owner's order: 收藏/取消收藏 (label from `selectedItem.favorite`, so it is a toggle not a pair of rows), 移动到 (only when another vault exists), 创建副本, 归档 (`.separated`), 删除 (`.is-danger`, which is the trash — there is no purge from here), and 分享 with a `<small>` hint because there is no transport: it copies the password through the same `copyPassword()` the field button uses, honouring the 90-second clipboard clear, and nothing else. 移动到 swaps the *same* panel in place (`itemMenu: 'actions' | 'move'`) rather than flying out a submenu — the trigger is at the window's right edge, so there is no room to its right — and the back row is the same label with a `ChevronLeft`. Both the button and the menu render only when `selectedItem && !isEditing`: every row acts on stored state, never on unsaved typing. Because the row left the `<form>`, the submit button reaches it by name (`<form id="item-detail-form">` + `form="item-detail-form"`), so native constraint validation and ⌘ behaviour are unchanged; `.detail-topbar` wraps, which is what keeps the controls readable at the 960px minimum width. The item-type `<select>` is gone with it — a type is chosen once, at creation (below), not edited afterwards.
- **Two traps that menu just cost**: (1) the single `useEffect` in `VaultWindow` that dismisses every transient panel builds `menuOpen` from state and lists that state in its **dep array** — a panel whose flag is missing from that array registers no listener at all, so Escape and the outside click both do nothing and it looks like the handler is broken. (2) `.menu-option.with-icon` is a *two*-track grid (`grid-cols-icon-option`), so a third child wraps under the row. A trailing chevron therefore lives inside `.menu-option-label.trailing`, whose `[minmax(0,1fr)_auto]` puts it at the label's far edge. Also from that pass: a bare `<button>` needs **no** `data-tauri-drag-region="false"` carve-out under a `deep` region — `tauri-2.12.1/src/window/scripts/drag.js` short-circuits `isDragRegion()` on `isClickableElement(el) && attr === null`, so only non-clickable wrappers (the vault picker's `<label>`) need the opt-out.
- **Moving and duplicating are Rust-side**: `move_login_item` and `duplicate_login_item` in `vault.rs`, both registered in `lib.rs`. A move stays in the *source* vault — the picker is the only way to read another one — so the command returns nothing and the frontend re-lists, drops the selection, and banners `messages.movedItem`. Every vault is decrypted by the same key, so the rows hanging off `item_id` (fields, urls, attachments) follow the item untouched; **tags are the exception**, because `tags` is vault-scoped (`vault_id NOT NULL`, `UNIQUE (vault_id, name_hash)`) — the move re-homes each tag row into the target (reusing its row when the name already exists there, otherwise inserting one that carries the source's `name_ciphertext` blob plus `icon` and `color`) and re-points `item_tags`, then prunes the source. A frontend move would silently lose a tag's styling. A duplicate must be Rust too: `custom_fields` reference an attachment as `attachment://{id}`, so copying an item in the frontend would point the copy at the original's blob row and `ON DELETE CASCADE` would take the copy's file with the original. `duplicate_login_item` copies the row set, rewrites the `attachment://` references, and returns the copy so the UI can select it; its title comes from the frontend (`vault.duplicateTitle` = "{{title}} copy" / "{{title}}のコピー" / "{{title}} 副本"), not from Rust.
- **New item asks for its type**: `vault.newItem` is 新建条目, and both its buttons (the search bar's and the empty pane's) plus ⌘N open `.confirm-layer` + `.confirm-dialog` (`role="dialog"`, `aria-labelledby`, Escape / 取消 / full-bleed backdrop dismiss, first option focused by effect) listing every type in `categoryItems`. Picking one builds that draft, sets `activeNavigation` to `category:<type>`, unfolds the 分类 section if it was folded, and then focuses and `scrollIntoView({ block: 'nearest' })`s the sidebar row through `data-item-type` — the row is looked up in `[categoryListRef]` on the next commit, because a row inside a section that was just unfolded does not exist yet. `categoryItems` is therefore the **one** type table: 17 entries in the order the vault lists them, sidebar rows and picker both, and `i18n.test.ts` reads *its* shape (`icon: <Component>, itemType: 'x' }`) to derive the `itemTypes.*` keys — the old separate `itemTypes` array of `['login', 'Login']` pairs was deleted, so widening that regex is how a new type gets its translation checked.
- **Sidebar scope**: `src/app/navigation.ts` is four rows in two groups. `group: 'vault'` (`vaults`/`favorites`) sits at the top and is what the vault holds; `group: 'footer'` (`archived`/`trash`) is pinned to the foot because it is what was taken out of it, and only the region above scrolls (`.sidebar-scroll`) so the two state rows are never pushed off the bottom. Every row shows a count. The brand block at the head of the sidebar carries the app name, the **vault picker** (moved out of the detail header on 2026-10-10, because which vault is open is not a property of one item) and its `+`; its `<label>` and button are marked `data-tauri-drag-region="false"` so the deep drag region on `.sidebar` lets them be clicked. Tags and categories are `<nav className="section-nav">` groups whose *title* is a text-only toggle (`SidebarSectionToggle`, chevron, `aria-expanded`); both fold independently and the state is local to `VaultWindow`. Their *rows* carry a 16px `lucide-react` icon: a category's comes from the `categoryItems` table (the same `itemType` → icon + `colorClass` mapping the old item-type rows used, restored 2026-10-10 after `d570e2d` had dropped it) and a tag's from `tags.icon`. A tag row and a category row are the *same* row — both are bare `.nav-item`s at the same left edge with `text-body` / `font-medium` / `min-h-400`, and the tag list's container has the same `gap-050` as `.nav-list`; the smaller-font, indented `.nav-item.tag-item` variant was removed on 2026-10-10 because the two sections stack and a different rhythm reads as a mistake, so do not re-add a per-section type or indent override. The generator lives in the settings window as its own tab, and Watchtower's old sidebar row was a duplicate of that settings tab, so it is gone. The sidebar has no Settings button — ⌘, is the only way in.
- **Runtime verification outstanding**: tray, `⌘⇧Space`, the Quick Access window and autostart are written but have never been exercised in a running app. The CSP likewise has never been checked in a packaged build, and the browser extension popup has never been loaded in a browser. What *has* now been seen in a `tauri dev` window (2026-10-09, throwaway vault): the lock screen and unlock, the item list and sidebar counts, create + validation, the full Trash chain, the Archive chain in the same view shape (move in, restore, count and empty state moving live, and no purge button there), the purge confirm panel, the create-vault panel, the detail pane's empty state, the two field menus' Escape/outside dismissal, both sidebar sections folding, the two state rows staying inside a short window, ⌘, opening settings, and the settings window's generator tab (all three modes generate, 复制密码 puts the value on the clipboard). Seen there on 2026-10-10 as well: the category rows rendering their restored icons in accent colours, and a tag row rendering its stored icon with a live count. **Synthetic pixel clicks are not a reliable way to exercise this webview** — macOS accessibility reports the webview's children at `0,0` and `click at {x,y}` hit-tests to whatever it guesses, so a click aimed at an overlay can land on the row underneath it while the screenshot still reads as "it worked". For overlay/menu/dialog behaviour the dependable route is to load the same Vite frontend in a browser against a stubbed `window.__TAURI_INTERNALS__` (an in-memory vault, invocations recorded so the command *and* payload can be asserted) and drive the real DOM — that is how the tag right-click menu, the 16-way icon picker, the rename, the delete confirm and the global no-selection / no-context-menu rules were verified, and again on 2026-10-10 for the tag row and category row sharing one left edge and one type scale (read off computed styles, not pixels), the 42-glyph grid at five columns, and a colour choice reaching `update_tag` and coming back onto the row. Prefer `mockIPC` + `mockWindows` from `@tauri-apps/api/mocks` over hand-writing `window.__TAURI_INTERNALS__` — it covers `transformCallback` and the `plugin:event|*` calls (`shouldMockEvents: true`) that `getCurrentWebview().onFocusChanged` and friends make on mount, which a bare `invoke` stub does not. Proven through that harness on 2026-10-10: the 17-row category list with live counts, the vault picker firing `switch_vault` from the sidebar, the 归档 row button firing `archive_login_item` and the count/list/empty state moving, editing + 保存更改 firing `update_login_item` **from outside the form** (the `form="item-detail-form"` link), the picker's 17 options with the first focused, its Escape and backdrop dismissal, and picking 加密钱包 / 护照 / 数据库 landing a draft of that type (`create_login_item` carries `item_type`) while the sidebar scrolls (measured `scrollTop` 0 → 446) and focuses the matching row, including through a collapsed 分类 section. Proven there the same day for the header menu: the six rows in order off a right-aligned 220px anchor, 收藏 ↔ 取消收藏 following `favorite`, 移动到 swapping into a back row + one row per other vault and firing `move_login_item { id, vaultId }` while the picker *stayed* on the source vault and the list dropped the row, `duplicate_login_item` carrying the localized `{{title}} 副本` and selecting the copy, 分享 putting `gh-secret` on a stubbed `navigator.clipboard` and banner `messages.sharedPassword`, 归档/删除 firing `archive_login_item` / `trash_login_item`, the ellipsis absent while editing and absent with nothing selected, and Escape / outside click / the trigger all dismissing — the last four of which only passed once `itemMenu` was added to that effect's dep array, which is how the trap above was found. **The banner needed a move too**: `success-banner` sat inside the detail form's branch, so the one action whose whole point is that the pane is now empty rendered its confirmation where nothing shows — it is now a sibling *after* the two branches. **A stub of that kind must hand back a fresh array from every list command** — returning the same object makes `setItems` bail out of the re-render, so the `[items, mode]` effect never re-runs and a live refresh looks broken when it is the harness that is. It proves the frontend; it does not prove the Rust side, which is what `cargo test` is for. Everything else — every hover/pressed/disabled state, the rest of the settings tabs, TOTP, attachments — is still unconfirmed.
- **Create-vault closed 2026-10-09**: the sidebar brand's `+` (until 2026-10-10 a `+` beside the vault picker in the detail header) opens the same in-app panel recipe as the purge
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
- **Leftovers from the 2026-10-09 sync/backup deletion**: the callerless `VaultService::import_login_items`, `set_encrypted_setting`, `get_encrypted_setting` (and their helpers `item_exists`, `primary_website`, `Session::key`) were deleted on 2026-10-09, so the crate compiles warning-free; the `settings` table now has no reader or writer at all, and the `settings` row `github_sync_settings`, any `~/Library/Application Support/app.passless.desktop/sync-history/*.snapshot`, and the Keychain item `app.passless.desktop` / `github_pat` are all unreachable but were not cleaned up.
- **Remaining at-rest audit items** (the 2026-10-08 audit's #1 export encryption, #2 file permissions and #4 CSP + constant-time pairing are fixed): #3 attachment temp-file cleanup, #5 no rate limiting on the bridge or master-password attempts, #6 default security preferences / master-password strength enforced in Rust / zeroize on lock / key rotation.

