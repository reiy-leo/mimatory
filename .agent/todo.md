# Task state

Status only. The durable rules live in `AGENTS.md` (engineering) and `.agent/design.md` (design);
neither of them should be read as a to-do list, and nothing here is a constraint by itself.

Dates are absolute. `needs-owner-decision` marks an item nobody should quietly implement.

## Open

- **Native vibrancy — needs a look on a real Mac (2026-10-14).** Owner asked for it; wired as described in AGENTS.md "Native vibrancy (macOS)". Never seen in a running app yet: check the sidebar material under the traffic lights, settings sidebar, Quick Access corners, and that the material follows the system appearance in both light and dark (the in-app Light/Dark override was removed 2026-10-23).
- **HIG notes not acted on (owner layout).** `sidebars.md` › Desktop: "Avoid putting critical information or
  actions at the bottom of a sidebar" — Archive and Trash are pinned to the foot by design. `settings.md`:
  macOS settings windows use a fixed toolbar of panes; this one keeps its sidebar of panes (the System
  Settings pattern). Neither was changed.
- **needs-owner-decision — There is no recovery path for a forgotten master password.** No export, no import,
  no sync, no Keychain copy of the key, so nothing can undo it. This is not theoretical: the owner lost their
  own vault to it on 2026-10-08 and the vault was wiped. Any recovery design must keep the vault key
  unpersisted (see AGENTS.md), which is why it is a decision and not a task.
- **⌘K should become search / command palette.** It currently locks the vault; `⌘F` only focuses the list
  search. Carried over from the pre-2026-10-08 rulings.
- **Rust errors are not translated.** Every `catch` in the window code (`useVaultWindow.tsx` and its hooks) does `setError(String(nextError))`, so a
  backend failure renders as `Error: invalid master password` in zh and ja. The locale bundles themselves are
  clean. The fix is error **codes** across the bridge, not more strings — do not paper over it with
  per-message lookups in the frontend.
