# Task state

Status only. The durable rules live in `AGENTS.md` (engineering) and `.agent/design.md` (design);
neither of them should be read as a to-do list, and nothing here is a constraint by itself.

Dates are absolute. `needs-owner-decision` marks an item nobody should quietly implement.

## Open

- **needs-owner-decision — Keep or drop the in-app appearance override.** Settings ▸ Appearance now defaults
  to System (follows macOS), with Light and Dark still offered. `dark-mode.md` › Best practices says "Avoid
  offering an app-specific appearance setting", so the HIG answer is to delete the Light/Dark segments; that
  removes a feature, so it is the owner's call. Existing installs keep whatever `passless-theme` value the old
  build wrote on first launch (it always persisted the resolved light/dark), so they will not see System until
  they pick it once — a migration to `system` is also the owner's call.
- **Native vibrancy — needs a look on a real Mac (2026-10-14).** Owner asked for it; wired as described in AGENTS.md "Native vibrancy (macOS)". Never seen in a running app yet: check the sidebar material under the traffic lights, settings sidebar, Quick Access corners, and that the Light/Dark override (kept for testing, owner 2026-10-14) still matches the material.
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
- **Rust errors are not translated.** Every `catch` in `App.tsx` does `setError(String(nextError))`, so a
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

## Never yet seen in a running app

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
- **No import.** The 1Password importer (`import_1pux.rs`) went on 2026-10-08 and the encrypted Passless backup
  reader (`json_transfer.rs`) on 2026-10-09, along with both settings tabs. The open question about `.1pux`
  collections flattening to a list died with the feature.
