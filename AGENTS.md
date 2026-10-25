# AGENTS.md

## Project

**Mimatory** (renamed from Passless on 2026-10-23, owner: "名称以后都统一成mimatory，不再使用passless" — never
reintroduce the old name; see "The Passless → Mimatory rename" below for the few places it must survive). GitHub:
`reiy-leo/mimatory`. Tauri v2 password manager for macOS, Windows, Linux (Wayland/Hyprland only), iOS and Android (owner, 2026-10-17:
"和mindough项目一样支持macOS、Windows、iOS、Android、Linux（hyprland，不支持X11）"). React 18 + TypeScript frontend,
Rust backend with encrypted SQLite vault. Each OS wears its own skin, the same mapping as the Mindough project —
see "Platforms" below.
Also ships a Manifest V3 browser extension (autofill through browser native messaging since 2026-10-24, the local
HTTP bridge on `127.0.0.1:17891` + pairing token only as a fallback — see "Extension connection").

**Chinese name: 密码库存** (owner, 2026-10-24: "软件的名称是“Mimatory”，中文“密码库存”"). Every zh string that names the
app says 密码库存 — the app bundle (`lock.appName`, `settings.appName`, `settings.windowTitle`, …) and the extension's
`_locales/zh` — while en and ja say Mimatory (the lock screen / sidebar wordmark `lock.appName` is lowercase
`mimatory` there, on purpose since 2026-10-08). `i18n.test.ts` fails on a zh string containing "Mimatory". Identifiers,
the binary, paths, `productName` and the bundle id stay `mimatory`/`Mimatory`. Where the name reaches the OS:
- The main and settings windows retitle themselves from i18n (`windowTitle.ts`, needs `core:window:allow-set-title`)
  and follow a language change. **Quick Access keeps the fixed English title `Mimatory Quick Access`** (shell.rs)
  because Hyprland float rules match it; a Hyprland rule for the main window should match its class (as
  `hyprctl clients` reports it), not its title, which reads 密码库存 in zh.
- macOS bundle: `src-tauri/macos/Info.plist` (merged via `bundle.macOS.infoPlist`: development region en,
  `CFBundleLocalizations`, `LSHasLocalizedDisplayName`) + `macos/zh-Hans.lproj/InfoPlist.strings` copied in by
  `bundle.macOS.files` — Finder, Dock, Launchpad and the menu-bar app title read 密码库存 on a zh-Hans system. Only in
  a packaged build, never in `tauri dev`.
