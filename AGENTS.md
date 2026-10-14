# AGENTS.md

## Project

Tauri v2 desktop password manager. React 18 + TypeScript frontend, Rust backend with encrypted SQLite vault.
Also ships a Manifest V3 browser extension (autofill via a local HTTP bridge on `127.0.0.1:17891`).

## Where the rules live

| File | Carries | Read it when |
|---|---|---|
| `AGENTS.md` (this file) | Commands, workflow, architecture, engineering constraints and traps | Always, first. |
| `.agent/design.md` | The project's Apple (macOS HIG) design rules: tokens with light and dark values, type scale, radii, materials, focus ring, component rules, deviations from Apple's published values, documented exceptions | Any UI/CSS/class change. |
| `.claude/skills/apple-design/` | **Vendored** `apple-design` skill (owner-installed 2026-10-14, pinned in `skills-lock.json`): `SKILL.md` + 123 HIG pages under `references/hig/`. The design reference — never hand-edited. | Before a UI decision: open the HIG pages `SKILL.md` lists for what is on screen and cite them. |
| `.agent/todo.md` | Open work, what has never been seen in a running app, completed items, decided-against features | Picking up someone else's thread, or before proposing a feature. |

The UI follows Apple's Human Interface Guidelines for macOS (owner ruling, 2026-10-14: "我喜欢改成apple design，
删掉其他的design干扰"). The Atlassian contract (`DESIGN.md`) and the old restyle history
(`.write-technical-spec/`) were deleted that day; they survive only in git history and are not a source of truth.
The platform conclusions about native chrome live in "Runtime, windows and shell" below.

## Commands

```bash
npm run dev          # Vite dev server on :1430 (Tauri launches this automatically)
npm run build        # tailwindcss (extension CSS) → tsc → vite build
npm run build:css    # Tailwind-compiles src/styles.css only, to /tmp — proves a token resolves
npm run typecheck    # tsc --noEmit only, without the bundle
npm run test         # Vitest, all 16 files (node environment; fork pool capped at 2)
npm run test:design  # Only src/app/designContract.test.ts — the Apple-design token/CSS/className guard
npm run lint:fix     # biome check --write (JS/TS, CSS, JSON)
npm run tauri dev    # Full desktop app (frontend + Rust backend)
npm run tauri build  # Production .app — the only build where the CSP takes effect
cd src-tauri && cargo test   # Rust unit tests (vault, storage, crypto, bridge)
```

No CI, no pre-commit hooks: the gates are manual, and you run only the tier the diff needs.

**Why tiering is not bureaucracy.** This is a 6-core/12-thread Intel box with ~0.9GB free RAM, a 6GB memory
compressor resident and 13GB left on the volume. An all-core pass does not merely run slow — macOS answers
the pressure by compressing (CPU work on the same cores), and the window server and the input methods then
queue behind it, which is what "the computer cannot be clicked or typed for minutes" actually is. Measured
consequences: a 10-minute-later load average of 30 on 12 CPUs, and a 5-minute wall for a gate bundle that
proves nothing about a CSS edit.

`.cargo/config.toml` caps cargo at 3 jobs — do not raise it. Prefix every gate with
`/usr/sbin/taskpolicy -b nice -n 10` (plain `nice` does not stop the UI from queueing; the background QoS
class does), and **issue one gate per Bash call** — batching independent gates into one parallel response is
how a turn reaches load average 30.

### Pick the tier from the diff, not from the directory

| Diff | Run | Skip |
|---|---|---|
| Style or `className` only (`styles.css`, `popup.tailwind.css`, a class string) | `npx biome check <file>` (~7s) + `npm run test:design` (~10s, the guard that reads both) + `npm run build:css` (~22s, the only thing proving a token resolves). Then look at it. | `tsc`, `vite build`, the other 15 test files, `cargo` — none of them reads CSS. |
| TS logic, no Rust | `npm run typecheck` (~64s) + `test:design` + the covering test files (`npm run test -- src/app/lockScreen.test.ts`) | Full suite unless the change crosses modules. |
| Rust (`src-tauri/**`) | `cargo test`; `cargo check` while chasing a type error; `cargo test --no-run` once so later runs only relink | Never overlap a cargo pass with `npm run build`. A small Rust edit does **not** rebuild the 545-crate graph (measured: 13 files rewritten against 879 untouched rlibs) — it pays two ~39MB links. |
| Before the commit, once | `npm run build` (~2m22) + `npm run test` (~63s, 16 files/95 tests) + `npm run lint:fix` | Per edit inside the same turn. |
| Packaged build itself (CSP, bundling) | `npm run tauri build` | Otherwise: release build of all 545 crates, minutes of all-core CPU. |

