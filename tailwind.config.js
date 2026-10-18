/**
 * Token NAMES for the Apple (macOS Human Interface Guidelines) design system in .agent/design.md.
 * Every value here points at a CSS custom property; the VALUES live only in src/styles.css `:root`
 * (light) and `:root[data-theme="dark"]` (dark), so the appearance can switch at runtime.
 * Never add a hex to a component rule.
 */
const colorTokens = [
  'accent',
  'window',
  'sidebar',
  'focus-ring',
  'background-control',
  'background-control-pressed',
  'background-selected-bold',
  'text-selected-subtle',
  'text',
  'text-subtle',
  'text-subtlest',
  'text-selected',
  'text-disabled',
  'text-inverse',
  'text-brand',
  'text-danger',
  'text-warning',
  'text-warning-inverse',
  'text-success',
  'text-information',
  'text-discovery',
  'icon',
  'icon-subtle',
  'icon-subtlest',
  'icon-selected',
  'icon-disabled',
  'icon-inverse',
  'icon-brand',
  'icon-danger',
  'icon-warning',
  'icon-success',
  'icon-information',
  'icon-discovery',
  'surface',
  'surface-sunken',
  'surface-raised',
  'surface-overlay',
  'border',
  'border-bold',
  'border-input',
  'border-focused',
  'border-selected',
  'border-disabled',
  'border-inverse',
  'border-danger',
  'border-warning',
  'border-success',
  'border-information',
  'border-discovery',
  'link',
  'link-pressed',
  'link-visited',
  'background-neutral-subtle',
  'background-neutral-subtle-hovered',
  'background-neutral-subtle-pressed',
  'background-neutral-bold',
  'background-input',
  'background-input-hovered',
  'background-disabled',
  'background-selected',
  'background-selected-hovered',
  'background-brand-bold',
  'background-brand-bold-hovered',
  'background-brand-subtlest',
  'background-danger',
  'background-danger-subtle',
  'background-danger-bold',
  'background-warning',
  'background-warning-subtle',
  'background-warning-bold',
  'background-success',
  'background-success-subtle',
  'background-success-bold',
  'background-information',
  'background-information-subtle',
  'background-discovery',
  'background-discovery-subtle',
  'blanket',
  'skeleton',
]

/** Tag and item-type hues (system colors) are decoration only — never a stand-in for a status role.
    The stored names predate the palette: `lime` renders systemMint and `magenta` systemPink. */
const accentHues = ['gray', 'red', 'orange', 'yellow', 'green', 'lime', 'teal', 'blue', 'purple', 'magenta']

