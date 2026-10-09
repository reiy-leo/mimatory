/**
 * Token NAMES for the Atlassian design contract in DESIGN.md (revision 0.0.7).
 * Every value here points at a CSS custom property; the VALUES live only in src/styles.css `:root`,
 * so dark mode can re-point them at runtime. Never add a hex to a component rule.
 */
const colorTokens = [
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

/** Accent ramps are decoration only (item-type icons, tags) — never a stand-in for a semantic role. */
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
      /* radius-* : pick by component class, not by taste. */
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
        focused: 'var(--border-width-focused)',
        selected: 'var(--border-width-selected)',
      },
      /* Only these three shadows exist. Cards on the default plane use borders, not shadows. */
      boxShadow: {
        overflow: 'var(--shadow-overflow)',
        overlay: 'var(--shadow-overlay)',
        raised: 'var(--shadow-raised)',
      },
      colors,
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        /* "Atlassian Sans"/"Atlassian Mono" are proprietary; the contract's system fallback stack
           stands in, and no third-party webfont is imported. */
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      /* Typography levels from the DESIGN.md `typography:` block. */
      fontSize: {
        body: ['0.875rem', { fontWeight: '400', lineHeight: '1.25rem' }],
        'body-large': ['1rem', { fontWeight: '400', lineHeight: '1.5rem' }],
        'body-small': ['0.75rem', { fontWeight: '400', lineHeight: '1rem' }],
        code: ['0.875em', { fontWeight: '400', lineHeight: '1' }],
        'heading-large': ['1.5rem', { fontWeight: '653', lineHeight: '1.75rem' }],
        'heading-medium': ['1.25rem', { fontWeight: '653', lineHeight: '1.5rem' }],
        'heading-small': ['1rem', { fontWeight: '653', lineHeight: '1.25rem' }],
        'heading-xlarge': ['1.75rem', { fontWeight: '653', lineHeight: '2rem' }],
        'heading-xsmall': ['0.875rem', { fontWeight: '653', lineHeight: '1.25rem' }],
        'heading-xxlarge': ['2rem', { fontWeight: '653', lineHeight: '2.25rem' }],
        'heading-xxsmall': ['0.75rem', { fontWeight: '653', lineHeight: '1rem' }],
        'metric-large': ['1.75rem', { fontWeight: '653', lineHeight: '2rem' }],
        'metric-medium': ['1.5rem', { fontWeight: '653', lineHeight: '1.75rem' }],
        'metric-small': ['1rem', { fontWeight: '653', lineHeight: '1.25rem' }],
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
        'handle-field': 'var(--space-300) minmax(0,1fr) var(--space-400)',
        'icon-option': 'var(--space-250) minmax(0,1fr)',
        password: 'minmax(0,1fr) repeat(3, var(--space-400))',
        settings: 'var(--measure-settings-nav) minmax(0,1fr)',
        'slider-row': 'auto minmax(var(--measure-slider-min),1fr) var(--space-1000)',
      },
      gridTemplateRows: {
        titlebar: 'var(--measure-titlebar) minmax(0,1fr)',
      },
      maxHeight: {
        'archive-list': 'var(--measure-archive-list-max)',
      },
      /* Documented layout measures (see styles.css `--measure-*`), not spacing steps. */
      maxWidth: {
        content: 'var(--measure-content-max)',
        'detail-header': 'var(--measure-detail-header)',
        'lock-panel': 'var(--measure-lock-panel)',
        modal: 'var(--measure-modal)',
        settings: 'var(--measure-settings-max)',
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
      /* space-* : 8px base, named by the DESIGN.md step. p-075 = 6px, p-200 = 16px, p-400 = 32px.
         Tailwind's own 1..96 steps are left in place and land on the same grid (p-4 = p-200). */
      spacing: {
        '025': '0.125rem',
        '050': '0.25rem',
        '075': '0.375rem',
        100: '0.5rem',
        150: '0.75rem',
        200: '1rem',
        250: '1.25rem',
        300: '1.5rem',
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