- Linux: `linux/mimatory.desktop` (the bundler's default template + `Name[zh_CN]=密码库存`), used by deb and AppImage.
- Rust-built UI (since 2026-10-24): `src-tauri/src/native_i18n.rs` holds every string Rust shows itself — the tray
  menu (Open Quick Access / Show / Quit) and tooltip, the macOS menu bar (app menu About/Services/Hide/Hide
  Others/Show All/Quit, File ▸ Import, Edit, View, Window; the predefined items get custom text, their AppKit
  actions are unchanged), the `.1pux` picker title + filter, the Touch ID reason and the phone biometric title —
  as one `(en, zh, ja)` row each. **It follows the in-app language, not the OS**: the main window calls
  `set_native_locale` (`nativeLocale.ts`, via `vaultApi.setNativeLocale`) at startup and on every
  `languageChanged` (a Settings change reaches main through `mimatory-language-changed`), and Rust rebuilds the
  tray menu and the menu bar (same item ids, so the global menu listeners stay valid — which is why
  `app.on_menu_event` is registered once in `shell::setup`, never inside `build_app_menu`). Before that first
  report it uses the OS locale (`sys-locale`: zh* → zh, ja* → ja, else en). A new Rust-shown string goes in that
  table, never as a literal. Left English on purpose: terminal/stderr messages (the Wayland refusal, migration
  logs), the breach-check user agent, the `Mimatory Quick Access` title. AppKit itself may retitle the
  full-screen item ("Exit Full Screen") in the system language. Windows Start menu / installer name =
  `productName`. iOS/Android home-screen name: `src-tauri/gen/` is generated in CI, so an
  `InfoPlist.strings` / `values-zh/strings.xml` has to be injected after `tauri ios|android init` — not done yet.

## Where the rules live

| File | Carries | Read it when |
|---|---|---|
| `AGENTS.md` (this file) | Commands, workflow, architecture, engineering constraints and traps | Always, first. |
| `.agent/design.md` | The project's Apple (macOS HIG) design rules: tokens with light and dark values, type scale, radii, materials, focus ring, component rules, deviations from Apple's published values, documented exceptions | Any UI/CSS/class change. |
| `.claude/skills/apple-design/` | **Vendored** `apple-design` skill (owner-installed 2026-10-14, pinned in `skills-lock.json`): `SKILL.md` + 123 HIG pages under `references/hig/`. The design reference — never hand-edited. | Before a UI decision: open the HIG pages `SKILL.md` lists for what is on screen and cite them. |
| `.agent/sync.md` | Sync design: remote layout, crypto (sync key, manifest), merge rules, provider switching, commands/events, owner decisions | Touching `src-tauri/src/sync/`, a synced table/column, or the master password. |
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
npm run test         # Vitest, all 29 files (node environment; fork pool capped at 2)
npm run test:design  # Only src/app/designContract.test.ts — the Apple-design token/CSS/className guard
npm run lint:fix     # biome check --write (JS/TS, CSS, JSON)
npm run tauri dev    # Full desktop app (frontend + Rust backend)
npm run tauri build  # Production .app — the only build where the CSP takes effect
cd src-tauri && cargo test   # Rust unit tests (vault, storage, crypto, bridge); on Linux run with a private TMPDIR
```

No pre-commit hooks: the gates are manual, and you run only the tier the diff needs. GitHub Actions
(`.github/workflows/`) re-runs them on push (`ci.yml`) and packages the apps (`build.yml`, `ios.yml`; see "Platforms").

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

- **Develop on `main`** (owner instruction, 2026-10-17): the feature branches were fast-forwarded into `main`;
  commit and push to `main` directly from now on.
- **Versions**: `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (+ both lockfiles) carry
  the same version; tag `v<version>`. Alpha tags (`v*-alpha*`) build macOS only and publish the prerelease at
  once. A pre-release version like `0.1.0-alpha.1` is not valid for a Windows MSI or an Android versionCode —
  set `bundle.windows.wix.version` / a numeric version before a non-alpha all-platform build.
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
  App.tsx             # ~26 lines: picks the window from ?view= and blocks the native context menu (no router)
  app/vaultWindow.tsx settingsWindow.tsx quickAccessWindow.tsx  # the three windows
  app/useVaultWindow.tsx  # VaultWindow's state + behaviour (~2300 lines); returns the model every pane reads (`vw`)
  app/useVaultItems.ts useVaultSession.ts useWindowAppearance.ts  # vault data + selection, lock/unlock/idle, theme/language/security prefs
  app/useItemSort.ts useColumnWidths.ts useTotpPreviews.ts useItemFormFields.ts useItemActions.ts  # list sort, gutters, OTP codes, editor changes, item menu actions
  app/vaultLockScreen.tsx vaultSidebar.tsx vaultToolbar.tsx itemList.tsx itemDetailPane.tsx  # the main window's panes
  app/itemEditForm.tsx itemDetailView.tsx otpFieldView.tsx  # the detail pane's edit form and read-only view
  app/itemPickers.tsx itemActionsMenu.tsx sidebarMenus.tsx vaultDialogs.tsx styleEditorDialog.tsx mobileTabBar.tsx  # sheets, menus, dialogs, phone tab bar
  app/vaultModel.ts   # form state + conversions, menu/column constants, `categoryItems` (the one item-type table)
  app/settingsTabs.ts # the Settings panes list
  app/syncApi.ts syncSettingsPane.tsx syncErrors.ts  # sync: command wrappers + requestSync, Settings ▸ Sync, error/i18n + WebDAV URL rules
  styles.css          # Tailwind + all custom CSS + the token values in :root (~2380 lines)
  app/vaultApi.ts     # All Tauri invoke() calls — typed wrappers
  app/navigation.ts   # Sidebar nav rows (4 rows in 2 groups)
  app/theme.ts        # Appearance follows the system only (no in-app override since 2026-10-23); deletes the legacy `passless-theme` key
  app/i18n.ts         # zh (fallback) / en / ja bundles, one flat object per locale; parity is tested
  app/tagIcons.ts     # 43 pickable lucide glyphs + the 11 colour options, written out as full class pairs
  app/listSelection.ts selectionPane.tsx  # the list's multi-selection (Finder rules) and the "N Items Selected" / trash-row pane
  app/itemTags.ts sidebarHighlights.ts securityPreferences.ts lockScreen.ts totpDisplay.ts
  app/relativeTime.ts menuPlacement.ts itemDrafts.ts itemTemplates.ts windowPlacement.ts otpQrImport.ts
  app/itemFields.ts fieldFormats.ts fieldControls.tsx  # typed item fields: template bridge, rules, view/edit components
  app/fieldActions.ts fieldActionControls.tsx largeType.ts clipboard.ts  # 1Password-style field actions: per-type primary + menu, action sheet, Large Type, the one clipboard writer
  app/fieldRows.tsx fieldReorder.ts  # the editor's field row (handle, cell, remove), drag/keyboard reorder, the Autofill Behavior popover
  app/addMoreOptions.ts addMoreMenu.tsx anchoredPanel.ts  # the one Add More list (item / section), its bar + menu, measured popover placement
  app/itemRelations.ts relationControls.tsx  # parent / child / related / sign-in links: draft diffing, picker rules, the row group
  app/siteIcons.ts itemIcon.tsx  # website icons: which sites to ask, the window's icon store, the item tile
  app/signInProviders.ts signInControls.tsx providerMarks.tsx  # "Sign in with…": field rules, sheet + row, bundled marks
  app/designContract.test.ts  # executable guard for the .agent/design.md rules (incl. the skin stylesheets)
  app/platformFeatures.ts  # what exists on which platform (bridge, Quick Access, biometrics, shortcuts…)
  app/windowTitle.ts nativeLocale.ts  # window titles and the Rust-built UI (set_native_locale) follow the UI language
  app/windowChrome.ts vibrancy.ts  # settings-window chrome per platform, window theme sync, native material flag
  skin/platform.ts runtime.ts  # platform/skin/layout detection (+ ?platform= overrides) → <html data-*>
  skin/tokens.css skins.css mobile.css  # WinUI 3 / Material 3 token values, skin shapes, the phone layout
  test/setup.ts       # jest-dom matcher import; present but NOT wired (the one DOM test imports jest-dom itself)

src-tauri/src/        # Rust backend
  lib.rs              # All #[tauri::command] handlers + AppState + plugin setup
  main.rs             # Just calls mimatory_lib::run()
  vault.rs            # VaultService: CRUD, encryption, session management
  storage.rs          # SQLite connection + schema + the 0600/0700 permission helpers
  rename_migration.rs # One-time copy of a pre-rename (Passless) vault + webview profile to the Mimatory paths
  crypto.rs           # AES-GCM + argon2 KDF
  sync/               # Cloud sync (Google Drive appDataFolder or WebDAV): records, merge, local, cipher, engine, providers, commands — see .agent/sync.md
  favicon.rs          # Website icon fetch: https-only, SSRF guard, caps, decode + re-encode as a 64px PNG
  biometric.rs        # Touch ID (objc2) on macOS, tauri-plugin-biometric on iOS/Android, none elsewhere
  browser_bridge.rs   # The extension's request → response handler (`handle_request`), shared by the native IPC and the fallback HTTP server on 127.0.0.1:17891
  native_messaging.rs # Native-messaging host mode (`mimatory chrome-extension://…`), stdio framing, host manifests + registration
  native_ipc.rs       # Host ↔ app channel: 0600 Unix socket / per-user named pipe, peer checks, macOS browser code-signature check
  site_match.rs       # Autofill behaviour: registrable-domain / exact-host / never matching (psl crate), describe_website
  native_i18n.rs      # en/zh/ja table for every string Rust shows (menus, tray, pickers, Touch ID) + the native locale
  shell.rs            # Desktop only: tray, Quick Access (hotkey on macOS/Windows, `--quick-access` on Linux), autostart, single instance
  totp.rs             # TOTP code generation
  breach_check.rs     # Have I Been Pwned k-anonymity check

src-tauri/tauri.conf.json + tauri.{macos,windows,linux,ios,android}.conf.json  # per-platform windows (merge patch)
src-tauri/capabilities/  # main.json (all), desktop.json, global-shortcut.json (platform-scoped)
.github/workflows/    # ci.yml, build.yml (desktop + Android, v* tags → draft prerelease), ios.yml (manual)
browser-extension/    # Manifest V3 extension (not built by Vite), desktop only; passkey-observer.js runs in the page world
```

## Runtime, windows and shell

- **Bridge**: every Rust function is registered in `lib.rs` via `tauri::generate_handler![]` and reached
  through a `vaultApi.ts` wrapper using `@tauri-apps/api/core` `invoke()`. Each command opens a fresh
  `storage::open_default_database()` connection — there is no pooling.
- **Three windows**: `main`, `settings` (`/?view=settings`), `quick-access` (`/?view=quick-access`, created on
  demand by `shell.rs`). **Any new window label must also be added to `src-tauri/capabilities/main.json`
  `windows`, or its `invoke()` calls are denied at runtime.** No router: the view comes from `?view=` in
  `App.tsx`; each window owns its state (`VaultWindow`'s lives in `useVaultWindow` and the hooks it composes).
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
- **Native vibrancy (macOS)**: `tauri.macos.conf.json` makes the main window transparent (Tauri ≥ 2.12.1 always
  enables the private API transparency needs; the `macos-private-api` feature and `macOSPrivateApi` key are no-ops
  there and were removed — see "Platforms"). `main` wears `windowEffects: sidebar` (tauri.macos.conf.json), `settings` gets `transparent` +
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

## Platforms

Owner ruling 2026-10-17: the app ships on macOS, Windows, iOS, Android and Linux, each in the design language
Mindough (`/workspace/projects/33c2c799-…/repo`, `apps/client/src/skin/`) gives it. Linux means Hyprland on
Wayland; X11 is not supported.

| Platform | Skin (`<html data-skin>`) | Window | Navigation |
|---|---|---|---|
| macOS | Apple (macOS HIG) — the base `styles.css`, unchanged | Overlay title bar + sidebar vibrancy (`tauri.macos.conf.json`) | Sidebar · list · detail |
| Windows | WinUI 3 / Windows 11 | Native title bar over Mica (`tauri.windows.conf.json`), Acrylic Quick Access | NavigationView sidebar · list · detail |
| Linux | Material 3 (Mindough maps Linux to Material) | No decorations (Hyprland), opaque page | Navigation drawer · list · detail |
| iOS | Apple (iOS) | One window, safe areas | Tab bar: Items / Browse / Settings, list → item push |
| Android | Material 3 | One window, safe areas | Navigation bar + extended FAB, list → item |

- **Detection** (`src/skin/platform.ts`, Mindough's `platform.ts`): user agent, iPadOS by touch points; skin by
  platform; **layout by width only** — at ≤ 760px every platform gets the phone layout (`data-layout="mobile"`),
  which is also what a narrow Hyprland tile or Windows snap shows. `src/skin/runtime.ts` writes
  `data-platform` / `data-skin` / `data-layout` on `<html>` before the first render and keeps `data-layout` in step
  with resizes (`usePlatformState()` for React). Debug overrides, never persisted: `?platform=windows`,
  `?skin=material`, `?layout=mobile` (the screenshot harness uses `?platform=`).
- **Skins are CSS only** (`src/skin/tokens.css` values per skin × light/dark, `skins.css` shapes,
  `mobile.css` the phone layout), imported after `styles.css` in `main.tsx`. Components and class names are shared;
  a skin re-points the existing tokens and adjusts shapes with `:root[data-skin="x"] .class` selectors. **The Apple
  desktop skin is `styles.css` alone** — nothing in `src/skin/` may target `data-skin="apple"` outside
  `[data-layout="mobile"]` (the design contract checks it), so macOS renders exactly as before. Body size comes from
  scaling the root font size (every size is rem): WinUI/Material 14px, iOS phone 17pt, Android phone 16sp.
- **Features per platform** are one table, `src/app/platformFeatures.ts` (`featuresFor`): the browser-extension
  bridge, Quick Access, launch at login, the settings *window*, attachments (rfd) are desktop-only; biometrics are
  Touch ID on macOS, `tauri-plugin-biometric` on iOS/Android, none on Windows/Linux; ⌘ on Apple platforms, Ctrl
  elsewhere (`isPrimaryModifier`, `shortcutLabel`). Ask the table, never test a platform name inline. On phones
  Settings is a tab (`<SettingsWindow embedded />`), not a window.
- **Rust side**: `#[cfg(desktop)]` gates `shell.rs` (tray, Quick Access, autostart, single instance), the bridge
  thread and rfd; their crates are desktop-only targets in `Cargo.toml`. The global hotkey crate is macOS/Windows
  only (`Ctrl+Shift+Space` on Windows, `⌘⇧Space` on macOS). On iOS/Android the vault lives in Tauri's
  `app_data_dir()` (`storage::set_app_data_directory`; `dirs::data_dir()` is `None` on Android) and decrypted
  attachment copies go under it, not `temp_dir()`. Android uses rustls for the breach check (native-tls would need
  a cross-built OpenSSL). Capabilities are split: `main.json` (all), `desktop.json` (autostart, positioner),
  `global-shortcut.json` (macOS, Windows) — a permission for a crate the target does not link fails tauri-build,
  which skips capabilities whose `platforms` exclude the target.
- **Linux is Wayland-only.** `tauri` is built with `default-features = false` and the defaults minus `x11`, which
  drops wry/tao's `x11-dl` and `gdkx11` (ci.yml fails if they return); GTK itself still contains an X11 backend
  (a system library, not ours to remove). At startup `require_wayland()` (lib.rs) exits with a message when
  `WAYLAND_DISPLAY` is unset and pins `GDK_BACKEND=wayland` so XWayland never wins. Windows are undecorated
  (`tauri.linux.conf.json`, min 480×420 so the app tiles; below 760px it switches to the phone layout) and the
  settings window brings its own close button + Escape. Wayland gives an app no global hotkeys, so Quick Access is
  summoned by the compositor: `bind = SUPER SHIFT, SPACE, exec, mimatory --quick-access` — the single-instance
  plugin forwards the flag and the running app toggles the panel (a first launch with the flag opens it too).
  Positioning a window is ignored under Wayland; a Hyprland rule such as
  `windowrulev2 = float, title:^(Mimatory Quick Access)$` floats the panel.
- **Per-platform Tauri config** is JSON Merge Patch on `tauri.conf.json`: **arrays replace**, so each
  `tauri.<platform>.conf.json` carries the whole `windows` entry. The bundle identifier `app.mimatory.desktop` is
  the same on every platform. Changing it moves the webview profile (localStorage) on desktop and the whole app
  sandbox — vault included — on iOS/Android, which is why the 2026-10-23 rename needed `rename_migration.rs`.
- **`macOSPrivateApi` is gone.** In Tauri 2.12.1 the `macos-private-api` feature is a documented no-op (the private
  APIs are always on) and the config key only feeds tauri-build's feature check, which compares the merged
  per-platform config against `[dependencies] tauri` features — a macOS-only value would fail every other
  platform's build. So neither is set; `tauri` is pinned `>= 2.12.1`. The Mac App Store caveat still holds.
- **CI** (no secrets): `ci.yml` (lint, typecheck, test, build, `cargo check --tests` on Linux, X11 guard);
  `build.yml` (manual or `v*` tags: macOS universal, Windows msi/nsis, Linux deb/AppImage, Android arm64 debug APK
  via `tauri android init --ci`; a non-alpha tag makes a draft **prerelease** with the APK attached; a `v*-alpha*` tag builds macOS only and
  publishes the prerelease);
  `ios.yml` (manual, unsigned ipa from the archive). `src-tauri/gen/{android,apple}` are generated in CI and
  ignored. Signing secrets that would be needed later (none are referenced now): Apple
  `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD`/`APPLE_SIGNING_IDENTITY`/`APPLE_ID`/`APPLE_PASSWORD`/
  `APPLE_TEAM_ID` (notarized macOS, App Store iOS), Windows code-signing cert, Android
  keystore (`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_BASE64`) for a release APK.
- **Screenshots**: the Playwright harness in `work/pwt/shoot-platforms.mjs` (outside the repo, never committed)
  loads `?platform=<p>` at 1280×800 for desktop and 390×844 for phones, light and dark.

## The Passless → Mimatory rename (2026-10-23)

Everything was renamed: crate `mimatory` / `mimatory_lib`, binary `mimatory`, identifier `app.passless.desktop` →
`app.mimatory.desktop`, product name and every UI string `Passless` → `Mimatory`, localStorage `passless-*` →
`mimatory-*`, Tauri events, the extension's `mimatoryToken` / `X-Mimatory-Token` / `#mimatory-fill=` /
`__mimatory` messages, CI artifact names. Existing installs carry real vaults, so the data moves **by copy**:

- **Vault file** (`rename_migration.rs`, run in `run()` before the Tauri builder on desktop, and in `setup` after
  `set_app_data_directory` on phones): `<data dir>/Passless/passless.sqlite3` → `<data dir>/Mimatory/mimatory.sqlite3`
  (macOS `~/Library/Application Support`, Windows `%APPDATA%`, Linux `~/.local/share`). Copied with SQLite
  `VACUUM INTO` from a read-only connection (one consistent snapshot, journal included), `PRAGMA quick_check`ed,
  renamed into place from `*.migrating`, 0600, with `.migrated-from-passless` beside it. **Never** when the new
  file exists; the old file is never modified or deleted. `storage::default_database_path` answers with the old
  file while only it exists, so a failed copy keeps the user on their real vault instead of a first-run screen —
  never "simplify" that fallback away, and never let anything create the new file before the migration runs.
- **Webview profile** (desktop, best-effort, before any window exists): macOS `~/Library/WebKit/<identifier>`,
  Windows/Linux `<local data dir>/<identifier>` copied once from the old identifier when the new one is absent.
  `src/app/storageMigration.ts` (main.tsx's first import) then renames `passless-*` keys to `mimatory-*` (an
  existing new key wins; `passless-theme` is left for `theme.ts` to delete). Losing it only resets preferences.
- **Phones cannot be migrated**: a new bundle id / Android package is a different app with its own sandbox, and
  there is no export. An install of the old identifier keeps its vault in the old app.
- **No Keychain / Touch ID entries exist** (no `keyring` since 2026-10-09; Touch ID only gates `biometric_session`
  in memory), so nothing there needed moving.
- **Extension pairing** (now the fallback transport only): the token is in app memory only (re-paired after every app restart anyway); the
  extension moves a saved `passlessToken` to `mimatoryToken`, and the bridge still accepts `X-Passless-Token`
  from an un-updated extension.
- **Not migrated, by design**: an autostart entry registered by the old app (re-enable Open at Login), Hyprland
  binds (`exec, passless --quick-access` → `mimatory --quick-access`, window rule title `Mimatory Quick Access`).
- **`MASTER_VERIFIER_TEXT` stays `"passless-master-verifier"`** — it is encrypted into every vault and compared on
  unlock; renaming it locks every existing vault.

## Vault security

- **The vault key is never persisted.** It lives only in the `AppState` session mutex for the unlocked
  lifetime. Do not add an OS Keychain entry for it, write a decrypted vault cache, or ship it inside any
  exported file. There is no OS Keychain access at all — the `keyring` crate and `secure_store.rs` were
  deleted 2026-10-09 (Touch ID uses `objc2-local-authentication`).
- **Sync is back (owner, 2026-10-23: "添加google同步… 同时添加webdav，和navill项目一样支持两种方式")** — Google
  Drive `appDataFolder` **or** WebDAV, one at a time; design, remote layout and open owner decisions in
  `.agent/sync.md`. Rules that must hold: only ciphertext leaves the device (AES-256-GCM under a random **sync
  key**, AAD-bound per file); the vault key still never persists — the sync key is wrapped in the remote
  `manifest.json` under Argon2id(master password, manifest salt) and kept locally only inside the encrypted
  `settings` row `sync_config` (with the WebDAV app password / Google refresh token), never plaintext, never in a
  keychain; `sync_base` stores keyed HMACs only (a tag's record key contains its name). Merge is three-way per
  record (LWW by modified time + device id; **edit beats delete**; tombstones); writes use `If-Match` and a 412
  restarts the round before anything local is touched. Sync writes rows with given ids/timestamps through
  `sync/local.rs`, not `VaultService` — **a new synced column or table must be added to `sync/records.rs` +
  `local.rs` read and write**, or it silently stops syncing (and LWW will overwrite it with the remote's value).
  Errors cross the bridge as `SyncErrorInfo {code, status, message}`; the UI translates `code` (never shows
  `message`) and prints an HTTP status with its Chinese gloss in every language. **Every vault write must reach
  `sync_request`**: in `vaultApi.ts` a synced write is declared with `write()` instead of `invoke()`, which calls
  `requestSync()` once the command succeeds — a new write command (bulk selection actions included) that uses
  plain `invoke()` is only picked up by the 15-minute round. Still no export and no backup file; a
  forgotten master password still has no recovery. Full-crate `cargo test` OOMs in the agent sandbox: sync tests
  run in the standalone crate described in `.agent/sync.md`.
- **File permissions**: any file the app writes goes through `storage::set_private_permissions` (0600,
  re-applied on every `open_database` so existing installs self-repair, covering the
  `-journal`/`-wal`/`-shm` sidecars) and `storage::create_private_directory` (0700). Today that is the
  decrypted attachment temp, which has no other confidentiality.
- **CSP**: `tauri.conf.json` `app.security.csp` is `default-src 'self'` + `script-src 'self'`, with
  `ipc:`/`http://ipc.localhost` in `connect-src` and `data:` in `img-src` (built CSS embeds an SVG data URI) —
  those two must be listed by hand because Tauri's `set_csp` only injects script/style hashes. It applies
  **only to packaged builds** (`PROXY_DEV_SERVER = cfg!(all(dev, mobile))`, so on macOS `tauri dev` loads
  `http://localhost:1430` with no CSP). Verify with `npm run tauri build`.
- **Browser bridge**: both transports (native messaging, HTTP fallback) end in the one `handle_request`; see
  "Extension connection" for who may reach it. The pairing token is compared in constant time (`tokens_match`). The server is
  `Access-Control-Allow-Origin: *` on `127.0.0.1:17891` and returns plaintext credentials to a paired client —
  do not widen its reach or add an endpoint that exposes more. **Showing is summaries, filling is one item**
  (2026-10-24): `/match` answers id, title, username, `sign_in_with`, `has_password`, last use and a cached icon —
  never a password, OTP seed, note or custom field (`a_match_summary_carries_nothing_secret`); the extension asks
  `/fill` with `item_id` only after the user picked that login with a trusted click. Keep it that way: anything that
  merely *displays* logins reads `/match`. **The pick path is one item** (2026-10-24, Rei: "选了之后会有很长时间，
  inputs中没有内容…突然就登录上了"): `/fill` with `item_id` reads and decrypts only that item
  (`login_item_for_origin_everywhere`: live, in an open vault, one of its addresses covering the page — an id from
  another site still finds nothing), and the use it records is written on its own thread after the answer (a write
  can wait up to the 5s busy timeout behind the window's connection — measured 830ms behind one 800ms read). `/match`
  and plain `/fill` decrypt only each item's **addresses** to decide (`live_items_whose_address`), the whole item
  only for the matches.
- **Every per-item query needs its index** (2026-10-24). `apply_schema` creates `item_fields_by_item`,
  `item_urls_by_item`, `attachments_by_item`, `items_by_vault`, `item_tags_by_tag` (`IF NOT EXISTS`, no schema bump —
  ids only, no data change). Before them every `get_login_item` scanned whole tables, so a list of N items was
  O(N²): measured (scratch `work/vaultbench`, the real `vault.rs` by `#[path]`, debug build) /match 4.8s and /fill
  pick 4.7s at 1,500 items; after, /match 0.22s and the pick 0.8ms. A new child table keyed by `item_id` gets its
  index in the same change; `initialize_database_creates_vault_tables` checks the plan for `item_fields`.
- **The TOTP seed rests masked**: `fieldValueInputProps` gives an `otp` input `type="password"` unless it is
  the focused field (`focusedOtpField` in `useVaultWindow.tsx`), so a saved key is legible only while being typed. Import
  runs the other way: the QR button in `OtpFieldActions` reads an image **off the clipboard**
  (`src/app/otpQrImport.ts`, decoded with `jsqr`) and stores the `secret` of an `otpauth://` link or a bare
  base32 key, and nothing else. The app never renders a seed as a QR image and there is no screen-region
  capture.

## Extension connection (native messaging, 2026-10-24)

Owner-approved 2026-10-24 (incl. the macOS browser code-signature check): the extension reaches the app the way
1Password's does — no pairing code. Chain: content script → `background.js` (adds the page's `origin` from
`sender.origin`, never from the page) → `chrome.runtime.connectNative('app.mimatory.native')` (one persistent port,
request ids, 20s timeout, reconnect on the next call) → the browser starts **the app's own binary** as the host →
the host relays each `{ id, path, body }` over local IPC to the running app → `browser_bridge::handle_request` → back
as `{ id, status, data }` with the HTTP bridge's status codes (content.js reads both transports alike).

- **Fixed extension ID `pjcffbogeilnkbmnlegjdciggbfbekfb`**, from the public `key` in `browser-extension/manifest.json`
  (SHA-256 of the DER key, first 16 bytes, 0–f → a–p). **The private key is `/workspace/.keys/mimatory_extension.pem`,
  outside the repo** (2048-bit RSA, 0600) — it is what a Chrome Web Store / CRX package must be signed with to
  keep this ID. Never commit it; a new key means a new ID, new host manifests and every user re-adding the
  extension. `CHROME_EXTENSION_ID` in `native_messaging.rs` must match the key (a test checks the shape only).
  Firefox: `browser_specific_settings.gecko.id = extension@mimatory.app` (Chrome warns about the unknown key and
  loads; the extension still has a Chrome-only `background.service_worker`, so Firefox is not actually supported yet).
- **Host mode** is detected first thing in `run()` (before the Wayland check, the rename migration, single
  instance or any window): an argument `chrome-extension://…` (Chrome passes the caller origin as argv[1], plus
  `--parent-window=` on Windows), `extension@mimatory.app` (Firefox passes the manifest path + the id) or
  `--native-host`. `validate_caller` then accepts only our own origin / gecko id. Framing: 4-byte native-endian
  length + JSON; the host refuses to hand Chrome more than 1 MB (`413 response_too_large`). **The app is never
  launched by the host**: no running app → `503 app_not_running`, and the popup says 密码库存未运行.
- **IPC endpoint**: macOS `~/Library/Application Support/Mimatory/native-messaging.sock` (the vault folder, 0700);
  Linux `$XDG_RUNTIME_DIR/mimatory/native-messaging.sock` (folder 0700; vault folder if unset); socket 0600, a stale
  one replaced at startup. Windows `\\.\pipe\mimatory-native-messaging-<USERNAME>` with the default ACL,
  `FILE_FLAG_FIRST_PIPE_INSTANCE` + `PIPE_REJECT_REMOTE_CLIENTS`.
- **Who may connect** (`native_ipc`): the peer (SO_PEERCRED / LOCAL_PEERPID + getpeereid /
  GetNamedPipeClientProcessId) must be the same user and run **our own executable** — same canonical path, or a
  byte-identical file (SHA-256; an AppImage remounts on every launch, so its manifests name `$APPIMAGE`). The host
  checks the server the same way before sending anything. **macOS only**: the host's parent process (the browser)
  must pass `SecCodeCheckValidity` against `anchor apple generic and certificate leaf[subject.OU] = "<team>"` for one
  of `BROWSER_TEAMS`: Chrome `EQHXZ8M8AV`, Edge `UBF8T346G9`, Brave `KL8N8XSYF4`, Arc `S6N382Y83G`, Vivaldi
  `4XF3XNRN6Y`, Firefox `43AQ936H96`, Opera `A2P9LX4JPN` (verified 2026-10-24 against Installomator labels and vendor
  pages; sources in the const's comment). Unsigned Chromium / Playwright builds are refused in a release build; a
  **debug build logs and accepts** them. A refused caller gets `403 caller_not_verified` for every request.
  Linux and Windows check only the executable (no browser signature; on Windows Chrome starts hosts via `cmd.exe`).
  Residual risk, accepted: a same-user process can start a signed browser with its own unpacked extension carrying
  our public key (same ID) — branded Chrome ≥137 ignores `--load-extension`, but Chromium forks may not.
- **Registration** (`register_hosts`, a thread at desktop startup): the manifest (`path` = `current_exe()`, inside the
  `.app` on macOS, the dev binary under `tauri dev`) is written into `<browser>/NativeMessagingHosts/` only where the
  browser's own folder already exists (never creates a profile), and only when the content differs. macOS: Google
  Chrome (+ Beta, Canary), Chromium, Microsoft Edge, BraveSoftware/Brave-Browser, `Arc/User Data`, Vivaldi,
  com.operasoftware.Opera, Mozilla; Linux: google-chrome, chromium, microsoft-edge, BraveSoftware/Brave-Browser,
  vivaldi, `~/.mozilla/native-messaging-hosts`; Windows: manifests in `%APPDATA%\Mimatory\NativeMessagingHosts\`
  and `HKCU\Software\{Google\Chrome, Microsoft\Edge, BraveSoftware\Brave-Browser, Chromium, Mozilla}\NativeMessagingHosts\app.mimatory.native`.
  Settings ▸ Browser Extension shows the registered browsers, whether a host is connected and the ID
  (`browser_connection_status`); the pairing code moved under "Pairing Code (Fallback)".
- **Warm-up** (2026-10-24): a content script that sees a sign-in form (scan) or a focused login field sends
  `MIMATORY_WARM`; `background.js` opens the port and sends one `/health` unless the port already answered. The
  first request on a port pays for starting the host (the app's own binary — under `tauri dev` the large debug
  build), its socket connect and the app's caller checks (same executable; on macOS `SecCodeCheckValidity` of the
  browser) — once per connection (`verify_client` runs at accept, never per request), so the warm-up takes it off
  the user's pick. The open port keeps the MV3 worker alive (Chrome ≥ 105); a worker restart re-warms on the next
  form. Stand-in measurement on Linux (8 MB host): 2ms cold vs 0.2ms warm — the Mac's cold cost (big binary +
  signature check) was not measurable here. `work/nmcheck/warm-check.mjs` proves a form page sends `/health` with no
  `/match` and the menu's `/match` rides the same host process.
- **Fallback, this release only**: when `connectNative` cannot start a host at all (an older app, an unregistered
  browser) `background.js` uses the HTTP bridge + token as before, and only then does the popup show the pairing
  field. A native `403`/`503` does not fall back. Removing 17891 is a `needs-owner-decision` in `.agent/todo.md`.
- **Tests**: `native_messaging.rs` / `native_ipc.rs` depend only on serde_json, sha2, dirs, libc,
  core-foundation-sys, windows-sys and winreg, so `work/nmcheck` (project scratch, outside the repo) includes them by
  `#[path]` to run their unit tests (incl. a real 0600 socket round trip) and `cargo check` them for
  `aarch64-apple-darwin` and `x86_64-pc-windows-msvc`; its `nmhost` binary + `e2e.mjs` drive apt Chromium with the
  unpacked extension through the real host code (fixed ID, popup states, content script → `/match` with the page
  origin, app restart, HTTP fallback).

## UI structure and its traps

- **No text selection and no native context menu.** `@layer base` sets `user-select: none` on `*`, re-enabling
  `text` only for `input`, `textarea`, `select` and `[contenteditable="true"]`; one `useEffect` in `App()`
  (`src/App.tsx`, registered *before* its `?view=` early returns, so it runs in all three windows) calls `preventDefault()` on
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
  **Keys live in localStorage, not the vault** (`mimatory-sidebar-highlights`, `src/app/sidebarHighlights.ts`,
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
  table is declared in `src/app/vaultModel.ts`) is therefore the one type table (17 entries,
  sidebar rows and picker both), and `i18n.test.ts` reads *its* shape
  (`icon: <Component>, itemType: 'x' }`) to derive the `itemTypes.*` keys — widening that regex is how a new type
  gets its translations checked.

## Data model

- **Two kinds of soft delete**: `items.archived` and `items.trashed` + `deleted_at`, each a nav row at the foot of
  the sidebar carrying its own count. Neither view reads the live items — `visibleItems` returns nothing for them,
  and the rows come from `vaultApi.trashed()` / `vaultApi.archived()` — because the detail pane only ever edits
  live items. Since 2026-10-25 their rows are selectable like live rows (see "Multi-selection and bulk actions"):
  the detail pane never opens a trashed or archived item — one selected row shows `SelectionPane`'s "In the Trash"
  card with 恢复 / 永久删除 (archive: 恢复 / 移到废纸篓), several show "N 个项目" with the same actions, and the
  trash list carries 清倒废纸篓 at its top. `updated_at` doubles as the deletion timestamp (`trash_item` writes
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

- **Item relations** (2026-10-15, owner: "子项（从属关系）… 关联项（平等关系）。有这种关系的不能删除，可归档"). Two
  kinds of link: a **child** belongs to one parent (no self, no cycle — `set_item_parent` walks the parent chain),
  a **related** item is a peer and the link is written on **both** items so either end lists and unlinks it.
  Storage is `items.relations_ciphertext` (schema 3, added by `ALTER TABLE` like every earlier column): encrypted
  JSON `{parent, related: [ids]}` under the vault key, **NULL when empty** — so the link graph is no more readable
  on disk than a title, and the only plaintext signal is NULL vs not (same class as `favorite`/`archived`).
  Children are not stored; they are the items whose `parent` names this one, resolved from one decrypted index
  per list (`relation_index`). `list_login_items` / archived / trashed and create/update returns carry
  `relations: {parent, children, related}` (id, title, item_type, archived), skipped from the JSON when empty;
  the browser bridge, Watchtower and the migrations read `list_live_items`, which never resolves them, so the
  extension sees no other item's title. **Rules**: links stay inside one vault (only live, non-trashed items of
  the session's vault can be linked); an item with any *resolvable* link cannot be trashed, purged or moved
  (`ItemHasRelations`, `ItemRelationsBlockMove` — a dangling id does not count, or nothing could ever free it);
  **archiving is allowed and keeps the links**, and both ends show the archived counterpart with an "Archived"
  caption (it is not navigable: the pane only opens live items). Dissolving a vault moves every item together, so
  links survive it; a duplicate starts unlinked. The old `related_item` custom field is migrated on unlock into a
  real peer link when its target is still live in that vault (left as a field otherwise). In the UI the links are
  part of the edit form (`relationDraft` in `LoginFormState`, compared by `itemDrafts`) and only written on Save,
  after the item, removals first (`relationChanges`); Cancel discards them. Add More ends with Parent Item… /
  Child Item… / Related Item…, each opening the picker sheet (search field, ↑/↓, Return picks a single match),
  whose candidates exclude self, already-linked items, anything that would close a loop, and — for a child —
  items that already have another parent. In the item menu, Delete and Move To stay visible but disabled with a
  one-line reason while the item has links; Archive sits right above. The bulk paths apply the same rule to a
  whole selection (`linked_outside`, below): a linked group selected together moves or trashes together, an item
  linked to something outside the selection stays and comes back in `held`.

- **The list carries summaries; one item is decrypted when it is opened** (owner 2026-10-23: "列表只返回摘要，选中条目时再解密详情").
  Every list command the window calls (`unlock_vault`, `setup_master_password`, `unlock_with_biometrics`,
  `switch_vault`, `list_login_items`, `list_all_login_items`, archived, trashed) answers with `LoginItemSummary`
  (vault.rs): id, vault, type, title, username, **first** address, tags, favourite, the three sort timestamps + use
  count, icon mode, the raw `sign_in_with` provider value, `parent_id` and `has_relations`. Never a password, notes,
  custom-field value, second address or attachment. `list_summaries_by_state` reads the whole list in four queries
  and skips the password/notes rows entirely; it still decrypts the custom-field JSON once per item, only to read the
  "Sign in with" provider for the subtitle (there is no column for it). `get_login_item(itemId, vaultId?)` returns
  the one full item with resolved links; `useItemDetail` (src/app/useItemDetail.ts) keeps **only the selected one**,
  re-reads it whenever its row object changes (every re-list, so saves, favourites, links from the other end and
  `vault:changed` all reach it), drops stale answers and forgets it on lock. While it loads the form does not switch
  (`draftKey` is `null`) and the pane shows `.detail-loading`, a spinner that fades in after 250ms. Quick Access
  reads the password / OTP seed with `get_login_item` at copy time. **Search**: the toolbar matches titles and Quick
  Access title/username/first address, all summary fields; `list_login_items(query)` still searches every decrypted
  value in Rust and answers with summaries. The bridge, Watchtower and breach check read their own full-item paths
  (`list_live_items`, `export_login_items`) and are unchanged. The full-item list methods in vault.rs are
  `#[cfg(test)]` now.

- **Multi-selection and bulk actions** (2026-10-25, Rei: "⌘A 不能全选 … 没有办法批量删除", to redo a duplicated `.1pux`
  import). The selection is one `ListSelection` (`listSelection.ts`: `ids` Set + `anchor` + `lead`) in
  `useVaultItems`; **`selectedId` is derived** — the one id when exactly one row is selected, else `null` — and
  `setSelectedId(x)` collapses the selection to `x`, so every single-item path (detail read, item menu, shortcuts,
  vault follow) keeps working and nothing single-item runs on a multi-selection. A functional `setSelectedId(cur =>
  cur ?? first)` (a re-list) leaves a multi-selection alone. Finder rules: click = one, ⌘-click (Ctrl elsewhere)
  toggles, ⇧-click = range from the anchor, ⇧↑/⇧↓ extend, ⌘A = every row of the list on screen (current scope,
  filter and sort), Escape clears a multi-selection, ⌘⌫ = Move to Trash (trash view: Delete Permanently). The
  keyboard handler ignores text fields (`isTextEntryTarget`: ⌘A keeps selecting text), menus, dialogs, the edit
  lock and the phone layout. **Edit ▸ Select All** is the predefined AppKit item (`selectAll:` to the webview); the
  page sees it only as a `selectstart` whose target is the document/body/html, which the window turns into ⌘A
  (a drag-start is told apart by a pointer being down). Proven with `document.execCommand('selectAll')` in
  Chromium; never clicked in WKWebView. A multi-selection is pruned when rows leave the list; a single selection is
  not (the pane may show a just-saved item from another list on purpose). **Bulk commands are Rust, one IPC call
  and one transaction each** (`trash_items`, `archive_items`, `restore_archived_items`, `restore_trashed_items`,
  `purge_items`, `move_items` → `*_login_items` in lib.rs, `vaultApi.*Many`, all through `write()` so sync is
  asked): the ids go into a `temp.bulk_ids` table, grouped by vault (a selection from All spans vaults), and
  every statement joins it — never an IPC call or a scan per item (10,000 items in the debug scratch crate: trash
  0.12s, restore 0.04s, purge 0.32s). Archive touches items only, never a vault row. **Purge** only deletes
  items already in the trash, deletes their `item_fields`/`item_urls`/`attachments`/`item_tags` rows by hand
  (not trusting the cascade pragma), strips their ids out of every other item's encrypted relation record
  (parent, related, sign-in), prunes tags, and sync turns it into tombstones like a single purge. Archived items can
  be moved to the trash too (so "delete everything" reaches them); a trashed archived item restores to the archive.
  Confirmations: several items to the trash = a light alert focused on its action; Delete Permanently and Empty
  Trash = destructive alerts stating the count and "can't be undone", focused on Cancel (`alerts.md`).
- **Every sidebar scope opens on its first row** (Rei 2026-10-25: "切换分类，则默认focus这个分类中的第一个项目，如果分类中
  没有items，则详情页为空" / "标签同理"): a change of `navigationKey` (the nav id, or `vault:<id>` for a vault row)
  selects the first row of the new list in the current sort and scrolls it into view, replacing any selection;
  an empty list leaves the pane empty. Skipped while editing or composing (a new item's draft switches category
  itself). DOM focus is not moved — a search field keeps the caret.
- **The vault row lists from `allItems`, not `items`** (bug 2026-10-25, Rei: "personal库显示838个items，但点击后，列表
  为空"). Root cause: the row's count is `list_vaults`' live-item count, but its list was `items` — whatever the Rust
  session last listed — and a click only called `switch_vault` when the clicked id differed from the window's
  `activeVaultId`. Nothing kept those two in step: `handleLock` reset `activeVaultId` to `personal` while the
  biometric session kept the last vault the session had followed (Touch ID unlock then listed *that* vault), a
  failed or slow `switch_vault` left the previous vault's rows under the new title, and the unlock always opened
  `personal` even when it was archived or dissolved. Rust's counts and lists were verified to agree (838 counted =
  838 listed = 838 in All, import twice, first switch included — `work/vaultbench/src/repro.rs`). Fix: the vault
  view is `allItems` filtered by `activeVaultId` (same rows as the count; `items` only before All loads or for an
  archived vault); a click from another row always switches; `handleSwitchVault` names the vault at once and puts
  it back if the switch fails; `opening_vault_id` (Rust) and `openingVaultId` (TS) share one rule (the seeded vault
  while open, else the oldest open one) and both unlock paths use it; after an unlock the window switches the
  session if its list came from another vault. The cross-vault follow effect is off on the vault row (it
  ping-ponged with the switch).
- **The last open vault stays** (Rei 2026-10-25: "如果只剩下一个保险库了，这个保险库不能archive，不能删，只能编辑"):
  `set_vault_archived(true)` and `dissolve_vault` return `VaultLastOpen` for it; its menu keeps 归档保险库 and 解散保险库
  disabled with 至少要保留一个保险库 under them (`isLastOpenVaultIn`). Restoring an archived vault always works.
- **The item list is virtualized** (`@tanstack/react-virtual`, `itemList.tsx`, 2026-10-23): only the rows near the
  viewport exist. The rows stay in the normal flow of `.rows` and the off-screen ones are stood in for by the
  container's inline `paddingTop`/`paddingBottom` (a grid adds no gap to padding), so every skin's row rules, the
  grid gap and `.item-row + .item-row` apply unchanged; the gap and the rows' offset in the scroller are read off the
  DOM each commit. Rows are measured with `getBoundingClientRect().height` (fractional — the default rounding
  drifted a pixel within a few rows) and the last measured height is the estimate for unrendered rows, so the scroll
  height equals the full list's. **A row off screen is not in the DOM**: anything that scrolls to an item goes
  through `listScrollToItemRef` (⌘↑/⌘↓ and the toolbar arrows do), never `querySelector('[data-item-row]')`. jsdom
  lays nothing out, so `App.itemMenu.test.tsx` gives `.item-list` an 800px `clientHeight`; a new DOM test that
  renders the list needs the same. `content-visibility` on rows went with this.

- **Website icons** (2026-10-17; sources changed 2026-10-18, owner: icons were blurry). An item's tile shows its
  first address's site icon, else the letter (`ItemIcon`: list rows, search results, detail header, Quick Access,
  picker rows). **Sources** (`favicon.rs`): Google's favicon service first (`t1.gstatic.com/faviconV2`, size 128,
  `fallback_opts=TYPE,SIZE,URL` — it answers 404 instead of a globe, and 404 means no icon), then, when that is
  missing or under 128px, the site itself: `<link rel=icon|apple-touch-icon>` (SVG skipped, `data:` decoded
  inline), the web manifest's icons (only when the page claims nothing ≥128; `purpose` must include `any`), then
  `/favicon.ico` (only while nothing ≥64 turned up). The largest source edge wins. **Why it was blurry**: every icon
  was squeezed into a fixed 64px PNG (and 16/32px favicons nearest-upscaled to it), which the 48–64pt tiles then
  upscaled again on Retina. Now icons are re-encoded at their own size (never upscaled, Lanczos-capped at 192px) and
  CSS downscales. **Privacy**: Google learns each host — an owner decision recorded in `.agent/todo.md`; the
  "Download website icons" switch stops every lookup. Every request (Google's too) goes through the same guard:
  https and the default port only (redirects too, at most 4), every hop's host resolved first and **pinned** with
  `resolve_to_addrs`; loopback/private/link-local/CGNAT/multicast/unspecified (and v4-mapped forms) refused; no
  cookies, no referrer, 8s timeout; a page is **cut** at 512KB (github.com's homepage is larger), an icon over 256KB
  or a manifest over 64KB is refused; content type image/*, octet-stream or absent **and** supported magic bytes;
  decoded under 2048px/32MB limits. A system proxy is honoured (check runs locally first — accepted). **Cache**:
  `site_icons` keyed by `HMAC-SHA1(vault key, "site-icon:" + host)`, value the data URL encrypted under the vault
  key; a NULL icon is a remembered miss; fresh 30 days (a miss 3). **Schema 5 deletes every cached row once** (the
  64px ones) — bump the schema the same way if the stored format changes again. `cached_site_icons` never touches
  the network; `fetch_site_icon` (async, at most 2 in flight from `siteIcons.ts`) does. Per item `items.icon_mode`
  (`auto`/`letter`) and the item menu's Refresh Icon / Use Letter Icon. The bridge has no icon endpoint; `/match`
  attaches an item's cached icon (cache only, never a fetch; none for `letter`). Quick Access only reads the cache. Tests: `favicon.rs` runs against a local tiny_http server standing in for both
  Google (`FetchPolicy.icon_service`) and the site, through the same code path with a relaxed policy.

- **Attachments** (2026-10-18, owner): an attachment is never replaced once added — a stored row offers Export
  (and Preview for `.txt`) plus remove, never Choose/Change (`AttachmentEditActions`, `attachmentControls.tsx`). A
  `.txt` (by its label, which Rust sets to the file name) opens `TextPreviewDialog`: `read_attachment_text` decrypts
  in memory — nothing written to disk, unlike Export's temp copy — and decodes lossy UTF-8 (BOM dropped, cut at
  256KB on a character boundary). The sheet keeps the app's no-selection rule; Copy (90-second clear: an attachment
  may hold a secret) is the way out, and arrows/Page keys scroll the `<pre>`. In the view the whole row opens it
  (`FieldView`'s `activate` prop).

- **A section's Add More is the section card's last row** (`EditSectionCard`, owner 2026-10-18): inside the same
  `.field-group`, drawn as a field cell by `.add-more-wrap.is-section`. The item-level bar is unchanged.

- **Sign in with…** (2026-10-17, owner: "支持类似1password的 sign in with..."). Two halves, each stored where it
  belongs: the **provider** is the item's one `sign_in_with` custom field, value `google`/`apple`/`github`/
  `microsoft`/`facebook`/`x` or any other name the user typed (template-JSON world, so it round-trips through old
  builds and the bridge can read it); the **account** it signs in with is a link, `sign_in` in the encrypted
  relation record, resolved as `relations.sign_in_with` on the item and `relations.signs_in_to` on the account
  ("Used to Sign In To"). Decided as its own directed link kind rather than a *related* link: it has a direction,
  and either end must still say what it is. It counts like every link: both ends refuse Delete and Move while it
  stands, same vault only, never itself; a duplicate starts without it. Builds before this stored the account's
  **item id** in the field value — `migrate_legacy_sign_in_fields` (on unlock / vault switch, like the related-item
  migration) turns a resolvable id into the link and replaces the value with the provider guessed from the
  account's address or title, else the account's title as a provider name; a dangling id is left alone and shows
  as an unnamed "Other". Forward-compat caveat: an older build that rewrites an item's relation record drops
  `sign_in` (serde ignores unknown keys). UI: Add More ▸ Sign in with… opens the sheet (provider grid + optional
  account list, the provider's own accounts first); Done writes the form, Save writes the link after the item
  (`setSignIn` is the last `RelationChange`). The view row links to the account; the password row is hidden in the
  editor while empty; the list subtitle reads "Sign in with Google". Provider marks are Simple Icons paths
  (CC0, bundled, `currentColor`), Microsoft drawn as four squares. **Extension**: `/fill` matches carry
  `sign_in_with` (provider only — never the account item); the popup says "Sign in with Google" and the content
  script outlines and focuses the page's provider button **without clicking it** (a provider sign-in can create an
  account or share profile data). The one exception is the one-click float's own button, labelled "使用 Google 登录"
  (owner 2026-10-24): pressing it is the user asking for exactly that click, so it highlights **and** clicks.

- **Item templates and typed fields** (2026-10-14). Every category's default fields are data in
  `src/app/itemTemplates.ts` (key, `field_type`, label key, options, rules); the editor and the read-only view
  draw every field through `FieldEditor` / `FieldView` in `src/app/fieldControls.tsx`, chosen by type alone, so a
  new behaviour is a type or a template change, never a per-category branch in the editor (`itemEditForm.tsx`). **The vault format did
  not change**: a template section is still a `section` custom field whose value is a JSON array of children,
  and each child a template seeds carries a `key` inside that JSON (Rust treats both as opaque strings; a
  top-level `CustomField` cannot take a new property, because serde drops unknown fields on the round trip).
  `itemFields.ts` reads it both ways: on load `normalizeTemplateFields` gives keyed children the template's
  current type, recognises unkeyed children saved by older builds by their label in *any* locale (that is the
  migration — no stored data is rewritten until the user saves), and seeds missing template fields empty; on save
  `pruneEmptyTemplateFields` drops empty template children (and a section left with nothing else), so the vault
  only holds what was typed and the dirty check compares through `comparableFields`. Template fields have no
  remove button (empty means hidden in view, not stored); user-added fields and sections do. Types without
  username/password columns still show them when an older item has data there. Select values are stored as
  option ids, labelled `itemTemplates.options.<set>.<id>`; an unknown stored value stays selectable as itself.
  Validation hints (`fieldHints.*`) appear on blur and never block saving.

- **Field actions follow 1Password 8** (2026-10-17, owner: "检查一下所有字段在view和edit中是否和1password交互逻辑一致").
  The comparison table lives outside the repo (`work/field-audit.md`). Rules: a read-only row *is* its primary
  action — a transparent `.field-row-primary` button behind the content (a button cannot hold the strength meter's
  blocks), so trailing buttons stay their own targets; `fieldActions()` decides primary + menu by type alone
  (website = Open & Fill on desktop / Open on phones, URL in a section = Open, everything else = Copy; Reveal,
  Send Email, Call, Show in Large Type as the type allows). The menu is self-contained (`FieldActionMenu`, portal,
  own capture-phase outside-pointer/Escape listeners), so it needs no flag in `VaultWindow`'s dismiss effect; in
  the phone layout it renders as an action sheet opened by long press, whose release click is swallowed so a long
  press never also copies. The view's eye button is gone — Reveal is in the menu and ⌘R/Ctrl+R toggles every
  secure field (`revealAllSecure`, reset per item and on Edit). Item shortcuts are read through a ref
  (`itemShortcutRef`) so one listener always sees the item on screen; they ignore text fields, dialogs and menus,
  and ⇧⌘F no longer also focuses search. **Every clipboard write goes through `copyText`** (`clipboard.ts`):
  secrets — passwords, concealed fields, card numbers, OTP codes, OTP seeds and setup links — honour the 90-second
  clear, plain values do not; Quick Access reads the setting fresh from localStorage at copy time.
  **Open & Fill has no channel into the browser**, so it rides the URL: `openAndFillUrl` appends
  `#mimatory-fill=<item id>` (a *fragment*, never sent to the server — 1Password's query parameter breaks some
  sites), skipped when the URL already has a fragment (hash-routed apps). `content.js` strips it with
  `history.replaceState`, then fills **that** item through the ordinary origin-scoped `/fill` (an id from another
  site finds no match), retrying for ~5s while a late sign-in form renders. No bridge endpoint was added. The page's
  own scripts can read the item id before it is stripped — an opaque UUID, accepted. Large Type colours digits in
  the link blue and symbols in red as 1Password does (documented exception in `.agent/design.md`).

- **Websites and autofill behaviour** (2026-10-17, owner: "这是1password链接的交互逻辑"). An item's websites are the
  existing `item_urls` rows (label, url, `match_type`, position — the model already allowed several; `items.website`
  is the first, which is also the icon's). `match_type` is `domain` (default, "Fill anywhere on this website"),
  `exact` ("Only fill on this exact host") or `never`; anything else normalises to `domain`, so no migration was
  needed. **Matching lives in Rust only** (`site_match.rs`, unit-tested): `domain` compares the registrable domain
  (eTLD+1 from the `psl` crate's compiled Public Suffix List, private section included, so `github.io` users are
  separate sites) plus a small bundled related-domain list, ignoring the port; an address that *is* a suffix or an IP
  matches only its own host; `exact` compares host **and** explicit port; `never` makes that address count for
  nothing — exactly 1Password's documented rule, so another "anywhere" address of the same item still fills there.
  Hosts are compared as punycode (`url` crate). The bridge's `/fill` uses it (`list_login_items_for_origin`); the
  extension now sends `location.origin` so ports reach it (a bare hostname from an old extension still parses).
  `/save` looks for the account to update with `list_login_items_for_site` (domain rule over every address, `never`
  included) and keeps the item's websites instead of overwriting them. The editor's info box asks
  `describe_website` (pure, no vault) and says "and some related websites" only when the domain is in that bundled
  list. In the view a non-default behaviour shows a one-line note under the address, and a `never` site offers Open,
  not Open & Fill (also for ⇧⌘F), as 1Password 8.10.80 does.
- **Field rows** (2026-10-17, owner: "要做到所有的字段样式都是统一的"). Every field in both modes is one `.field-row`
  cell: `FieldView` / `OtpFieldView` read-only, `EditFieldRow` editing (a `.field-slot` = the cell, plus for a
  movable row a handle hung *outside* the card in the pane's padding, so every card lines up with the item icon —
  owner 2026-10-18). The handle needs `--measure-detail-inline` ≥ `--measure-field-handle`, and `.detail-fieldset`
  bleeds into the pane padding (`margin-inline` negative, `padding-inline` back) because it is the scroller: a
  handle outside its padding box would be clipped. `.field-slot` carries `min-w-0` (a grid item; without it a long
  value widens one card past the others on a phone). Per-type differences are the value
  control and trailing buttons in `renderEditField`, never a row shape; `designContract.test.ts` fails on a retired
  row class or a form control outside `EditFieldRow`. Reorder: containers `urls`, `login` (sign-in / passkey / OTP
  in the credentials card — a **fixed** order, `orderCredentialFields`, no handles, owner 2026-10-18), `top` (loose fields and sections) and `section:<index>`; `fieldReorder.ts` moves an
  entry (fields cross into and out of sections, sections only among top entries, nothing into `login`, template
  children stay in their section) and Alt+↑/↓ on the handle steps across a section's edge. Drag is pointer events
  on the handle with capture (`useFieldDrag`), hit-testing the innermost `[data-reorder-container]` row. The OTP
  edit row stores normalized base32 (a pasted `otpauth://` link gives up its `secret` — the Rust TOTP reads bare
  keys only), shows it in lowercase groups of four while focused and masked otherwise; its QR button reads a copied
  image, else opens an image picker (the phone's camera / library).
- **Add More is one component** (`addMoreMenu.tsx` + the entry list in `addMoreOptions.ts`, owner 2026-10-18):
  the item's bar and every section's bar, `context: 'item' | 'section'`; a section leaves out Sign in with, OTP,
  Section, Parent / Child / Related (and what a section's JSON children cannot hold: attachments). The menu renders
  in a portal (`data-field-menu` keeps the window's outside-click handler off it) and places itself after measuring
  (`useAnchoredPanel` → `placeAnchoredPanel`): below or above, height capped to the room, 8px inside the window,
  220–280px wide. Phones get the action sheet. The Autofill Behavior popover uses the same hook, and
  `getMenuAnchorStyle` (item/tag/vault menus) now caps `maxHeight` the same way (code only; never seen capping in a screenshot). Never re-add a per-menu
  `position: fixed` with a guessed height: that is how a tall menu ran off the top of a short window.
- **The key button opens the generator popover; it never inserts a password blind** (owner 2026-10-18, the
  1Password 8 generator). `PasswordGeneratorButton` (`passwordGeneratorPopover.tsx`) serves the login's password
  row and every `password` field (`FieldEditor`'s `onGenerate` now takes the options). Rules in
  `passwordGenerator.ts`: types are the backend's three modes; the popover shows only Numbers / Symbols for Random
  (letters are forced on, ambiguous-character avoidance stays on) — the Settings ▸ Generator tab was removed 2026-10-18 (owner), so the popover is the only generator UI.
  Last-used options are remembered **in memory only** for the window's life (nothing persisted, as before). It owns
  its Escape / outside-click listeners (like the Autofill Behavior popover), so it needs no flag in VaultWindow's
  dismiss effect. The caller's `generate`/`measure` are fresh closures each render; the button wraps them in stable
  functions, otherwise the panel would regenerate on every parent render.
- **Passkeys are never added by hand** (owner 2026-10-18: "通行密钥不能手动添加"). No Add More entry offers one
  (`addMoreOptions.test.ts` guards it). The extension's MAIN-world `passkey-observer.js` reports a *completed*
  `navigator.credentials.create`; `content.js` checks the rp id fits the page's host (a page may only name its own
  host or a parent domain), asks in a closed-shadow prompt (a login for this site, or New Item), and only Save posts
  `/passkey-event` with `item_id` / `new_item` (`VaultService::save_passkey`, `PasskeyTarget`). A content script's
  isolated world cannot see the page's `navigator.credentials` calls — the old observer there never fired. Mimatory
  stores metadata only; the private key stays with the platform authenticator.

- **Field menu fills, the float signs in** (2026-10-24, as 1Password: its inline menu never submits). Picking in the
  field menu fills the username from the `/match` summary at once, puts a spinner chip at the password field's
  trailing edge (closed shadow root, `[data-mimatory-feedback]`), fills the password when `/fill` answers and **does
  not submit**; a value the user typed meanwhile is left alone. No answer in 10s (`PICK_TIMEOUT_MS`), `423`, `503` or
  a missing item → a short note under the field (`fillErrorLocked` / `fillErrorTimeout` / `statusAppNotRunning` /
  `fillErrorFailed`), never silence. Identifier-first: the username is filled and the item stays pending for a
  minute in mode `fill` (`rememberPendingStep(id, 'fill')`); the user presses Next, and focus on the password step's
  field fills it (spinner, no submit) instead of opening the menu. The float's pending mode stays `submit` (the
  password step is filled and submitted as soon as it shows). Old pending entries without a mode read as `submit`.
- **One-click sign-in float** (owner 2026-10-24, 1Password's sign-in pill; `content.js`, last section). A pill at the
  **top centre** of the viewport (closed shadow root, `z-index` max, `position: fixed` on a zero-size host so the
  page never reflows) offers the **most recently used** login (`/match` order; a pick through `/fill` with
  `item_id` records a use) for a page that shows a sign-in form (password, or an identifier-first username).
  登录 = `/fill` with `item_id` → `fillLogin(item, { submit: true })`, so an identifier-first page continues on its
  password step through the existing pending-step machinery; a chevron opens the other logins **downward inside the
  same card** (5 rows, then scroll) and a row signs in with that login; "Sign in with…" logins click the provider
  (see above). Locked (`423 已锁定`) → 解锁密码库存 → `POST /unlock` (the bridge brings the main window, i.e. its
  lock screen, forward; the master password is never typed in a page) → `/match` every 2s for up to 2 min while the
  tab is visible. `401 未授权` / app not running → nothing. Never shown while the user is in a login field or the
  field menu, during a pending identifier-first step, after Open & Fill, after a pick or × / Escape (dismissed per
  tab + origin in `sessionStorage`), on a "never on this site" origin (`chrome.storage.local` `mimatoryFloatNever`)
  or with the popup switch off (`mimatoryFloatEnabled`, default on; the popup also clears the never-list). Scans
  run debounced on load and for 5s after load / a URL change (MutationObserver + popstate/hashchange), so
  late-rendered SPA forms are caught without watching forever.
  **Frames**: `content.js` is `all_frames` since this (the field menu now works inside iframes too); a frame only
  *reports* its form through `background.js`, which adds the frame's real origin and forwards to frame 0, and the
  top frame's float asks that frame (`MIMATORY_FRAME_CALL` match / pick) — never another. A frame from another site
  is ignored (`sameSite`, a PSL-less heuristic: same host, or same last two labels, three under `co.uk`-style
  suffixes). The popup's Fill, Open & Fill and the passkey handler answer in the top frame only, as before.
  Tokens are the field menu's (`MENU_TOKENS` / `MENU_TOKENS_DARK`), following `prefers-color-scheme`.
  **Feedback on 登录** (2026-10-24): the username goes in at once, the action turns into a spinner + 正在登录… (every
  control disabled) until the page is filled and submitted, then the float leaves; a failure shows the same note as
  the field menu under where the float was. `floatPicking` keeps the float's own username fill (a focus in a login
  field, or the frame's "no form now" report) from hiding it mid-sign-in. A frame's pick answers `{ ok, status }`.
  **Background** (owner 2026-10-24: "背景最好有一点动画效果"): a macOS material — `--material` = surface at 86% +
  `backdrop-filter: blur(30px) saturate(180%)` (opaque where unsupported) — with an accent/purple radial glow drifting
  on `::before` (9s alternate) and one light sweep on `::after` as it appears; transform/opacity only on
  pseudo-elements behind the content (`overflow: hidden; isolation: isolate` on `.float`), paused (`.is-paused`) while
  `document.hidden`, and none of it under `prefers-reduced-motion` (static material). 78%/74% material was tried and
  read muddy on black / low-contrast for the blue action in dark on white — keep ≥ 86%.

## Testing and verification

- **Frontend tests**: co-located `*.test.ts`. Vitest globals available without imports. The environment is
  **node**, not jsdom — booting jsdom per file cost 405s against 4.7s of assertions. `src/test/setup.ts`
  (jest-dom) is on disk but **not wired** via `setupFiles`. The one DOM test, `src/App.itemMenu.test.tsx`, opts in
  with `// @vitest-environment jsdom`, imports `@testing-library/jest-dom/vitest` itself and renders the whole
  `App` against `mockIPC` + `mockWindows`. Trap: a script-dispatched click has no microtask checkpoint between
  listeners, so React commits only after the event has reached `window` and an "the opening click also closes
  it" bug stays invisible — the test flushes React (`flushSync`) from a `document` listener to stand in for the
  checkpoint a real click gets.
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

One artwork in three places, plus one separate glyph. The blue squircle with a white half-open safe and three drawers (Rei, 2026-10-21) is the app icon anywhere the OS
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