const colors = {
  ...Object.fromEntries(colorTokens.map((token) => [token, `var(--color-${token})`])),
  ...Object.fromEntries(accentHues.map((hue) => [`accent-${hue}`, `var(--color-border-accent-${hue})`])),
  ...Object.fromEntries(accentHues.map((hue) => [`accent-text-${hue}`, `var(--color-text-accent-${hue})`])),
  ...Object.fromEntries(accentHues.map((hue) => [`accent-icon-${hue}`, `var(--color-icon-accent-${hue})`])),
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './browser-extension/**/*.{html,js}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  plugins: [],
  theme: {
    extend: {
      /* radius-* : medium (6) for controls, large (10) for grouped sections and popovers,
         xlarge (12) for windows and sheets. */
      borderRadius: {
        full: 'var(--radius-full)',
        large: 'var(--radius-large)',
        medium: 'var(--radius-medium)',
        small: 'var(--radius-small)',
        xlarge: 'var(--radius-xlarge)',
        xsmall: 'var(--radius-xsmall)',
        xxlarge: 'var(--radius-xxlarge)',
      },
      borderWidth: {
        default: 'var(--border-width-default)',
        selected: 'var(--border-width-selected)',
      },
      /* Only these three shadows exist: a control bezel, popovers/menus, sheets. Content sits on
         separators, never on a shadow. */
      boxShadow: {
        control: 'var(--shadow-control)',
        overlay: 'var(--shadow-overlay)',
        sheet: 'var(--shadow-sheet)',
      },
      colors,
      fontFamily: {
        /* SF Mono and SF Pro through the platform keywords; no webfont is imported. */
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'Helvetica Neue', 'sans-serif'],
      },
      /* macOS built-in text styles (typography.md › macOS built-in text styles), in rem so the
         page zoom scales them: size / line height in points. Body is 13, the minimum is 10. */
      fontSize: {
        body: ['0.8125rem', { fontWeight: '400', lineHeight: '1rem' }],
        callout: ['0.75rem', { fontWeight: '400', lineHeight: '0.9375rem' }],
        caption: ['0.625rem', { fontWeight: '400', lineHeight: '0.8125rem' }],
        code: ['0.92em', { fontWeight: '400', lineHeight: '1' }],
        footnote: ['0.625rem', { fontWeight: '400', lineHeight: '0.8125rem' }],
        headline: ['0.8125rem', { fontWeight: '600', lineHeight: '1rem' }],
        'large-title': ['1.625rem', { fontWeight: '400', lineHeight: '2rem' }],
        subheadline: ['0.6875rem', { fontWeight: '400', lineHeight: '0.875rem' }],
        'title-1': ['1.375rem', { fontWeight: '400', lineHeight: '1.625rem' }],
        'title-2': ['1.0625rem', { fontWeight: '400', lineHeight: '1.375rem' }],
        'title-3': ['0.9375rem', { fontWeight: '400', lineHeight: '1.25rem' }],
      },
      /* weight-* : never an arbitrary numeric weight. */
      fontWeight: {
        bold: 'var(--weight-bold)',
        medium: 'var(--weight-medium)',
        regular: 'var(--weight-regular)',
        semibold: 'var(--weight-semibold)',
      },
      /* Row templates come from the spacing scale and the measures above, never from inline px:
         an arbitrary track value is a number nobody chose. */
      gridTemplateColumns: {
        field: 'minmax(0,1fr) var(--space-400)',
        /* The editor's field slot: the drag-handle gutter outside the card, then the cell. */
        'icon-option': 'var(--space-250) minmax(0,1fr)',
        settings: 'var(--measure-settings-nav) minmax(0,1fr)',
        'slider-row': 'auto minmax(var(--measure-slider-min),1fr) var(--space-1000)',
      },
      gridTemplateRows: {
        titlebar: 'var(--measure-titlebar) minmax(0,1fr)',
      },
      maxHeight: {
        'picker-list': 'var(--measure-picker-list)',
        'text-preview': 'var(--measure-text-preview-height)',
      },
      /* Documented layout measures (see styles.css `--measure-*`), not spacing steps. */
      maxWidth: {
        content: 'var(--measure-content-max)',
        'detail-header': 'var(--measure-detail-header)',
        'lock-field': 'var(--measure-lock-field)',
        'lock-panel': 'var(--measure-lock-panel)',
        modal: 'var(--measure-modal)',
        settings: 'var(--measure-settings-max)',
        'text-preview': 'var(--measure-text-preview)',
        'type-picker': 'var(--measure-type-picker)',
      },
      minWidth: {
        'item-list': 'var(--measure-item-list-min)',
        window: 'var(--measure-window-min)',
      },
      /* The overlay titlebar strip is chrome, not a spacing decision — named so no rule
         needs an arbitrary pt-[44px]. */
      padding: {
        titlebar: 'var(--measure-titlebar)',
      },
      /* space-* : the 4/8pt grid, named by step. p-075 = 6px, p-200 = 16px, p-350 = 28px (the macOS
         default control size), p-400 = 32px. Tailwind's own 1..96 steps land on the same grid. */
      spacing: {
        '025': '0.125rem',
        '050': '0.25rem',
        '075': '0.375rem',
        100: '0.5rem',
        150: '0.75rem',
        200: '1rem',
        250: '1.25rem',
        300: '1.5rem',
        350: '1.75rem',
        400: '2rem',
        500: '2.5rem',
        600: '3rem',
        800: '4rem',
        1000: '5rem',
      },
      transitionDuration: {
        long: 'var(--duration-long)',
        medium: 'var(--duration-medium)',
        short: 'var(--duration-short)',
        xlong: 'var(--duration-xlong)',
        xshort: 'var(--duration-xshort)',
        xxshort: 'var(--duration-xxshort)',
      },
      transitionTimingFunction: {
        'in-practical': 'var(--easing-in-practical)',
        'inout-bold': 'var(--easing-inout-bold)',
        'out-bold': 'var(--easing-out-bold)',
        'out-practical': 'var(--easing-out-practical)',
      },
      width: {
        popup: 'var(--measure-popup)',
      },
    },
  },
}