- **At-rest audit, remaining items** (the 2026-10-08 audit's #1 export encryption, #2 file permissions and
  #4 CSP + constant-time pairing are done): #3 attachment temp-file cleanup, #5 no rate limiting on the bridge
  or on master-password attempts, #6 default security preferences / master-password strength enforced in Rust /
  `zeroize` on lock / key rotation.
- **Cleanup of the 2026-10-09 sync/backup deletion.** The callerless `VaultService::import_login_items`,
  `set_encrypted_setting`, `get_encrypted_setting` and their helpers (`item_exists`, `primary_website`,
  `Session::key`) went, so the crate compiles warning-free. Still left behind and unreachable: the `settings`
  table (now no reader or writer at all), the `github_sync_settings` row,
  `~/Library/Application Support/app.passless.desktop/sync-history/*.snapshot`, and the Keychain item
  `app.passless.desktop` / `github_pat`.
- **Neither sidebar column's width persists across a restart**, and no real mouse drag in the Tauri window has
  ever been exercised — only the clamps, through the browser harness.

- **Opening a URL field — verify on a Mac (owner approved tauri-plugin-opener, 2026-10-15).** `FieldView`'s open
  button hands http/https/mailto/tel links to `openUrl` (`src/app/openExternal.ts`); capabilities grant
  `opener:allow-open-url` + `opener:allow-default-urls` only (no reveal-in-Finder). Not yet clicked in a real window.
- **Watchtower does not see template fields.** `has_expiring_field` / `has_totp` in `vault.rs` match top-level
  custom-field *labels* in English (`expiry`, `otp`, `2fa`), so a card or passport expiry inside a template
  section, or any zh/ja label, is invisible to it. The fix belongs in Rust (read section JSON children and their
  `key` / `field_type`), with tests; the frontend already shows "Expired" / "Expires soon" per field.
- **Template field placeholders are generic** ("Value") except card number, email, URL and month/year; a
  per-field example placeholder in the template data would be cheap if wanted.

- **Multiplatform (2026-10-17) — never run outside Chromium.** Windows/Linux/iOS/Android skins and the phone layout
  were checked only as Vite + Chromium screenshots with `?platform=` (work/screens/platforms/). Unverified: native
  Mica on Windows (main + settings) and Acrylic Quick Access, the Windows title bar following the in-app theme
  (`setTheme`), Segoe UI Variable / Roboto rendering, Hyprland behaviour (undecorated tiling, `passless
  --quick-access`, the refusal without `WAYLAND_DISPLAY`), any iOS/Android build (no SDKs here: `tauri ios/android
  init` was not run; CI generates the projects), `tauri-plugin-biometric` on a phone, safe areas on a notch,
  clipboard copy and its 90-second clear in WKWebView/Android WebView (a backgrounded phone may suspend the timer),
  and `cargo check` for the macOS, Windows, iOS and Android targets (only Linux was compiled).
- **Windows Hello is not implemented** (owner allowed skipping it if not small): it needs a WinRT
  `UserConsentVerifier` binding (`windows` crate) plus a decision about whether it may stand in for the master
  password the way Touch ID does. Windows and Linux offer the master password only.
- **Attachments are desktop-only.** rfd has no iOS/Android backend; `tauri-plugin-dialog` could pick files there
  (Android returns content URIs that the vault's path-based `attach_file_to_item` cannot read yet).
- **needs-owner-decision — Phone details not taken from Mindough yet**: swipe actions on list rows, bottom sheets
  for dialogs (iOS) / full-screen dialogs (Material), Android dynamic colour, an iPad split-view layout beyond the
  desktop grid it gets today.
- **Linux autostart** writes an XDG autostart entry, which Hyprland ignores unless the user runs something like
  `dex`/uwsm; `exec-once = passless` is the Hyprland way. Not changed.

- **Website icons / Sign in with… (2026-10-17) — unverified parts.** Never fetched a real site from the app:
  the network path is proven only against a local HTTP server (TLS, real redirects, proxies, rustls on Android,
  WKWebView rendering of the data URLs and the packaged CSP `img-src data:` are unseen). `cargo test` of the whole
  crate was not run here (scratch crate with crypto/storage/vault/favicon/bridge: 68 tests green; full crate
  `cargo check --tests` on Linux only). The extension's provider-button highlight was never run in a browser.
- **needs-owner-decision — Sign in with: one per item.** 1Password allows several sign-in methods on one login;
  this allows one provider + one account. Also: auto-click the provider button in the extension (deliberately
  not done), and whether the Quick Access row of a sign-in item should do something other than copy an empty
  password.
- **Owner decision (2026-10-18): website icons are looked up through Google first.** `favicon.rs` asks
  `t1.gstatic.com/faviconV2` (128px, `fallback_opts` so a miss is a 404, never the globe), then the site itself
  (icon links, web manifest, `/favicon.ico`) when Google has nothing or less than 128px; the largest wins and is
  stored at its own size (≤192px). **Privacy tradeoff accepted by the owner:** Google learns every host the user
  has an item for (the old rule "no third-party favicon service, ever" is retired). No separate setting was added —
  the existing "Download website icons" switch turns off every lookup, Google's included, and its description now
  says so. needs-owner-decision: a "site only, no Google" option if wanted. Schema 5 dropped the old 64px cache
  once. Live-checked from the Linux sandbox (scratch crate, native-tls): github.com 144px via manifest (its 570KB
  homepage used to exceed the HTML cap and be dropped — pages are now cut instead), slack.com 192, account.apple.com
  180, figma/notion/openrouter 128 from Google, unknown host → miss. Unseen: macOS/Windows/Android TLS stacks,
  WKWebView rendering, a proxy.
- **Attachments (2026-10-18).** A stored `.txt` opens a read-only preview sheet (`read_attachment_text`, decrypted
  in memory, lossy UTF-8, 256KB cut); other types keep Export. A stored attachment row has no replace button, only
  remove. Unseen in a real window; a new item's draft attachment (still a local path) has no preview until saved.
  Follow-up worth asking: the view row's value shows the attachment id (`att-…`) under the file name — pre-existing;
  1Password shows the size there.
- **needs-owner-decision — Website icons through a proxy.** The system proxy is honoured; the SSRF check runs on
  this side before the proxy connects, so a host whose DNS differs at the proxy is not caught. The alternative
  (`no_proxy`) leaves users behind a proxy without icons.
- **Website icon cache is never pruned** for sites no item names any more (rows are tiny and unreadable; only
  the setting's off switch clears it).

- **Field actions (2026-10-17) — unverified and remaining.** Checked only in Vite + Chromium against the stub
  (work/screens/fields/: macOS light+dark, Windows, Android). Never seen: Open & Fill end-to-end (the opener plugin
  with a fragment URL, the extension stripping `#passless-fill` and filling — content.js was never run in a browser),
  ⌘R/⌘C in WKWebView (⌘R must not reach a reload), long press in a real Android/iOS WebView (and whether the
  WebView's own text-selection/context gesture fights it), `mailto:`/`tel:` from the menu, the 90-second clear in
  Quick Access's hidden window. Not done, 1Password has them: password history (needs storage), hold Option to
  reveal (needs a setting), the generator as a popover beside the field, changing a field's type after adding it,
  Markdown in notes, SSH private key export, date expiry alerts. (Drag-to-reorder and the per-website autofill
  behaviour landed 2026-10-17, see below.)
- **needs-owner-decision — field actions.** (1) 1Password clears *every* copied value after 90 s; Passless clears
  secrets only (kept). (2) Quick Access ↵ copies the password; in 1Password ↵ is Open & Fill (kept). (3) The view's
  always-visible eye was removed in favour of the menu + ⌘R, as 1Password does — restore it if a one-click reveal is
  wanted. (4) A URL field inside a section opens on click (1Password's docs only say "copy or open").

- **Unified field rows, websites + autofill behaviour, OTP edit row, whole-cell focus ring (2026-10-17) —
  unverified.** Checked in Vite + Chromium against the stub (work/screens/websites/: macOS light+dark, Windows,
  Android; checks.txt holds the scripted assertions — keyboard and pointer reorder, cross-section drag, popover
  sentences, save payload). Never seen: pointer/touch drag in WKWebView, Android WebView and a real touch screen
  (`touch-action: none` on the handle, pointer capture), the QR file picker offering the camera on a phone, Alt+↑/↓
  on macOS (Option may type a character in some layouts before the handler sees it), the `color-mix()` ring in
  WKWebView (Safari ≥ 16.2 has it), `describe_website` over the real bridge (only `site_match` unit tests), the
  extension sending `location.origin` (never run in a browser), and the zh/ja autofill strings against 1Password's
  own localisation (zh follows the wording in the owner's brief; ja is ours). Full-crate `cargo check --tests` ran on
  Linux only.
- **needs-owner-decision — autofill behaviour.** (1) "Never fill on this website" *ignores* that address, as
  1Password documents — another address of the same item set to "anywhere" still fills there (1Password calls this
  a known limitation; a veto rule would be one line in `list_login_items_for_origin`). (2) The related-domain list
  is a deliberately small bundled subset (apple.com/icloud.com, google.com/youtube.com, the Microsoft account
  domains) — the editor says "and some related websites" only for those; widen it or drop it. (3) A save from the
  extension now keeps an existing item's websites and their behaviours instead of replacing them with the page URL.
  (4) Builds older than 2026-10-17 read `never` as `domain` and write that back if they save the item.
- **needs-owner-decision — field rows.** (1) Fixed labels (Username, Password, template fields, view labels) wear
  the link tint; renamable labels read in the secondary label colour, as Rei's screenshots show (op-focus-ring vs
  op-otp) — say if every label should tint. (2) Values went from body (13pt) to title-3 (15pt) in both modes to
  match the screenshots' proportions. (3) The OTP edit row masks the key at rest and shows it grouped while focused
  (the AGENTS.md masking rule); 1Password shows it plainly. (4) Template fields keep no remove button and do not
  leave their section (the template finds them by key there); built-in username/password have no handle (they are
  columns, not list entries). (5) The view's old two-factor card (reveal / copy key / copy setup link buttons and the
  warning) became a row in the credentials card; Copy Secret Key and Copy Setup Link moved into its menu.
- **Edit-page polish + passkeys (2026-10-18) — unverified parts.** Checked in Vite + Chromium against the stub
  (macOS/Windows/Android skins, light/dark; Add More menus at 1280×1300, 800×600, 960×500) and the extension prompt
  in a stubbed page. Never seen: the handle hanging in the pane padding inside the real WebKit/WebView2 windows
  (scroller `margin-inline` bleed), touch drag on a phone, and the extension end to end — the MAIN-world
  `passkey-observer.js` (needs Chrome ≥ 111 / Firefox ≥ 128 for `"world": "MAIN"`) against a real site's
  `navigator.credentials.create`, the closed-shadow prompt on sites with strict CSP, and `/passkey-event` with
  `item_id` / `new_item` through the live bridge. The extension no longer reports passkey *sign-ins* (`get`):
  they used to write silently; nothing is written without the prompt now.
- **needs-owner-decision — Passless as a real passkey provider: store private keys, answer
  `navigator.credentials.get`.** Today Passless records passkey *metadata* only (relying party + account handle on
  a login); the private key stays with the browser's or the device's authenticator, and Passless cannot sign in
  with it. Becoming a provider means generating and storing keys in the vault, answering `create`/`get` for the
  page (extension-side WebAuthn emulation or the OS credential-provider APIs: macOS/iOS AuthenticationServices
  extension, Android Credential Manager, Windows plugin authenticators), attestation choices and sync semantics —
  a large, security-critical feature. Not started.
- **needs-owner-decision — edit-page polish.** (1) The section's Add More is now the same bar as the item's, so a
  section card is followed by its own full-width "Add More" bar (two bars stack under the last section). (2) A
  section's menu also leaves out Attach File and Passkey (a section's JSON children cannot hold an attachment;
  passkeys are never added by hand) besides the six named. (3) The credential card's order is fixed for the
  sign-in method too: Username, Password, Sign in with…, Passkeys, One-time passwords — none has a handle.
  (4) The item pane's side padding went from 20 to 28pt (24pt phones) on every skin, view mode included, so the
  handle fits beside the cards.

## Never yet seen in a running app

- Item relations (2026-10-15): the parent / child / related sections, the picker sheet and the disabled Delete
  and Move rows. Checked in Vite + Chromium against a stubbed bridge (light and dark) and the Rust side by
  `cargo test` of vault/storage/crypto; never in a real window.
- Password generator popover (2026-10-18): placement, focus trap, Escape and the switches were seen only in Vite +
  Chromium screenshots (work/screens/generator/) and jsdom tests; never in WKWebView/WebView2/Android WebView.
  The native `<select>` pop-up and the range slider will look different in each real webview.
- Colour item-type art (2026-10-18) is in the New Item picker only. Using it as the list / item-header fallback
  (non-login items, or a login with no site icon) was left out: it changes the selected-row tile rule (white tint on
  the accent) and the letter tiles everywhere — an owner call. Seen only in Chromium screenshots (work/screens/type-picker/).
- Edit-header icon badge (2026-10-18) offers only what exists: Use Website Icon / Don't Use Website Icon (the
  stored `icon_mode`, applied at once like the item menu's rows) and Refresh Icon; it is hidden for items with no
  website and while composing. A custom image or a per-item choice of type icon would need a new stored field —
  not built. Seen only in Chromium screenshots.

Everything in this list is written and unit-proven or not proven at all; none of it has been observed.

- Tray menu, `⌘⇧Space` Quick Access, autostart via the LaunchAgent, single-instance refocus.
- The Dock/Finder bundle icon and the menu-bar template *in place*. `icon.icns` was regenerated and
  round-tripped through `sips` (1024px out, transparent corners confirmed) and the tray template was
  composited at 18pt on light and dark, but seeing them needs `npm run tauri build` — a minutes-long all-core
  release build on this machine.
- The CSP in a packaged build (`tauri dev` runs with no CSP at all), and the browser extension popup loaded in
  a browser.
- The settings window as real `NSWindow`s on a real second display. Only the *payload* has been proven through
  the browser stub.
- Every hover/pressed/disabled state; TOTP; attachments.
- The typed item fields (2026-10-14): `-webkit-text-security` on the concealed textarea, `<input type="date">`
  and the pop-up selects in WKWebView, the clipboard copy buttons, and the URL open button. Checked only in
  Vite + Chromium against a stubbed bridge, light and dark.
- The Apple restyle (2026-10-14) in a real `tauri dev` window: SF Pro rendering, the overlay traffic lights
  against the translucent sidebar, `backdrop-filter` in WKWebView, and `prefers-reduced-transparency` /
  increased contrast. It was checked only as Vite + Chromium screenshots against a stubbed bridge, in light
  and dark. In that harness the header ellipsis (`vault.itemActions`) opened no menu — the window `click`
  listener added by the opening render appears to dismiss it in the same event; the row right-click menu
  opened fine. Not investigated; check it in the real window before assuming either way.

## Completed

Closed work, kept so nobody re-derives it. How each of these behaves today is described in `AGENTS.md`
(constraints) and `.agent/design.md` (design), not here.

| Date | Landed | Where it is described |
|---|---|---|
| 2026-10-23 | Theme follows the system only (owner decision 2026-10-23: drop the override, System only; closes the needs-owner-decision item). Settings ▸ Appearance lost its Light/Dark/System control; a stored `passless-theme` is deleted on launch so existing installs return to System | `.agent/design.md` Appearance follows the system |
| 2026-10-23 | Item list virtualized with `@tanstack/react-virtual` (rows near the viewport only; screenshots pixel-identical to the full list on macOS light/dark, Windows, iOS, Android at top, mid-scroll and bottom) | `AGENTS.md` The item list is virtualized |
| 2026-10-23 | `App.tsx` (~6000 lines) split into the three windows, `useVaultWindow` + focused hooks, and one component per pane / menu / dialog; behaviour unchanged (262 tests) | `AGENTS.md` Architecture |
| 2026-10-23 | Item list returns summaries only (`LoginItemSummary`); the selected item is decrypted on demand by `get_login_item`, Quick Access reads secrets at copy time | `AGENTS.md` The list carries summaries |
| 2026-10-17 | One field row for every field in view and edit (fieldRows.tsx: drag handle outside the card, label above value, trailing type buttons + red remove, whole-cell focus ring; sections as cards with their own "add more"; drag and Alt+↑/↓ reorder within and across sections), websites with label + autofill behaviour (anywhere / exact host / never) enforced in Rust with the Public Suffix List, OTP edit row (grouped key, QR scan) and view row ("214 • 685" + countdown) | `AGENTS.md` Websites and autofill behaviour, Field rows; `design.md` exceptions |
| 2026-10-17 | 1Password-style field actions: row = primary action, per-type menu / phone action sheet, Show in Large Type, Open & Fill via the extension, item and Quick Access copy shortcuts, ⌘R, one clipboard helper (OTP and Quick Access copies now cleared) | `AGENTS.md` Field actions; `design.md` exceptions |
| 2026-10-17 | Website icons fetched from the site itself and cached encrypted (schema 4), Sign in with… (provider field + `sign_in` link, picker, row, reverse list, extension hint) | `AGENTS.md` Website icons, Sign in with… |
| 2026-10-17 | Multiplatform: Apple / WinUI 3 / Material 3 skins and a phone layout (Mindough's mapping), platform feature gating, per-platform Tauri configs, desktop-only shell crates, Wayland-only Linux (tauri without `x11`, `WAYLAND_DISPLAY` required), biometrics via tauri-plugin-biometric on phones, CI (`ci.yml`, `build.yml`, `ios.yml`) | `AGENTS.md` Platforms; `design.md` Per-platform skins |
| 2026-10-17 | Item relations design approved by the owner as built ("这种是完全正确的"): Delete/Move refused while an item has any link (parent included); Move refused rather than carrying links across vaults; wording 上级项 / 子项 / 关联项 (en Parent Item / Child Items / Related Items, ja 親項目 / 子項目 / 関連項目); no child-count badge on list rows; `relations_ciphertext` NULL-vs-ciphertext presence signal accepted | `AGENTS.md` item relations |
| 2026-10-14 | UI restyled to Apple design (macOS HIG): semantic system colours with real light **and** dark values (closes the "dark palette is owed" item), SF type scale, macOS radii/materials/focus ring, System appearance by default; Atlassian `DESIGN.md` and `.write-technical-spec/` deleted | `.agent/design.md` |
| 2026-10-10 | Documentation split: engineering rules stay here in `AGENTS.md`, design constraints moved to `.agent/design.md`, all task state to this file | The three files |
| 2026-10-10 | The vendored macOS HIG extract at `.agent/DESIGN.md` was deleted (superseded 2026-10-14 by the `apple-design` skill) | `.agent/design.md` header |
| 2026-10-10 | Gate tiers by diff type; vitest moved off jsdom and fork-capped, so a style edit no longer pays for a full toolchain pass | `AGENTS.md` Commands |
| 2026-10-10 | Sidebar gutter paints nothing at rest/hover/drag; sidebar gets its own resizable gutter, clamped 150–220 | `design.md` exceptions; `AGENTS.md` sidebar |
| 2026-10-10 | A folded sidebar section stays at one row at the top (`content-start`) | `AGENTS.md` sidebar |
| 2026-10-10 | One unlock ring on the lock field, brand stacked above it | `design.md` focus ring |
| 2026-10-10 | Settings window placed against `main`, never screen-centred | `AGENTS.md` second window |
| 2026-10-10 | Highlighted tag/category rows survive their section's fold; keys in localStorage | `AGENTS.md` sidebar highlights |
| 2026-10-10 | Item actions behind one header ellipsis **and** a row right-click; move/duplicate in Rust | `AGENTS.md` item actions, moving and duplicating |
| 2026-10-10 | New item asks its type from one `categoryItems` table | `AGENTS.md` new item |
| 2026-10-10 | Vault rows in the sidebar: switch, edit styling, archive (cascading), dissolve (with destination) | `AGENTS.md` vault rows |
| 2026-10-10 | Brand icon settled: one artwork in lock screen + sidebar + bundle, separate tray template glyph | `AGENTS.md` brand icon |
| 2026-10-09 | Tag filtering as a sidebar section, tag chips in the item form, tag rename/delete, `tags.icon` + `tags.color` | `AGENTS.md` tags |
| 2026-10-09 | Archive and Trash views at the foot of the sidebar, with live counts and restore | `AGENTS.md` soft delete |
| 2026-10-09 | Create-vault panel in the sidebar brand `+` | `AGENTS.md` native dialogs |
| 2026-10-09 | i18n completeness gate: named keys defined, no `defaultValue` fallback, runtime-built prefixes covered | `AGENTS.md` Workflow |
| 2026-10-09 | All three UI string bundles complete; `App.tsx` carries zero `defaultValue` fallbacks | `AGENTS.md` Workflow |
| 2026-10-09 | Sync, backup and import deleted (see "Decided against" below) | `AGENTS.md` no transport |
| 2026-10-08 | Atlassian `DESIGN.md` installed as the contract; Cupertino spec deleted (both superseded 2026-10-14) | `design.md` header |
| 2026-10-08 | Audit #1 export encryption, #2 file permissions (0600/0700, self-repairing), #4 CSP + constant-time pairing | `AGENTS.md` CSP, file permissions, bridge |

## Decided against (not pending — do not re-propose)

- **No sync of any kind.** The 2026-10-08 ruling dropped the iCloud Drive / Google Drive transport in favour of
  GitHub sync plus local snapshots; the owner deleted that too on 2026-10-09. The vault is local-only.
- ~~No import.~~ Reversed by the owner 2026-10-21: File ▸ Import ▸ 1Password (.1pux)… is back (macOS menu bar,
  `src-tauri/src/import_1pux.rs`). The Passless backup reader stays deleted.

## Passkeys — Passless as the authenticator (2026-10-18)
- Done: extension takes over navigator.credentials.create/get (passkey-provider.js, MAIN world); keys are ES256, "none" attestation, private key PKCS#8 in an encrypted `passkey_credential` field, signing in Rust (passkey.rs); conditional mediation shows passkeys in the inline field menu; "Use Another Device" falls back to the browser's own WebAuthn. Bridge calls now go through background.js (CORS / Private Network Access).
- needs-owner-decision: AAGUID is all-zero (RPs show a generic name); sign counter fixed at 0; UV flag claimed because the vault is unlocked (no extra Touch ID per sign-in); passkeys are not exportable yet; no macOS system-wide credential provider (needs Swift extension + Apple signing).

## 1Password import (.1pux) — 2026-10-21
- Done: macOS menu bar File ▸ Import ▸ 1Password (.1pux)… (shell.rs builds Tauri's default menu + Import; event `menu:import-1pux`), picker → read-only preview sheet (vaults, item/attachment counts) → import. Each 1Password vault goes to the non-archived Passless vault of the same name, else a new one. Category → Passless type (unknown → Secure Note); template fields stored with template `key`; other fields as custom fields / titled sections; OTP → otp rows (otpauth secret only); attachments + Document files imported; archived stays archived; trash skipped; created/updated times kept.
- needs-owner-decision: Windows/Linux have no menu bar, so no entry point there yet; re-importing duplicates items (no dedupe); password history, `reference` (linked item) fields and extra login form fields are dropped; otpauth digits/period/algorithm are dropped; 1P field-id → template-key table is from the published 1pux schema, unverified against a real export.