**The running `tauri dev`/Vite server is the inner loop** — it compiles Tailwind and hot-reloads a class
change, so the expensive bundle belongs once at the end. The one exception is in `.agent/design.md`:
`tailwind.config.js` is not hot-reloaded, so a new token key needs `npm run dev` restarted before its first
`@apply` stops failing.

## Workflow

- **Commit and push at the end of every exchange** (owner instruction, 2026-10-08), once the tier above is
  green. Do not wait to be asked again and do not accumulate uncommitted work across turns. Stage by file
  name, never `git add -A`, and read `git status` before committing so nothing suspicious gets pushed —
  secrets, `src-tauri/gen/`, or regenerated `browser-extension/popup.css` churn from a build you ran for
  another reason.
- **i18n completeness before every commit** (owner instruction, 2026-10-09): every user-facing string added or
  changed that turn — labels, notices, *and* error and success messages — exists in all three bundles in
  `src/app/i18n.ts`, and in `_locales/{en,zh,ja}/messages.json` too if it is popup text. `npm run test` proves
  it (`i18n.test.ts`: named keys defined, no English `defaultValue` fallback, runtime-built prefixes covered).
  Fill the gap before committing, not after.
- **This file records decisions and traps, not diffs** (owner ruling, 2026-10-10). Add a paragraph only for an
  irreversible decision, a new trap, or a rule the next turn would otherwise re-derive. A hover state or one
  utility class is a commit message. Status goes in `.agent/todo.md`.
- **Static gates green is not verification.** See "Verifying UI behaviour" below.

## Linting & Formatting

Biome (not ESLint/Prettier), config `biome.json`, run `npm run lint:fix`.

- JS/TS: 2-space indent, single quotes, no semicolons. CSS: 2-space indent, double quotes, no trailing
  newline. JSON: tab indent, sorted keys.
- The linter auto-sorts imports, properties, attributes and interface members.
- Tailwind requires `css.parser.tailwindDirectives: true` — without it every `@apply` is a parse error and
  Biome silently skips linting **and** formatting that file. (`noUnknownAtRules.ignore: ["tailwind"]` is a
  Biome 1.x workaround that does nothing here.)
- `browser-extension/popup.css` is excluded: it is generated. Edit `popup.tailwind.css`.
- **Rust is not rustfmt-clean — never run `cargo fmt`.** It would rewrite the whole crate on top of your
  change. Match the surrounding style by hand, keep lines under ~100 columns.

## Architecture

```
src/                  # React frontend
  main.tsx            # ReactDOM entry
  App.tsx             # Single-file UI: VaultWindow / SettingsWindow / QuickAccessWindow (no router, ~4500 lines)
  styles.css          # Tailwind + all custom CSS + the token values in :root (~2380 lines)
  app/vaultApi.ts     # All Tauri invoke() calls — typed wrappers
  app/navigation.ts   # Sidebar nav rows (4 rows in 2 groups)
  app/theme.ts        # Appearance: system (default, follows prefers-color-scheme) / light / dark
  app/i18n.ts         # zh (fallback) / en / ja bundles, one flat object per locale; parity is tested
  app/tagIcons.ts     # 43 pickable lucide glyphs + the 11 colour options, written out as full class pairs
  app/itemTags.ts sidebarHighlights.ts securityPreferences.ts lockScreen.ts totpDisplay.ts
  app/relativeTime.ts menuPlacement.ts itemDrafts.ts itemTemplates.ts windowPlacement.ts otpQrImport.ts
  app/designContract.test.ts  # executable guard for the .agent/design.md rules
  test/setup.ts       # jest-dom matcher import; present but NOT wired (no test uses a matcher)

src-tauri/src/        # Rust backend
  lib.rs              # All #[tauri::command] handlers + AppState + plugin setup
  main.rs             # Just calls passless_lib::run()
  vault.rs            # VaultService: CRUD, encryption, session management
  storage.rs          # SQLite connection + schema + the 0600/0700 permission helpers
  crypto.rs           # AES-GCM + argon2 KDF
  biometric.rs        # Touch ID via objc2-local-authentication
  browser_bridge.rs   # HTTP server on 127.0.0.1:17891 for the extension
  shell.rs            # Tray menu, ⌘⇧Space Quick Access, autostart, single instance
  totp.rs             # TOTP code generation
  breach_check.rs     # Have I Been Pwned k-anonymity check

browser-extension/    # Manifest V3 extension (not built by Vite)
```

