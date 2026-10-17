# Design rules and constraints

On the Mac, Passless looks and behaves like a Mac app: the design system there is **Apple's Human Interface
Guidelines for macOS**, and most of this file is the project's binding translation of them into tokens and
component rules. Since 2026-10-17 the other platforms wear their own skins (WinUI 3 on Windows, Material 3 on
Android and Linux, Apple iOS on iPhone) — see "Per-platform skins" at the end; the macOS rules below are unchanged. Build
UI from here; never invent a value in a component rule.

| Source | What it is | Editable? |
|---|---|---|
| `.claude/skills/apple-design/` | The `apple-design` skill the owner installed (2026-10-14): `SKILL.md` plus 123 HIG pages pulled from developer.apple.com under `references/hig/`, and `references/cross-platform.md` for Tauri vocabulary. **The reference.** Pinned by `skills-lock.json`. | No — it is vendored. Regenerate it with its own script, never hand-edit. |
| `.agent/design.md` | This file: the tokens, the component rules, the deviations from Apple's published values and why. | Yes — a new rule or deviation lands here. |

There is no other design document. The Atlassian contract (`DESIGN.md`) and the old restyle history
(`.write-technical-spec/`) were deleted on 2026-10-14 when the owner moved the UI to Apple design ("删掉其他的
design 干扰"); both are recoverable from git history and neither is a source of truth.

**How to use the reference.** Before a UI change, open the HIG pages the skill's `SKILL.md` lists for what is on
screen (always `accessibility.md`, `layout.md`, `typography.md`, `color.md`, `designing-for-macos.md`, plus
e.g. `sidebars.md`, `toolbars.md`, `lists-and-tables.md`, `buttons.md`, `text-fields.md`, `search-fields.md`,
`sheets.md`, `alerts.md`, `materials.md`, `dark-mode.md`, `settings.md`, `focus-and-selection.md`,
`toggles.md`, `segmented-controls.md`, `menus.md`). Cite the page and heading in the comment or commit when a
rule comes from it; mark anything else as judgment.

## The design in one paragraph

A quiet, native-feeling utility: a translucent source-list sidebar, a unified toolbar with a filled search
field, a content list whose selected row is filled with the accent and turns white, and a detail pane drawn as
System Settings–style inset groups on a gray ground. One accent (systemBlue) carries interaction — default
button, selection, focus ring, switches, sidebar glyphs — and the system hues are spent only on item-type and
tag glyphs. The signature element is the **selected list row**: a solid accent capsule with white title,
caption, icon tile and star, the way a focused macOS list draws it. Everything around it stays gray.

## Binding rules

- **Semantic tokens only.** Component rules read `var(--color-*)`, `var(--material-*)`, `var(--shadow-*)`,
  never a hex or `rgb()`. Values live once in `src/styles.css` `:root` (light) and `:root[data-theme="dark"]`
  (dark). Every colour has a dark value (`color.md` › Best practices: "supply light and dark variants").
- **Text contrast ≥ 4.5:1** in both appearances (`accessibility.md`, `dark-mode.md` › "no lower than 4.5:1").
  Where Apple's published value misses it, the token is adjusted and listed under Deviations.
- **Capitalization follows macOS.** English buttons, menu items, window and pane titles, section headings and
  sidebar rows use title-style capitalization (`menus.md`: "use title-style capitalization"; `buttons.md` ›
  Content); descriptions, messages, field labels, placeholders and checkbox/switch labels stay sentence-style.
  zh and ja are untouched. Initialisms and proper nouns keep their caps (`SSH Key`, `TOTP`, `Touch ID`).
- **Type is the system font at the macOS text styles** (`typography.md` › macOS built-in text styles): body
  13pt, never below the 10pt minimum. No webfont.
- **Spacing is the 4/8pt grid** (`space-*`; `p-350` = 28pt, the default control size). Tailwind's own steps
  land on the same grid; `mt-7`/`gap-3.5` are off it.
- **Controls are 28pt tall** (`accessibility.md` › "macOS 28x28 pt" default control size): push buttons, text
  fields, pop-up buttons, search field, sidebar rows. Icon buttons are 28×28.
- **Radius by component**: `rounded-medium` 6pt controls and rows, `rounded-small` 4pt menu items and segments,
  `rounded-large` 10pt inset groups, popovers and menus, `rounded-xlarge` 12pt sheets, alerts, panels and the
  lock panel, `rounded-full` capsules (the lock field, chips, switches, the type pill).
- **Shadows only from the shadow tokens**: `--shadow-control` (push-button and segment bezel),
  `--shadow-overlay` (menus, popovers, Quick Access), `--shadow-sheet` (sheets, alerts, the lock panel),
  `--shadow-track` (switch track). Content and inset groups sit on separators, never on a shadow.
- **Materials only on the functional layer** (`materials.md` › Liquid Glass: "Don't use Liquid Glass in the
  content layer"): the sidebar, the toolbar, menus/popovers, sheets and the lock panel wear
  `--material-*` + `backdrop-filter: var(--material-filter)`. The item list, the detail pane and inset groups
  are opaque. `prefers-reduced-transparency` swaps every material for its solid colour.
- **Keyboard focus ring**: 3pt (`--focus-ring-width`) in the accent (`--color-focus-ring`), offset
  `--focus-ring-offset` (0), so the outline sits on the control's edge and follows its corner radius
  (`focus-and-selection.md`). Text and search fields get the ring; list rows and sidebar rows show selection
  with a highlight instead ("use a focus ring for a text or search field, but use a highlight in a list").
  `outline-none` is allowed only where the ring is drawn in the same rule, or on the inner field of a composite
  control whose wrapper carries the `:focus-within` ring (`.compact-password-control`, `.top-search-box`).
  Never write `outline: none`.
- **Motion is brief and optional.** 150ms colour/transform transitions; `prefers-reduced-motion` collapses them.
- **Appearance follows the system by default** (`dark-mode.md` › "Avoid offering an app-specific appearance
  setting"). `theme.ts` resolves `system` from `prefers-color-scheme` and keeps following it; `light`/`dark`
  remain as overrides in Settings ▸ Appearance (see the open item in `.agent/todo.md`).
- **One colour means one thing** (`color.md`). The accent is interaction; red/orange/green/blue/purple are
  status; the system hues on tag and item-type glyphs are decoration and never stand in for a status.
- **Prose uses the label colour**; `text-subtle` (secondary label) and `text-subtlest` are for captions,
  metadata and helper text only.
- **Icons are `lucide-react`** at 16pt, matching the 13pt body weight — no emoji or unicode glyphs as icons.
  One `<h1>` per window, a visible label on every field.

## Tokens

### Colour (light / dark)

| Role (token) | Apple equivalent | Light | Dark |
|---|---|---|---|
| `text` | labelColor | `#000000d9` | `#ffffffd9` |
| `text-subtle` | secondaryLabelColor | `#00000099` | `#ffffff8c` |
| `text-subtlest` | tertiary text (caption) | `#00000094` | `#ffffff87` |
| `text-disabled` | tertiaryLabelColor | `#00000040` | `#ffffff40` |
| `text-brand`, `link` | linkColor | `#0068da` | `#419cff` |
| `accent`, `focus-ring`, `icon-brand` | controlAccentColor (systemBlue) | `#007aff` | `#0a84ff` |
| `background-brand-bold`, `background-selected-bold` | selectedContentBackgroundColor | `#0063e1` | `#0059d1` |
| `background-selected` | accent tint (sidebar selection) | `#007aff24` | `#0a84ff3d` |
| `surface` | controlBackgroundColor (item list) | `#ffffff` | `#1e1e1e` |
| `surface-sunken` | grouped-form ground (detail pane, settings) | `#f5f5f7` | `#1e1e1e` |
| `surface-raised` | inset group | `#ffffff` | `#2c2c2e` |
| `surface-overlay` | solid sheet/menu fallback | `#f6f6f6` | `#323234` |
| `window` | windowBackgroundColor | `#ececec` | `#323232` |
| `sidebar` | solid sidebar fallback | `#ebebef` | `#2a2a2d` |
| `border` | separatorColor | `#0000001a` | `#ffffff1a` |
| `border-input` | text-field bezel | `#0000002e` | `#ffffff26` |
| `background-control` | controlColor (push-button face) | `#ffffff` | `#ffffff26` |
| `background-neutral-subtle-hovered` | quaternary fill | `#0000000d` | `#ffffff14` |
| `text-danger` / `icon-danger` | systemRed (text: increased-contrast) | `#d70015` / `#ff3b30` | `#ff6961` / `#ff453a` |
| `text-warning` / `icon-warning` | systemOrange | `#c93400` / `#ff9500` | `#ffb340` / `#ff9f0a` |
| `text-success` / `icon-success` | systemGreen | `#1e7b34` / `#28cd41` | `#30db5b` / `#32d74b` |
| `text-discovery` / `icon-discovery` | systemPurple | `#8944ab` / `#af52de` | `#da8fff` / `#bf5af2` |

The tag/item-type hues (`accent-icon-*`, `accent-*`, `accent-text-*`) are the system colours (glyphs,
swatches) and their increased-contrast variants (text). Their stored names predate the palette and are vault
data, so they cannot be renamed: `lime` renders systemMint and `magenta` renders systemPink.

Measured contrast (WCAG, composited over the surface): body label 15.1:1 light / 12.3:1 dark; secondary label
5.4–5.7:1 light / 5.3–5.9:1 dark; caption (`text-subtlest`) 5.0–5.2:1 light / 4.8–5.2:1 dark; link 4.8–5.3:1
light / 4.9–5.9:1 dark; white on the selected row and the default button 5.4:1 light / 6.3:1 dark; focus ring
against the surface 4.0:1 light / 4.6:1 dark (non-text, needs 3:1).

### Type (`tailwind.config.js` `fontSize`, rem so page zoom scales it)

| Key | macOS style | Size / line | Used for |
|---|---|---|---|
| `text-large-title` | Large Title | 26 / 32 | (reserved) |
| `text-title-1` | Title 1 | 22 / 26 | the TOTP code |
| `text-title-2` | Title 2 | 17 / 22 | item title, pane title, lock app name |
| `text-title-3` | Title 3 | 15 / 20 | empty-state heading, Quick Access field |
| `text-headline` | Headline | 13 semibold / 16 | group and dialog titles, brand name |
| `text-body` | Body | 13 / 16 | everything by default |
| `text-callout` | Callout | 12 / 15 | field labels, captions, counts |
| `text-subheadline` | Subheadline | 11 / 14 | sidebar section headers |
| `text-footnote`, `text-caption` | Footnote / Caption | 10 / 13 | the 10pt floor |

Font stack: `-apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif` (SF Pro on macOS);
mono `ui-monospace, SFMono-Regular, "SF Mono", Menlo`.

### Materials, radius, focus, shadow

`--material-sidebar`, `--material-toolbar`, `--material-popover`, `--material-sheet` (translucent light and
dark values), `--material-filter: saturate(180%) blur(20px)`. Radius `xsmall` 2, `small` 4, `medium` 6,
`large` 10, `xlarge` 12, `xxlarge` 16, `full`. Focus `--focus-ring-width` 3pt, `--focus-ring-offset` 0.

## Component rules

- **Sidebar (source list)** — `sidebars.md`: sidebar material; rows 28pt, body type in the label colour,
  glyph in the accent unless the row's own hue colours it (`:where(.nav-item) > svg` keeps that at element
  specificity so a `text-accent-icon-*` class wins); selected row = rounded accent tint, label colour kept;
  section headers = subheadline semibold in `text-subtlest` and a text-only disclosure toggle. Archive and
  Trash stay at the foot (owner layout; see todo for the HIG note).
- **Toolbar** — `toolbars.md`, `search-fields.md`: toolbar material over the content columns with one
  separator; filled rounded search field with a leading magnifier and the ring on the whole field; the
  default action (New Item) is the one filled push button.
- **Item list** — `lists-and-tables.md`, `focus-and-selection.md`: rows on `surface`, title in label colour,
  caption in secondary; the selected row is `background-selected-bold` with white title, caption, star and a
  white-tinted icon tile (`--color-on-selected-fill`).
- **Detail pane** — grouped form: `surface-sunken` ground, each section a `surface-raised` inset group
  (10pt corner, separator border, rows divided by separators). In the read-only state the disabled fieldset
  drops every bezel so values read as content, not unavailable controls.
- **Push buttons** — `buttons.md` › Push buttons: `.primary-button` / `.top-new-item-button` accent-filled
  with white text; `.secondary-button` / `.top-edit-button` / `.state-row-button` bezeled
  (`background-control` + `--shadow-control`); `.danger-button` bezeled with the red label (`alerts.md`:
  destructive style marks the action, not the shape).
- **Text fields** — `text-fields.md`: white well, hairline `border-input`, 6pt corner, 28pt. **Pop-up
  buttons** (`select`) are bezeled with the up-down chevron pair (data-URI; see the `background` trap below).
- **Segmented control** — `segmented-controls.md`: `.segmented-control` / `.generator-mode-tabs`, a filled
  track with the chosen segment raised on `background-control` + `--shadow-control`.
- **Switches** — `toggles.md` › Switches: settings rows (`.security-check-row`, `.checkbox-row`) draw their
  native checkbox as a switch (capsule track, accent when on, sliding white knob), label first, control last.
  Generator options stay checkboxes (a list of options, not a setting).
- **Menus and popovers** — `menus.md`: popover material, 10pt corner, overlay shadow, 24pt rows with a 4pt
  corner; the hovered row is accent-filled with white text, glyph and caption — including a destructive row.
- **Sheets and alerts** — `sheets.md`, `alerts.md`: blanket dims the window; card = sheet material, 12pt
  corner, sheet shadow; title in headline; default button trailing, Cancel before it.
- **Lock screen** — a centred unlock panel on the window background: 64pt app icon, app name in title 2, a
  capsule password field with its reveal/Touch ID buttons inside; the setup variant is the same content on a
  sheet-material card.
- **Settings window** — `settings.md`: source-list sidebar of panes, the pane title in title 2, each group in
  an inset group, Security as label-left/control-right rows with switches and pop-up buttons, Appearance as a
  System / Light / Dark segmented control.

## Token mechanics

- `tailwind.config.js` `theme.extend` declares token **names** and maps each to `var(--color-<name>)`; values
  live only in `src/styles.css`. Add a colour by adding the light value, the dark value and (if a utility
  needs it) the Tailwind key. The guard fails a light-only colour.
- Colour keys are flat (`text-subtle`, `background-brand-bold`), so utilities read `text-text-subtle`.
- `tailwind.config.js` is **not** hot-reloaded: add a key and the running dev server keeps compiling against
  the old config until `npm run dev` restarts.
- Geometry that is not a spacing step lives in `:root` as `--measure-*` and is reached through a named
  Tailwind key (`min-w-window`, `max-w-content`, `max-w-lock-panel`, `max-w-lock-field`, `max-w-settings`,
  `grid-cols-settings`, `grid-rows-titlebar`, `pt-titlebar`, `w-popup`). Never `w-[244px]`; the one sanctioned
  composite is `.app-shell`'s five-track template, which reads the vars directly.
- **Dark mode** is `data-theme="dark"` on `<html>` (Tailwind `darkMode: ["selector", '[data-theme="dark"]']`),
  written by `applyTheme()` in `src/app/theme.ts`, which also follows `prefers-color-scheme` while the theme is
  `system`.
- **The extension popup is a second document.** `browser-extension/popup.tailwind.css` mirrors the subset of
  `:root` it needs (light, plus dark under `@media (prefers-color-scheme: dark)` — the popup follows the
  browser) and compiles via `npm run build:extension-css` into `popup.css` (generated, excluded from Biome).
  The guard checks every popup colour exists with the same value in `src/styles.css`.

## Editing `src/styles.css`

- **It has two `@layer components` blocks.** The later one wins, but the earlier one is *not* dead — many
  selectors exist only there. Edit the later copy when a rule appears in both.
- **Re-pointing a `background` on anything that can be a `select` means `background-color`.** The shorthand
  resets `background-image`/`-repeat`/`-position`, and `@layer base` hangs the pop-up chevron off exactly
  those, so a "just change the colour" edit tiles the chevron or deletes it. The base `:focus` and `:disabled`
  rules use `background-color` for that reason.
- Selection overrides that must beat later rules (the menu hover highlight, the switch) sit at the end of the
  later block on purpose.

## The rules are tested

`src/app/designContract.test.ts` (`npm run test:design`) reads the stylesheets, `App.tsx`, the popup and
`tailwind.config.js` and fails on: a hex or `rgb()` in a component rule; the default Tailwind palette; an
arbitrary `px`/`rem`/hex bracket; a webfont or a font stack that is not the system font; a focus ring not
drawn with `--focus-ring-width` + `--color-focus-ring` + `--focus-ring-offset`, or a ring colour that is not
the accent; an accent that is not systemBlue `#007aff`/`#0a84ff`; a light colour token with no dark value; a
type size under 10pt or a body that is not 13pt; a `backdrop-filter` that does not read `--material-filter`,
missing reduced-transparency/reduced-motion rules, or a material on a content pane; a `box-shadow` not read
from a shadow token; a popup colour that drifts from the app's.

## Deviations from Apple's published values (deliberate)

| Area | Apple | This project | Why |
|---|---|---|---|
| Secondary/tertiary label | black 50% / 26% (white 55% / 25%) | `text-subtle` black 60%, `text-subtlest` black 58% / white 53%; 25% kept for disabled only | Apple's secondary is 4.0:1 on white; captions must clear 4.5:1. |
| Default button and selected row fill | controlAccentColor `#007aff` | selectedContentBackgroundColor `#0063e1` / `#0059d1` | White on `#007aff` is 4.0:1 (3.7:1 dark). |
| Accent text | systemBlue | linkColor `#0068da` / `#419cff` | systemBlue text on white is 4.0:1. |
| Success text | `#248a3d` (increased-contrast green) | `#1e7b34` | 4.4:1 → 5.3:1 on white. |
| Focus ring | translucent accent halo | opaque accent, 3pt | Keeps 3:1 non-text contrast against every surface. |
| Materials | `NSVisualEffectView` behind-window vibrancy | Native in the macOS app (`data-vibrancy="native"`, see AGENTS.md); CSS `backdrop-filter` only in a browser preview | The CSS materials remain as the browser fallback and for in-page menus/sheets. |
| Window chrome | native | native traffic lights (`titleBarStyle: "Overlay"`) + `data-tauri-drag-region` | Unchanged; never self-draw the titlebar. |
| Responsive | layouts adapt to the space | `minWidth: 960` in `tauri.conf.json`, no width breakpoints | Desktop-first; revisit if the window may go below 960. |

## Documented exceptions (checked in, not drift)

- `max-w-[45%]` on the Quick Access row's secondary line: a percentage of the row, so a long subtitle
  truncates while the title keeps its share.
- Structural bracket utilities — `grid-cols-[minmax(0,1fr)_auto]`, `grid-rows-[auto_auto_1fr]`,
  `transition-[background-color,color]` — carry no chosen measurement, so they stay inline.
- `.uppercase{text-transform:uppercase}` can appear in the **compiled** CSS: Tailwind generates it because
  `uppercase` is a password-generator option string in a scanned file. Dead and harmless.
- Tag rows and category rows are the **same** row: bare `.nav-item`s at one left edge and one rhythm. Do not
  re-add a per-section type or indent override.
- **`.sidebar-scroll` carries `content-start`**: a grid's default `align-content: normal` behaves as
  `stretch`, so without it a folded sidebar spreads its section titles down the whole column.
- A resize gutter is a **hit area, not a divider**: `.column-resize-handle` paints only the colour of the
  column it opens onto (the list gutter `surface-sunken`, the sidebar gutter `surface`), so it reads as part of
  that column. `cursor-col-resize` plus the base layer's focus ring are the whole affordance. `.sidebar` and
  `.item-list` carry `border-r`; `.detail-pane` deliberately has no `border-l`.


- **Show in Large Type colours digits and symbols** (`.large-type-cell.is-digit` in `text-brand`, `.is-symbol` in
  `text-danger`): 1Password's convention, so a reader can tell `0`/`O` and `l`/`|` apart at a glance. Red here is not
  a status — an exception to "one colour means one thing", acceptable because every tile also carries its class in
  its accessible name and a legend sits under the tiles. Tile and glyph size come from `--measure-large-type-*`.
- **A read-only field row highlights on hover** (`.field-row.is-actionable:hover`, quaternary fill) because the
  whole row is a button (copy / Open & Fill); its trailing hint is link-coloured text, not a push button.

## Per-platform skins (2026-10-17)

The owner asked for every OS to get the design Mindough gives it. The mapping, detection and layout switch are in
`AGENTS.md` "Platforms"; this section is the design half. Sources: Mindough's `apps/client/src/skin/tokens.css`
and `skins.css` (the reference implementation), Microsoft's WinUI 3 / Windows 11 design tokens, Google's Material 3
baseline scheme, Apple's iOS HIG.

**Rules shared by every skin.** One set of components and class names; a skin changes token *values*
(`src/skin/tokens.css`) and shapes (`src/skin/skins.css`, `src/skin/mobile.css`), never markup. No colour literal
in a shape rule, every colour a skin sets in light also set in dark, system fonts only, Light/Dark/System stays on
every platform, `prefers-reduced-transparency`/`-motion` still apply. All guarded by `designContract.test.ts`
("platform skin rules"). The Apple desktop skin is `styles.css` alone.

### WinUI 3 / Windows 11 (Windows)

- Type: Segoe UI Variable Text, 14px body (root scaled 107.69%).
- Colour: AccentFillColorDefault `#005fb8` light / `#60cdff` dark (black text on the dark accent); text
  primary 89.6% / secondary 62%; captions use 58% instead of WinUI's 45% tertiary to clear 4.5:1.
- Material: **Mica** is the window (`--color-window` #f3f3f3 / #202020 as the browser stand-in; native Mica inside
  the app, where `data-window-material="mica"` makes the page transparent). The list and item sit on the lighter
  content layer with an 8px rounded leading corner; flyouts are Acrylic-like (`--material-popover`), Quick Access is
  native Acrylic.
- Shapes: ControlCornerRadius 4, OverlayCornerRadius 8; controls carry the elevation stroke
  (`--shadow-control`: hairline + darker bottom edge); text fields get the bottom stroke and a 2px accent underline
  when focused; focus visual is a 2px primary-text stroke.
- Navigation: NavigationView — no sidebar divider, 36px rows, the selected row a subtle fill plus the 3×16 accent
  pill; the selected list row uses the same pill (not a solid accent fill). Menus hover with a subtle fill.
  ContentDialog: 20px semibold title, command band in the window colour with equal-width buttons. ToggleSwitch:
  outlined track with a small knob off, accent with a white knob on.

### Material 3 (Android, Linux)

- Type: Roboto (falls back to Noto Sans / Cantarell on Linux), 14px desktop body, 16sp on phones.
- Colour: the M3 baseline scheme (primary `#6750a4` / `#d0bcff`, surfaces `#fef7ff`/`#f7f2fa`/`#f3edf7`, dark
  `#141218`/`#1d1b20`/`#211f26`); selection is the tonal secondary container (`#e8def8` / `#4a4458`), never a solid
  accent fill. Dynamic colour from the wallpaper is not wired.
- Material: none — tonal surfaces only (`--material-filter: none`).
- Shapes: extra-small 4 (menus, text fields), medium 12 (cards, list selection), extra-large 28 (dialogs),
  full pills for buttons, chips, the search bar and navigation rows. Elevation level 2 for menus, 3 for dialogs and
  the FAB; controls are flat.
- Navigation: navigation drawer (desktop) with pill rows; outlined text fields whose outline thickens in the
  primary colour instead of a ring; outlined secondary buttons; segmented buttons; M3 switch. Phone: top app bar
  title, navigation bar with the 64×32 pill indicator, extended FAB for New Item, arrow-back in the item pane.

### Apple iOS (iPhone)

- The macOS tokens, at 17pt body (root scaled 130.77%); large title (34pt bold) over the list; plain list with
  inset separators; translucent tab bar (icons + 10pt labels, accent when active); the item pane's navigation bar
  has a "‹ <list>" back button and Edit as a plain accent button; New Item is a bare accent "+".

### Phone layout (all skins, ≤ 760px)

One pane at a time (`.app-shell[data-mobile-pane]`: list, detail, browse, settings), a bottom tab bar
(Items / Browse / Settings), safe areas from `viewport-fit=cover`, no persistent row highlight (a tap opens the item),
Settings panes as a scrolling chip row. Known gaps: list rows have no swipe actions; dialogs are centred cards rather
than bottom sheets; the item pane's Edit/Save live in the top bar on every skin.
