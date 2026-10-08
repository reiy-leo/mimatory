---
name: Cupertino Vault
colors:
  surface: '#faf9fe'
  surface-dim: '#dad9df'
  surface-bright: '#faf9fe'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f8'
  surface-container: '#eeedf3'
  surface-container-high: '#e9e7ed'
  surface-container-highest: '#e3e2e7'
  on-surface: '#1a1b1f'
  on-surface-variant: '#414754'
  inverse-surface: '#2f3034'
  inverse-on-surface: '#f1f0f5'
  outline: '#727785'
  outline-variant: '#c1c6d6'
  surface-tint: '#005bc0'
  primary: '#005abe'
  on-primary: '#ffffff'
  primary-container: '#0572ec'
  on-primary-container: '#ffffff'
  inverse-primary: '#adc7ff'
  secondary: '#006e26'
  on-secondary: '#ffffff'
  secondary-container: '#64fd7d'
  on-secondary-container: '#007328'
  tertiary: '#875100'
  on-tertiary: '#ffffff'
  tertiary-container: '#a96700'
  on-tertiary-container: '#ffffff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc7ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#6cff82'
  secondary-fixed-dim: '#47e266'
  on-secondary-fixed: '#002106'
  on-secondary-fixed-variant: '#00531a'
  tertiary-fixed: '#ffddbb'
  tertiary-fixed-dim: '#ffb868'
  on-tertiary-fixed: '#2b1700'
  on-tertiary-fixed-variant: '#673d00'
  background: '#faf9fe'
  on-background: '#1a1b1f'
  surface-variant: '#e3e2e7'
  system-blue: '#0071E3'
  vault-vibrant-blue: '#0572EC'
  security-green: '#34C759'
  warning-amber: '#FF9500'
  critical-red: '#FF3B30'
  secure-mask-dot: '#48484A'
  sidebar-light-tint: rgba(246, 246, 246, 0.75)
  sidebar-dark-tint: rgba(30, 30, 30, 0.75)
  divider-light: '#E5E5EA'
  divider-dark: '#2C2C2E'
  card-bg-light: '#FFFFFF'
  card-bg-dark: '#1C1C1E'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.022em
  headline-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.018em
  headline-md:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.012em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.008em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: -0.005em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.0em
  label-md:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.03em
  mono-secret:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.08em
  mono-totp:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: 0.15em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-sidebar: 0.75rem
  margin: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

> **Provenance.** Copied verbatim from the Stitch export
> `stitch_1password_web_clone/cupertino_vault/DESIGN.md` (2026-10-07). It is the design
> *source*, not the current build. Where it and the implementation disagree, the rulings in
> `AGENTS.md` → "Design conformance" win; open gaps are listed there too. Two claims in this
> file are already superseded: the interface font is `-apple-system`, not `Inter`, and there is
> no configurable accent colour.

## Brand & Style

This design system embodies the confluence of Apple Human Interface Guidelines and robust biometric security. Designed specifically for native macOS environments, the aesthetic balances uncompromising cryptographic trust with fluid, tactile interaction design.

The design language leans into **Glassmorphism & Modern macOS Native Systems**:
- Materials reflect macOS native vibrancies with real-time backdrop blur filters (`NSVisualEffectView` aesthetic), multi-stop linear surface reflections, and deep specular edge highlights.
- Visual weight prioritizes instant hierarchy: window chrome recedes via ambient translucency, elevating actionable security objects, credential credentials, and critical cryptographic indicators.
- Precision micro-interactions evoke physical security vaults engineered with modern consumer poise: soft inner keylines, crisp 0.5px retina borders, and refined typographic scaling.

## Colors

The color palette unites Apple system vibrancy with high-trust security cues.

- **Primary (`#0572EC`):** The signature electric vault blue used for authoritative interactive states, primary action triggers, focused selection indicators, and brand affirmation.
- **Secondary (`#30D158` / `#34C759`):** Apple system green denoting pristine security health, 2FA valid token confirmations, and zero-compromise states.
- **Tertiary (`#FF9F0A` / `#FF9500`):** System warning amber designating expiring items, weak passwords, or secondary security prompts.
- **Neutral (`#8E8E93`):** Neutral gray calibrating metadata labels, unselected tool bar icons, and structural hierarchy across light and dark modes.

### Surface and System Modes
- **Light Appearance:** Background canvas is `#F5F5F7` with cards floating on `#FFFFFF`. Translucent sidebars adopt `rgba(246, 246, 246, 0.75)` overlaid on an active desktop canvas with `backdrop-filter: blur(25px) saturate(180%)`. Segmented dividers sit at `#E5E5EA`.
- **Dark Appearance:** Background canvas shifts to `#000000` with container surfaces at `#1C1C1E`. Sidebars render at `rgba(30, 30, 30, 0.75)` with `backdrop-filter: blur(30px) saturate(190%)`. Structural borders resolve to `#2C2C2E`.

## Typography

Typographic scale follows Apple's Human Interface Guidelines with micro-optical tracking corrections:

- **Primary Interface (`Inter`):** Selected for its metric and geometric fidelity to Apple's native San Francisco typography. Generous x-height, crisp legibility at sub-pixel rendering, and optical character discrimination ensure clarity across dense desktop columns.
- **Cryptographic & Secret Readouts (`JetBrains Mono`):** Dedicated to passwords, one-time verification tokens (TOTP), passkeys, and recovery strings. High distinctiveness between glyphs (such as `0` vs `O`, `1` vs `l`) prevents user error during security verification.
- Letter spacing uses tightening negative tracking on large weights (`-0.022em` on titles) and expands progressively on micro labels (`0.03em` for uppercase tags) to optimize retina legibility.