## Runtime, windows and shell

- **Bridge**: every Rust function is registered in `lib.rs` via `tauri::generate_handler![]` and reached
  through a `vaultApi.ts` wrapper using `@tauri-apps/api/core` `invoke()`. Each command opens a fresh
  `storage::open_default_database()` connection — there is no pooling.
- **Three windows**: `main`, `settings` (`/?view=settings`), `quick-access` (`/?view=quick-access`, created on
  demand by `shell.rs`). **Any new window label must also be added to `src-tauri/capabilities/main.json`
  `windows`, or its `invoke()` calls are denied at runtime.** No router: the view comes from `?view=` and
  `App.tsx` holds all state.
- **A second window is placed against `main`, never centred on the screen.** `center: true` does not mean
  "where the user is": `tauri-runtime-wry-2.12.1/src/lib.rs` centres a position-less window on
  `event_loop.primary_monitor()`, so with a display to the right of the primary one the panel opens on the
  screen nobody is looking at — and focusing it makes macOS switch Spaces to go find it.
  `openSettingsWindow()` reads main's own frame (`outerPosition`, `outerSize`, `scaleFactor`, all covered by
  `core:window:default`) and hands `src/app/windowPlacement.ts` the top-left that centres the panel on **that**
  frame. Creation `x`/`y` are **logical** pixels in the *global* display space, so the physical frame is
  divided by the scale factor *before* half the new window's size is subtracted off.
  Two things are easy to get backwards: **`center` is applied after an explicit position and overwrites it**,
  so it must be `false` whenever `x`/`y` are passed; and **`parent: 'main'` is the actual same-Space guarantee**
  (macOS `addChildWindow:ordered:`), resolved by `WindowBuilder::from_config` through
  `manager.get_window(parent).ok_or(Error::WindowNotFound)?` — so a parent that is already gone makes the create
  **fail outright**, which is why `parent`, `x` and `y` are all conditional on main being in the window list and
  the fallback stays `center: true` (Quick Access can be the only window up). Repositioning after creation would
  need `core:window:allow-set-position`, which is **not** in the capability file, so placement is a
  creation-time decision only.
- **Native vibrancy (macOS)**: `app.macOSPrivateApi: true` + the `macos-private-api` tauri feature make windows
  transparent. `main` wears `windowEffects: sidebar` (tauri.conf.json), `settings` gets `transparent` +
  `Effect.Sidebar` at creation in `openSettingsWindow()`, Quick Access gets `Effect::Popover` (radius 12) in
  `shell.rs`. `src/app/vibrancy.ts` sets `<html data-vibrancy="native">` only inside Tauri on macOS; the last
  `@layer components` block in `styles.css` then re-points `--material-*` to `transparent` on the source lists
  and Quick Access so the real material shows, while content panes stay opaque. In a browser the CSS materials
  apply. Private API use means the build cannot go to the Mac App Store.
- **Shell integration** (`shell.rs`): tray menu, `⌘⇧Space` Quick Access (global shortcut + positioner, anchored
  `TopCenter` from the keystroke and `TrayBottomCenter` from the tray), autostart via
  `MacosLauncher::LaunchAgent`, single-instance refocus. **Window creation must happen inside
  `run_on_main_thread`** — macOS forbids building a webview from the global-shortcut callback's thread.
- **`tauri-plugin-single-instance` hardcodes `/tmp/{app_id}_si.sock`** with no `HOME`/`TMPDIR` override, so you
  cannot start a throwaway instance while a `tauri dev` one holds the socket.

## Vault security

- **The vault key is never persisted.** It lives only in the `AppState` session mutex for the unlocked
  lifetime. Do not add an OS Keychain entry for it, write a decrypted vault cache, or ship it inside any
  exported file. There is no OS Keychain access at all — the `keyring` crate and `secure_store.rs` were
  deleted 2026-10-09 (Touch ID uses `objc2-local-authentication`).
