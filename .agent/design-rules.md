# Design rules and constraints

This is the project's own design contract: what a UI change in this repo must obey, how the token layers
work, and where the project deliberately deviates from the vendored spec. Build code from here plus the two
vendored documents below — never by inventing a value in a component rule.

`DESIGN.md` is **not** this file. The three documents are:

| File | What it is | Editable? |
|---|---|---|
| `DESIGN.md` (repo root) | The Atlassian design contract, revision 0.0.7, `theme: light`. Installed verbatim 2026-10-08. The UI source of truth. | **No.** Record a project deviation here in this file, not in it. |
| `.agent/DESIGN.md` | A verbatim extract of Apple's macOS Human Interface Guidelines: traffic lights, window chrome, keyboard focus, drag regions. | **No.** Platform guidance, consulted alongside `DESIGN.md`. Never a source of tokens or hex values. |
| `.agent/design-rules.md` | This file: binding rules, token layers, deviations, documented exceptions. | Yes — this is where a deviation or a new token rule lands. |

It is named `design-rules.md` rather than `design.md` because this volume is case-insensitive
(`core.ignorecase = true`): a second file called `.agent/design.md` *is* `.agent/DESIGN.md` and would
overwrite the vendored HIG extract.

The old "Cupertino Vault" spec and the `docs/superpowers/` task-page spec were deleted on 2026-10-08 along
with their 9 owner rulings. `.write-technical-spec/2026_10_08_cupertino_vault_ui_000/` is the dated work
record of that restyle; it names the deleted spec as its source of truth and survives only as history — read
it for *why* something is shaped the way it is, never for what to build.

## Binding rules

The codebase has broken each of these at least once, so they are stated as rules, not suggestions.

- **Sentence case everywhere.** Title Case, ALL CAPS and letter-spaced caps are banned, including component
  names in prose. Initialisms and proper nouns keep their caps (`SSH key`, `API credential`, `Wi-Fi`,
  `Touch ID`, `Watchtower`, `GitHub`).
- **Spacing is the 8px scale.** Use the `space-*` steps (`p-075` = 6px, `p-200` = 16px, `p-400` = 32px).
  Tailwind's own `1..96` steps land on the same grid (`p-4` = `p-200`), so `mt-7` / `gap-3.5` are off-scale.
- **Radius is chosen by component class**, from the t-shirt scale (`rounded-medium` for buttons and inputs,
  `rounded-large` for cards), not by taste.
- **Three shadow recipes only** (`shadow-raised`, `shadow-overlay`, `shadow-overflow`). Cards sitting on the
  default plane use borders, not shadows. Never hand-write a `box-shadow`.
- **Focus ring is 2px `border-focused` offset 2px**, ring radius = component radius + 2px. `outline-none` is
  allowed only where this ring is applied in the same rule — or on the inner field of a composite control
  whose *wrapper* carries the `:focus-within` ring, which is what `.compact-password-control` does, because
  the base `input:focus-visible` ring otherwise paints a third border inside the control. Say it as the
  `outline-none` **utility**, never `outline: none` — the guard sweeps every literal `outline: …;` in the
  stylesheet and demands both focus tokens in it.
- **Semantic roles, not accent ramps**, for brand/danger/warning/success/information/discovery. The 10
  accent hues are decoration only (item-type icons, tags) and never stand in for a status.
- **Prose body text uses `text`, not `text-subtle`.** `text-subtle` / `text-subtlest` are for captions,
  metadata and helper text only.
- **No emoji or unicode glyphs as icons.** Use `lucide-react`. `rem` for type, logical CSS properties for
  spacing. One `<h1>` per window, a visible label on every field.

## Token layers

There are already three alias layers in `src/styles.css` `:root`. Do not add a fourth.

1. **`--color-*`** — the only place a design value is written as a hex.
2. **`--theme-*`** — 8 semantic aliases.
3. **`--passless-*`** — 16 aliases read by ~50 component rules.

- `tailwind.config.js` `theme.extend` declares the token **names** and maps each to `var(--color-<name>)`;
  the **values** live only in `src/styles.css` `:root`. Add a colour by adding to both, never by hardcoding a
  hex in a component rule.
- Colour keys are flat (`text`, `text-subtle`, `surface`, `background-brand-bold`, `border-input`), so
  utilities read `text-text-subtle` / `bg-background-brand-bold` — the key already contains the role the
  utility supplies.
- A new `--measure-*` goes in the same `:root` group and gets a `maxWidth` / `minWidth` /
  `gridTemplateColumns` key like the rest.
- A new alias must be **derived from** `--color-*`. The only literal ever assigned to an alias is the
  dark-mode override `--passless-sidebar-bg: #171d26`, which has no token equivalent.
- `tailwind.config.js` is **not** hot-reloaded: add a key and the running dev server keeps compiling against
  the old config, so the first `@apply` of it fails with "class does not exist" behind Vite's error overlay
  until `npm run dev` restarts.

### Geometry that is not a spacing step

It lives in the same `:root` as `--measure-*` (window minimum, sidebar, resizer gutter, native titlebar
strip, lock panel, content measure) and is reached through a named Tailwind key: `min-w-window`,
`min-w-item-list`, `max-w-content`, `max-w-lock-panel`, `max-w-settings`, `max-w-detail-header`,
`grid-cols-settings`, `grid-rows-titlebar`, `pt-titlebar`, `w-popup`.

Never write `w-[244px]` — an arbitrary bracket is a number nobody chose, and the guard fails the build on a
hex/px/rem in one. The one sanctioned exception is a **composite** track list: `.app-shell`'s five-track
template (sidebar, gutter, list, gutter, detail) reads the vars directly
(`var(--sidebar-width, var(--measure-sidebar)) var(--measure-resizer) var(--item-list-width, …) …`) because
no single utility can express it.