## Layout & Spacing

The layout is anchored in the traditional macOS three-pane productivity pattern:

1. **Source List / Sidebar (Column 1):** Fixed-to-resizable width (`200px` to `280px`). Uses compact density (`space-xs` to `space-sm`) for vault structures, categories, and tags.
2. **Item List (Column 2):** Resizable list pane (`260px` to `360px`). Segmented item collection displaying vault records with secondary metadata, favicon/icon assets, and tag pills.
3. **Inspector / Detail View (Column 3):** Fluid canvas filling remaining width. Hosts individual item details, credential groupings, TOTP indicators, audit logs, and context actions.

### Adaptive Behavior
- **Window Width < 820px:** Collapses to a two-pane layout; the sidebar tucks into an animated overlay toggle sheet accessible via the top-left toolbar button.
- **Window Width < 560px:** Single-pane master-detail view with fluid push/pop transitions mimicking Apple native stack navigation.
- Grid density strictly respects 4px/8px modular pacing, utilizing `0.75rem` padding inside list items to balance desktop touch-target ergonomics with mouse-driven data density.

## Elevation & Depth

Visual depth is achieved through translucent optical refractions, layered material tiering, and micro-borders rather than aggressive drop shadows.

- **Layer 0 (Window Chrome & Sidebar):** Frosted vibrancy material (`backdrop-filter: blur(28px) saturate(180%)`). Background content filters gently through, reflecting the underlying macOS desktop environment.
- **Layer 1 (Item List Pane):** Solid or semi-translucent baseline canvas (`#FFFFFF` in light, `#1C1C1E` in dark) with a `1px` right border using `#E5E5EA` (light) or `#2C2C2E` (dark).
- **Layer 2 (Detail View Cards):** Elevated content surfaces floating on canvas. Configured with a `0.5px` hairline border (`rgba(0, 0, 0, 0.08)` in light, `rgba(255, 255, 255, 0.12)` in dark) coupled with an ambient shadow: `0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)`.
- **Layer 3 (Modals & Command Palettes):** Elevated floating sheets with pronounced depth: `0 16px 36px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.08)` paired with an inner white specular highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.2)`).

## Shapes

The geometric framework mirrors modern macOS squircle and continuous corner radii conventions:

- **Standard Containers & Cards (`rounded-lg` - 1rem / 16px):** Provides organic, calm borders across detail card groups and inspector panels.
- **Interactive Controls & Fields (`rounded` - 0.5rem / 8px):** Applied to form fields, search inputs, list item selection backgrounds, and standard buttons.
- **Pills & Badges (`rounded-xl` / Full Radius - 9999px):** Applied to tag pills, security score badges, 2FA time tickers, and category counters.
- **Checkboxes & Segment Switches:** Balanced with a `6px` radius to feel cohesive with native macOS system inputs.

## Components

### Buttons & Quick Actions
- **Primary Action Button:** Background `#0572EC`, text `#FFFFFF`, border-radius `8px`, font `Inter` 13px weight 500. Inner highlight `inset 0 1px 0 rgba(255, 255, 255, 0.2)`. Focus state features a native Apple double-ring blue glow (`box-shadow: 0 0 0 3px rgba(5, 114, 236, 0.35)`).
- **Secondary / Ghost Button:** Transparent background, `1px` border in `#E5E5EA` (dark: `#2C2C2E`). Hover invokes `rgba(0, 0, 0, 0.04)` (dark: `rgba(255, 255, 255, 0.06)`).

### Detail Cards
- Stacked sectional containers grouping credentials (e.g., "Login Details", "Security Questions").
- Surface: `#FFFFFF` (dark: `#1C1C1E`), border-radius `12px`, separated by hairline dividers `#E5E5EA` (`0.5px`).
- Includes integrated inline field rows with subtle hover actions (copy, reveal, inspect history).

### Item List & Selection Rows
- List item height `56px`, equipped with icon glyph/favicon (`32px` rounded `8px`), primary title, subtitle, and right-aligned timestamp or tag.
- Selected state adopts native macOS vibrant selection: `#0572EC` solid fill with bright white text, or an adaptive frosted selection tint when window focus leaves the app.

### Secure Password Mask & TOTP Indicator
- **Password Mask:** Custom password reveal elements with uniform circular dots (`#48484A`, size `7px`, spacing `6px`). Upon reveal, transitions smoothly to `JetBrains Mono` with colored syntax highlighting (numbers, symbols, uppercase letters differentiated by tint).
- **TOTP Live Display:** Monospaced `24px` split code (`123 456`) accompanied by an animated circular countdown gauge stroke that shifts from `#34C759` to `#FF3B30` in the final 5 seconds.

### Tag Pills & Category Badges
- Pill shape (`padding: 2px 8px`, border-radius `9999px`), `11px` weight 500 typography.
- Low-saturation background tints derived from system accents (e.g., `rgba(5, 114, 236, 0.1)` for blue tags, `rgba(52, 199, 89, 0.1)` for green tags) paired with matching foreground text colors.

### Form Inputs & Search Bar
- Height `30px` (toolbar search) or `36px` (detail editor).
- Background: `rgba(0, 0, 0, 0.04)` (dark: `rgba(255, 255, 255, 0.08)`).
- Integrates leading system magnifying glass icon, trailing clear glyph, and instant keyboard shortcut badges (`⌘K`).