- **There is no export, no import and no sync.** The vault exists only as the on-disk SQLite file;
  `json_transfer.rs`, `github_sync.rs` and `sync_history.rs` went on 2026-10-09 with their settings tabs. A
  forgotten master password therefore has no recovery path — do not re-add a transport without the owner
  asking (see `.agent/todo.md`, "Decided against").
- **File permissions**: any file the app writes goes through `storage::set_private_permissions` (0600,
  re-applied on every `open_database` so existing installs self-repair, covering the
  `-journal`/`-wal`/`-shm` sidecars) and `storage::create_private_directory` (0700). Today that is the
  decrypted attachment temp, which has no other confidentiality.
- **CSP**: `tauri.conf.json` `app.security.csp` is `default-src 'self'` + `script-src 'self'`, with
  `ipc:`/`http://ipc.localhost` in `connect-src` and `data:` in `img-src` (built CSS embeds an SVG data URI) —
  those two must be listed by hand because Tauri's `set_csp` only injects script/style hashes. It applies
  **only to packaged builds** (`PROXY_DEV_SERVER = cfg!(all(dev, mobile))`, so on macOS `tauri dev` loads
  `http://localhost:1430` with no CSP). Verify with `npm run tauri build`.
- **Browser bridge**: the pairing token is compared in constant time (`tokens_match`). The server is
  `Access-Control-Allow-Origin: *` on `127.0.0.1:17891` and returns plaintext credentials to a paired client —
  do not widen its reach or add an endpoint that exposes more.
- **The TOTP seed rests masked**: `fieldValueInputProps` gives an `otp` input `type="password"` unless it is
  the focused field (`focusedOtpField` in `App.tsx`), so a saved key is legible only while being typed. Import
  runs the other way: the QR button in `OtpFieldActions` reads an image **off the clipboard**
  (`src/app/otpQrImport.ts`, decoded with `jsqr`) and stores the `secret` of an `otpauth://` link or a bare
  base32 key, and nothing else. The app never renders a seed as a QR image and there is no screen-region
  capture.

## UI structure and its traps

- **No text selection and no native context menu.** `@layer base` sets `user-select: none` on `*`, re-enabling
  `text` only for `input`, `textarea`, `select` and `[contenteditable="true"]`; one `useEffect` in `App()`
  (registered *before* its `?view=` early returns, so it runs in all three windows) calls `preventDefault()` on
  every `contextmenu` event on `window`. The webview's own Reload / Save As / spelling panel is thereby
  unreachable and a credential cannot be highlighted into the clipboard by accident. Anything the user *should*
  copy stays reachable through an explicit button (复制密码, the field menus). A right-click that must do
  something installs its own `onContextMenu` on the row — that is how the tag, category, vault and item-row
  menus open, and why a row with no handler (the two footer state rows) simply does nothing.