### Dark mode

Tailwind `darkMode: ["selector", '[data-theme="dark"]']`, set on `document.documentElement.dataset.theme`.
Dark values are `--color-*` overrides in `:root[data-theme="dark"]`. It renders, but the palette is not
designed — see the open item in `.agent/todo.md`.

### Extension CSS is a second document

`browser-extension/popup.tailwind.css` duplicates the `:root` subset it needs and is compiled by
`npm run build:extension-css` into `browser-extension/popup.css` (generated, never edited, and excluded from
Biome). The popup cannot read `src/styles.css`, so **the two `:root` blocks must stay in sync**. The shared
`tailwind.config.js` already covers the names; only the values are duplicated.

## Editing `src/styles.css`

- **It has two `@layer components` blocks.** The later one wins, but the earlier one is *not* dead — many
  selectors exist only there. Edit the later copy when a rule appears in both.
- **Re-pointing a `background` there means `background-color`.** The shorthand resets
  `background-image`/`-repeat`/`-position`, and `@layer base` hangs the `select` chevron off exactly those, so
  a "just change the colour" edit tiles the chevron across the whole control.
- A rule that only needs a token change should read an alias (`--theme-*` / `--passless-*`), not a `--color-*`.

## The contract is tested, not just documented

`src/app/designContract.test.ts` reads `src/styles.css`, `src/App.tsx`,
`browser-extension/popup.tailwind.css` and `popup.html` and fails the suite on: a hex in a component rule, a
Tailwind default palette class, an arbitrary `px`/`rem` bracket (including inside `calc()`; offsets there
must read `var(--space-*)`), a self-hosted `@font-face`, or a focus ring that isn't `--border-width-focused`
with a `--space-025` offset. Sentence case is only checked in the slots that can carry styling (`@apply`,
`className`, `class`), because `uppercase` is also a legitimate password-generator option string.

Run it alone with `npm run test:design` — it is the gate a style change actually needs.

## Deviations from `DESIGN.md` (deliberate — do not "fix" without the owner)

| Area | Contract says | This project does | Why |
|------|---------------|-------------------|-----|
| Fonts | "Atlassian Sans"/"Atlassian Mono" with a system fallback | System stack only: `system-ui, -apple-system, BlinkMacSystemFont` and `ui-monospace, SFMono-Regular, Menlo` | The Atlassian faces are proprietary and no webfont is shipped. The self-hosted `JetBrainsMonoNL-SemiBold.ttf` was deleted, which also cleared its unmet SIL OFL obligation. |
| Theme | `theme: light`; the package ships no dark token table | Light is the contract; `:root[data-theme="dark"]` re-points the tokens onto the hexes the app shipped before dark mode existed | **needs-design-decision** — a real dark palette is still owed and must come from the owner, not be invented here. |
| Primary | Brand blue `#1868DB`, not user-configurable | Adopted: `--color-background-brand-bold`. The 22-colour accent picker was deleted (`theme.ts` now only switches light/dark). | Settled by the owner on 2026-10-08. |
| Window chrome | Not addressed | Native macOS traffic lights (`titleBarStyle: "Overlay"`) + `data-tauri-drag-region` | Carried over from the previous rulings; native chrome was explicitly required. |
| Responsive | Fluid down to a single-pane layout | `minWidth: 960` in `tauri.conf.json`, and `styles.css` has no `@media` rules | Carried over from the previous `<820px`/`<560px` ruling; desktop-first for now. If the window ever becomes resizable below 960 this must be revisited. |
| Extension CSS | One token source | `popup.tailwind.css` duplicates the `:root` subset it needs | The popup is a separate document. See "Extension CSS is a second document" above. |

## Documented exceptions (checked in, not drift)

- `max-w-[45%]` on the Quick Access row's secondary line: a percentage of the row, so a long subtitle
  truncates while the title keeps its share. Not a scale step and not portable to another component.
- Structural bracket utilities — `grid-cols-[minmax(0,1fr)_auto]`, `grid-rows-[auto_auto_1fr]`,
  `transition-[background-color,color]` — carry no chosen measurement, so they stay inline.
- `.uppercase{text-transform:uppercase}` appears in the **compiled** CSS and nowhere in the source. Tailwind
  generates it because `uppercase` is a password-generator option string in a scanned file. Dead, harmless,
  do not "fix" it by renaming the option.
- Tag rows and category rows are the **same** row: bare `.nav-item`s at one left edge with `text-body` /
  `font-medium` / `min-h-400`, and the tag container carries the same `gap-050` as `.nav-list`. The
  smaller-font, indented `.nav-item.tag-item` variant was removed on 2026-10-10 because the two sections
  stack and a different rhythm reads as a mistake — do not re-add a per-section type or indent override.
- **`.sidebar-scroll` carries `content-start`, and that is not decoration**: a grid's default
  `align-content: normal` behaves as `stretch`, so without it a folded sidebar spreads its three single
  section titles down the whole column instead of stacking them at the top (measured: 172 / 132 / 132 / 132 →
  68 / 28 / 28 / 28).
- A resize gutter is a **hit area, not a divider**: `.column-resize-handle` paints nothing at rest, on hover,
  or while dragged (its solid `--color-border-selected` fill and its centred `linear-gradient` hairline were
  deleted on 2026-10-10 — the bar read as a third vertical line at a boundary that already had one).
  `cursor-col-resize` plus the base layer's `button:focus-visible` ring are the whole affordance. Each column
  owns its own edge instead: `.sidebar` and `.item-list` carry `border-r`, and `.detail-pane` deliberately
  has **no** `border-l`, because a left border there would draw a second hairline six pixels away, on the far
  side of the gutter.