- **There are no native JavaScript dialogs.** wry declares `WKUIDelegate` but implements none of
  `runJavaScriptAlertPanel` / `runJavaScriptConfirmPanel` / `runJavaScriptTextInputPanel`, so in this webview
  `window.confirm` resolves `false` and `window.prompt` returns `null` **without showing anything** — the call
  site silently takes the cancelled branch. Ask in the page instead: `.confirm-layer` + `.confirm-dialog`
  (`role="alertdialog"`, a macOS sheet — blanket + sheet material + `rounded-xlarge` — sized by the
  project's own `--measure-modal`), driven by a state flag and dismissed by its own button, Escape, and a
  full-bleed
  dismiss `<button>` behind the card. **`aria-modal="true"` prunes that backdrop out of the macOS accessibility
  tree**, so synthetic AX clicks cannot reach it — only the dialog's own buttons are addressable that way. Focus
  the field from an effect, never `autoFocus`, and keep submit disabled until the value is non-empty; the worked
  example is the brand `+`'s create-vault panel (`vault.createVault` + one labelled name field + 取消/Create),
  where Return creates the vault, makes its row active, opens a new-item draft and banners
  `messages.createdVault`.
- **Two traps every transient panel has paid for.** (1) The single `useEffect` in `VaultWindow` that dismisses
  all panels builds `menuOpen` from state and lists that state in its **dep array** — a panel whose flag is
  missing registers no listener at all, so Escape and the outside click both do nothing and the handler looks
  broken. (2) `.menu-option.with-icon` is a **two**-track grid (`grid-cols-icon-option`), so a third child wraps
  under the row; a trailing chevron belongs inside `.menu-option-label.trailing`.
  Corollary learned the same way: a bare `<button>` needs **no** `data-tauri-drag-region="false"` carve-out under
  a `deep` region — `tauri-2.12.1/src/window/scripts/drag.js` short-circuits `isDragRegion()` on
  `isClickableElement(el) && attr === null` — only non-clickable wrappers need the opt-out. And a new panel must
  call `closeFieldMenus()` in its **opener**, not just its dismiss effect, or it stacks on a panel already open
  (count `.add-more-menu`, not `[data-field-menu]` — `.add-more-wrap` carries the same attribute).
- **Item actions live behind one header ellipsis and behind a row right-click.** The detail header's right side
  is 编辑 + an `Ellipsis` button (`aria-label` `vault.itemActions`) and nothing else — 归档 and 移到废纸篓 were
  deleted as buttons on 2026-10-10; the six rows (收藏/取消收藏, 移动到 *only when another vault exists*, 创建副本,
  归档 `.separated`, 删除 `.is-danger`, 分享) sit in a `.add-more-menu` anchored to the trigger (`itemMenuWidth`
  220, right-aligned). 删除 **is** the trash — there is no purge from here, only from the trash view. 分享 carries
  a `<small>` hint because there is no transport: it copies the password through the same `copyPassword()` the
  field button uses, honouring the 90-second clipboard clear, and nothing else. 移动到 swaps the **same** panel in
  place (`itemMenu: 'actions' | 'move'`) rather than flying out a submenu, because the trigger is at the window's
  right edge; the back row is the same label with a `ChevronLeft`. Both the button and the menu render only when
  `selectedItem && !isEditing` — every row acts on stored state, never on unsaved typing. Right-clicking a live row
  (`itemMenuSource: 'header' | 'row'`) selects it first, so the panel acts on the clicked item, anchored to the
  cursor's height and the row's left edge. A row offers 编辑 and no 分享; the header offers 分享 and no 编辑.
  Because the panel left the `<form>`, the submit button reaches it by name
  (`<form id="item-detail-form">` + `form="item-detail-form"`), keeping native constraint validation and ⌘
  behaviour; `.detail-topbar` wraps so the controls stay readable at the 960px minimum. The item-type `<select>`
  went with the old header too — a type is chosen once, at creation, and not edited afterwards. Acting on a row
  while its form is open is safe: archiving the item being edited drops it and the pane falls back to its empty
  state.
- **The success banner must sit outside the detail branches.** `success-banner` used to live inside the detail
  form's branch, so the one action whose whole point is that the pane is now empty printed its confirmation where
  nothing renders.
- **Sidebar scope**: `src/app/navigation.ts` is four rows in two groups — `group: 'vault'` (`vaults`,
  `favorites`) at the top, `group: 'footer'` (`archived`, `trash`) pinned to the foot so they are never pushed
  off; only `.sidebar-scroll` above scrolls, and it carries `content-start` (see the `.agent/design.md`
  exception for a grid's `align-content: normal`). The column is drag-resized from its own 6px gutter track,
  clamped 150–220 by `beginColumnResize` (shared with the list's gutter, which is why both carry a
  `*WidthLimits` const with a `default`), reaching the grid as `--sidebar-width` on `.app-shell` —
  `--measure-sidebar` is only its starting width. `.top-search-bar` spans `col-start-2 col-span-4` deliberately:
  the gutter is `row-start-2` only, and the
  bar's `border-b` draws the hairline under the 44px titlebar strip, so starting it at the list would notch that
  line. The brand block carries the app name and its `+` only (the `<select>` vault picker was deleted 2026-10-10;
  the `+` needs `data-tauri-drag-region="false"` against `.sidebar`'s deep region). Tags, categories and vaults
  are `<nav className="section-nav">` groups whose **title** is a text-only toggle (`SidebarSectionToggle`,
  `aria-expanded`), folding independently with state local to `VaultWindow`; there is no Settings button — ⌘, is
  the only way in, and the generator lives as a settings tab (Watchtower's old sidebar row was a duplicate of
  it). Every row shows a count, and each of those three sections' rows carries a 16px `lucide-react` icon: a
  category's comes from the `categoryItems` table (the `itemType` → icon + `colorClass` mapping the item-type
  rows used, restored 2026-10-10 after `d570e2d` had dropped it), a tag's and a vault's from `tags.icon` /
  `vaults.icon`.
- **Highlighted rows are the one thing a fold does not hide.** Right-clicking a tag or category row offers
  突出显示 / 取消突出显示 (the label reads the row's current state), and `visibleTags` / `visibleCategories` — the
  same lists those sections already render — narrow to the highlighted keys while the fold flag is set, so a fold
  never swaps in a second list that can drift. A highlighted row wears a 16px `Pin` in `text-text-subtlest`
  (deliberately **not** an accent hue, per the semantic-roles rule) between label and `.nav-count`. The way back
  is the section **title**'s right-click, 取消所有突出显示 (`PinOff`), which clears that section only, and
  `openSectionHighlightMenu` refuses to open when the section has no *rendered* highlighted row (a stale key
  would offer a dead button). Panel heights are constants: `highlightMenuHeight` for a category's single row,
  `tagMenuHeight = 3 * menuRowHeight + 24` for a tag's three.
  **Keys live in localStorage, not the vault** (`passless-sidebar-highlights`, `src/app/sidebarHighlights.ts`,
  beside the theme and language): `tag:<tagKey>` or `category:<itemType>`, the same namespacing the nav ids use.
  A tag's key is its case-normalised spelling, so renaming a tag must re-key its highlight
  (`renameHighlightKeys` in `handleTagSave`) or the row the user just kept silently unpins itself. A deleted tag's
  key stays behind and matches nothing, which is harmless. `readHighlightKeys` falls back to no highlights for a
  missing key, malformed JSON, a non-array, or an entry that isn't a `tag:`/`category:` string — the value is
  user-editable disk state, same shape and reason as `loadSecurityPreferences`.
- **New item asks for its type.** `vault.newItem` is 新建条目; both its buttons and ⌘N open a `.confirm-dialog`
  (`role="dialog"`, `aria-labelledby`, first option focused by effect) listing every type in `categoryItems`.
  Picking one builds that
  draft, sets `activeNavigation` to `category:<type>`, unfolds 分类 if needed, then focuses and
  `scrollIntoView({ block: 'nearest' })`s the row via `data-item-type` — looked up in `[categoryListRef]` on the
  **next** commit, because a row inside a section that just unfolded does not exist yet. `categoryItems` (the
  table is declared in `App.tsx`, not in a module of its own) is therefore the one type table (17 entries,
  sidebar rows and picker both), and `i18n.test.ts` reads *its* shape
  (`icon: <Component>, itemType: 'x' }`) to derive the `itemTypes.*` keys — widening that regex is how a new type
  gets its translations checked.

## Data model

- **Two kinds of soft delete**: `items.archived` and `items.trashed` + `deleted_at`, each a nav row at the foot of
  the sidebar carrying its own count. Neither view reads the live items — `visibleItems` returns nothing for them,
  and the rows come from `vaultApi.trashed()` / `vaultApi.archived()` — because the detail pane only ever edits
  live items, so a state row is not selectable and carries its own way back instead: 恢复 inline, plus 永久删除
  through the purge confirm in the trash only. `updated_at` doubles as the deletion timestamp (`trash_item` writes
  both), which is why `LoginItem` needs no `deleted_at` field. Restore, the count and the empty state all update
  live.
- **`nav.*` names the state, `listTitle.*` names the place** ("已归档" vs "归档"), and `vault.noItems`
  interpolates `{{target}}` from **`listTitle`**, which is why the empty state reads "归档中没有项目。" and not
  "已归档中没有项目。". `nav.vaults` follows the same split and reads 全部 / All / すべて — it used to read 个人 /
  Personal, which stopped being distinguishable the moment the seeded vault became a sibling row, and
  `listTitle.vaults` stayed 个人 / Personal as the place name.
- **Tags are relational** (`tags`, `item_tags`), not a JSON column, and are **vault-scoped**
  (`vault_id NOT NULL`, `UNIQUE (vault_id, name_hash)`). They surface as a collapsible sidebar section, not a
  nav row: picking one filters the item list (`src/app/itemTags.ts`) and the item form edits them as chips. There
  is no aggregate "tagged items" list — a tag is the only way in — and the section keeps its empty state visible
  when there are none. They are case-insensitive — the frontend helpers mirror `normalized_tag_names` in
  `vault.rs`, so "Work" and "work" are one tag in the UI and in storage. A tag owns two styling columns beyond its
  name, `tags.icon` (`DEFAULT 'tag'`) and `tags.color` (`DEFAULT ''`), read by `list_tags` and written by
  `update_tag`, and the row is addressed **by name, never by id** — no tag id crosses the bridge, so a rename
  propagates through `item_tags` for free. Four positionals made the invoke unreadable, so the bridge takes one
  patch object (`vaultApi.updateTag({ color, from, icon, name })`); `update_vault` follows the same shape.
  Counts come from the live item list, not SQL, so `tagRows(counts, tags)` joins backend styling onto those counts
  by `tagKey`, falling back to `defaultTagIcon` / `defaultTagColor` — and because the styling is not in the item
  list, the sidebar shows a new icon or colour only once `list_tags` re-runs, which the `[items, mode]` effect does
  after every save. The stored colour is the **bare hue name**, never a class, and `tagColorOptions` writes each
  `text-accent-icon-*` / `bg-accent-icon-*` pair out in full because a runtime-built `text-accent-icon-${hue}`
  compiles to nothing. `tagIcons.ts`'s 43rd glyph, `vault`, is not a tag choice but the default a vault row reads.
  **Because those accessible names are built at runtime, `tagIcons.*` and `tagColors.*` are both *derived*
  families `i18n.test.ts` checks**, and it reads `tagIcons.ts` with two regexes that must stay narrow — the icon
  one anchors on `{ icon: <Component>, name: 'x' }` so it does not also match the colour names.
- **Moving and duplicating are Rust-side** (`move_login_item`, `duplicate_login_item`, both in `lib.rs`). Every
  vault is decrypted by the same key, so the rows hanging off `item_id` (fields, urls, attachments) follow an item
  untouched; **tags are the exception** — the move re-homes each tag row into the target (reusing its row when the
  name exists there, otherwise inserting one carrying the source's `name_ciphertext` plus `icon` and `color`),
  re-points `item_tags`, then prunes the source, because a frontend move would silently lose a tag's styling. A
  duplicate must be Rust too: `custom_fields` reference an attachment as `attachment://{id}`, so a frontend copy
  would point at the original's blob row and `ON DELETE CASCADE` would take the copy's file with the original;
  `duplicate_login_item` rewrites those references and returns the copy so the UI can select it, with its title
  built in the frontend (`vault.duplicateTitle`), not in Rust. A move returns nothing — the frontend re-lists,
  drops the selection and banners `messages.movedItem`.
- **Vault rows, archiving and dissolving.** Every vault is a flat `.nav-item` row in a collapsible 保管库
  `section-nav`; clicking one switches (`switch_vault`), and the `<select>` in the brand block died with it along
  with the `vault.personalVault` / `activeVaultName` fallbacks and the `.vault-picker` rules in `styles.css`.
  A row carries `vaults.icon` in `vaults.color` like a tag row, and its `.nav-count` is a correlated live-item
  subquery in `list_vaults`, so an archived vault reads 0.
  Styling and renaming use the **shared** `StyleEditorDialog` (a tag and a vault are the same three choices: name,
  glyph, hue — one grid rather than two that can drift, and no new derived i18n family; its legends reuse
  `vault.tagIcon` / `vault.tagColor`). **Archiving a vault archives what is in it** — live rows flip to
  `archived = 1` **and** `archived_by_vault = 1`, and restoring clears only rows carrying that flag, which is why
  the column exists: a vault parked around an item the user had already archived privately gives that item back as
  archived. **Dissolving moves everything out first** (archived and trashed rows included — `ON DELETE CASCADE`
  would silently destroy them and there is no export and no undo), re-homes tags via `rehome_item_tags` the way a
  move does, prunes the source's tag rows, then deletes the `vaults` row. The last vault cannot be dissolved
  (`VaultLastOne`) and a full one needs a destination (`VaultDestinationRequired`), so `canDissolveVault` hides
  解散 entirely from a row that meets neither; the dialog names the count and offers a 移入目标 `<select>` over the
  **other non-archived** vaults (an empty vault opens with no destination and the command gets `intoId: null`).
  Because the Rust session may have been reading the row just deleted, the frontend re-points it through
  `handleSwitchVault` rather than duplicating the `state.session` / `biometric_session` sync block a sixth time; if
  the last live vault is archived there is nowhere to switch, so it stays parked and only re-lists.

## Testing and verification

- **Frontend tests**: co-located `*.test.ts`. Vitest globals available without imports. The environment is
  **node**, not jsdom — no test renders a component or touches a DOM global, and booting jsdom per file cost
  405s against 4.7s of assertions. `src/test/setup.ts` (jest-dom) is on disk but **not wired** via `setupFiles`;
  re-point it and add `// @vitest-environment jsdom` to the file the first time a real DOM test lands.
  `vite.config.ts` caps the fork pool at 2 so a run cannot fan out to 12 workers.
- **Rust tests** live in each module's `#[cfg(test)] mod tests`; `src-tauri/tests/` does not exist.
- **Verifying UI behaviour.** Synthetic pixel clicks are **not** reliable in this webview — macOS accessibility
  reports its children at `0,0` and a `click at {x,y}` hit-tests to whatever it guesses, so a click aimed at an
  overlay can land on the row underneath while the screenshot still reads "it worked". For overlay, menu and
  dialog behaviour, load the same Vite frontend in a browser against `mockIPC` + `mockWindows` from
  `@tauri-apps/api/mocks` (prefer it over hand-writing `window.__TAURI_INTERNALS__`: it covers `transformCallback`
  and the `plugin:event|*` calls that `getCurrentWebview().onFocusChanged` makes on mount) with an in-memory
  vault and invocations recorded, so the command **and** its payload can be asserted. Three rules for that
  harness: every list command must hand back a **fresh array** (returning the same object makes `setItems` bail out
  of the re-render, so a live refresh looks broken when it is the stub that is); read the DOM in a **separate**
  `evaluate_script` call from the one that dispatched the event or click, because a read taken in the same call
  describes the previous state; and it proves the frontend only — `cargo test` is what proves the Rust side.
- `@types/node` is a devDependency and `tsconfig.json` `types` lists `node` beside `vitest/globals`: the guard
  tests read source files through `node:fs`, and without it `npm run typecheck` fails on a clean `npm ci`.
- Vite exposes `VITE_*` and `TAURI_*` prefixed env vars only.
- The extension popup is localised by Chrome, not by the app: `_locales/{en,zh,ja}/messages.json` plus
  `__MSG_key__` in `manifest.json` and `chrome.i18n.getMessage` applied to `[data-i18n]` /
  `[data-i18n-placeholder]` by `popup.js` (`getUILanguage()` sets `document.documentElement.lang`). English is the
  in-file fallback so the popup still reads if a message is missing. The desktop app's language picker stays in
  `src/app/i18n.ts`; the two lists are independent.

## The brand icon

One artwork in three places, plus one separate glyph. The glossy orange squircle is the app icon anywhere the OS
or the UI can carry colour: the lock screen and the sidebar's brand block (`src/assets/app-icon.png`, a 256px
RGBA import used as `<img alt="">` inside `.brand-mark.is-artwork`, so it stays decorative and needs no locale
key), and Dock/Finder/Taskbar (`src-tauri/icons/app-icon-source.png` → `npx tauri icon
src-tauri/icons/app-icon-source.png`, which rewrites all 52 files including `icon.icns` and `icon.ico`). The menu
bar is **not** that image: `shell.rs` uses `tauri::include_image!("icons/tray-icon-template.png")` with
`.icon_as_template(true)`, a hand-drawn black-on-transparent 36×36 lock, because `tray-icon` forces the tile to
18pt and a colour square is unreadable there — the template is what lets macOS tint it for light and dark chrome.
`include_image!` resolves relative to `CARGO_MANIFEST_DIR` and has no `@2x` handling, so the file is the whole
asset. Two traps for a redraw: the source must keep macOS's ~80% live area with genuinely **transparent** corners
(the squircle's own edge is near-white against a white page, so a plain flood fill leaves a halo — un-multiply the
border against it first), and `src/assets/app-icon.png` is cropped **tighter** than the bundle source because it
fills a 32px box instead of floating in a canvas.
