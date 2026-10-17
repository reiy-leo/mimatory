import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync('src/styles.css', 'utf8')
/* The field components carry class names too, so they are held to the same rules as App.tsx. */
const app = [
  'src/App.tsx',
  'src/app/fieldControls.tsx',
  'src/app/fieldActionControls.tsx',
  'src/app/relationControls.tsx',
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
const popup = readFileSync('browser-extension/popup.tailwind.css', 'utf8')
const popupHtml = readFileSync('browser-extension/popup.html', 'utf8')
const tailwindConfig = readFileSync('tailwind.config.js', 'utf8')
/* Everything after the token block: component rules may only read variables, never name a colour. */
const componentCss = styles.slice(styles.indexOf('@layer components'))

/* The default palette is a second, undocumented colour system. */
const paletteClasses =
  /\b(?:bg|text|border|ring|fill|stroke|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

/* Any length or colour literal inside a bracket, not just one at the start: a px hidden in a calc()
   is still a number nobody chose. Percentages, fr units and auto/minmax/var() stay allowed. */
const arbitraryVisualValue = /[a-z]+-\[[^\]]*(?:#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em)\b)[^\]]*\]/

/** Reads one custom property's value out of a declaration block. */
function tokenValue(block: string, name: string): string | undefined {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim()
}

const lightStart = styles.indexOf('\n  :root {')
const darkStart = styles.indexOf('\n  :root[data-theme="dark"] {')
const lightBlock = styles.slice(lightStart, darkStart)
const darkBlock = styles.slice(darkStart, styles.indexOf('\n  }', darkStart))

/** .agent/design.md is the rulebook (macOS HIG); these are the rules a restyle most often re-breaks. */
describe('design rules', () => {
  it('keeps colour values in the token layer only', () => {
    expect(componentCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(componentCss).not.toMatch(/\brgba?\(/)
  })

  it('forbids the default Tailwind palette and arbitrary visual values', () => {
    expect(app).not.toMatch(paletteClasses)
    expect(popupHtml).not.toMatch(paletteClasses)
    expect(`${app}\n${styles}\n${popupHtml}`).not.toMatch(arbitraryVisualValue)
  })

  it('ships no self-hosted webfont: the system font (SF Pro) is the whole typeface story', () => {
    for (const source of [styles, popup]) {
      expect(source).not.toMatch(/@font-face/)
      expect(source).not.toMatch(/public\/fonts/)
      expect(source).toMatch(/font-family: -apple-system, BlinkMacSystemFont/)
    }
  })

  it('draws the keyboard focus ring in the accent, at the ring width, on the control edge', () => {
    for (const source of [styles, popup]) {
      for (const rule of source.match(/outline: [^;]+;/g) ?? []) {
        expect(rule).toContain('var(--focus-ring-width)')
        expect(rule).toContain('var(--color-focus-ring)')
      }
      expect(source).toContain('outline-offset: var(--focus-ring-offset)')
      expect(source).not.toMatch(/outline:\s*none\s*;/)
    }
    expect(tokenValue(lightBlock, '--color-focus-ring')).toBe(tokenValue(lightBlock, '--color-accent'))
    expect(tokenValue(darkBlock, '--color-focus-ring')).toBe(tokenValue(darkBlock, '--color-accent'))
  })

  it('uses systemBlue as the accent, with a real dark value', () => {
    expect(tokenValue(lightBlock, '--color-accent')).toBe('#007aff')
    expect(tokenValue(darkBlock, '--color-accent')).toBe('#0a84ff')
  })

  it('gives every colour a dark value: no light-only token', () => {
    const lightColors = [...lightBlock.matchAll(/(--color-[a-z0-9-]+):\s*#/g)].map((match) => match[1])
    const darkColors = new Set([...darkBlock.matchAll(/(--color-[a-z0-9-]+):/g)].map((match) => match[1]))
    /* A transparent fill is the same in both appearances, so it needs no override. */
    const sameInBoth = new Set(['--color-background-neutral-subtle', '--color-on-selected-fill'])
    expect(lightColors.filter((name) => !darkColors.has(name) && !sameInBoth.has(name))).toEqual([])
  })

  it('keeps the macOS type scale: body 13pt, nothing under the 10pt minimum', () => {
    expect(tailwindConfig).toMatch(/body: \['0\.8125rem'/)
    for (const [, size] of tailwindConfig.matchAll(/: \['(\d*\.?\d+)rem'/g)) {
      expect(Number(size) * 16).toBeGreaterThanOrEqual(10)
    }
  })

  it('keeps blur on the functional layer and gives it a solid fallback', () => {
    /* Every backdrop-filter reads the material filter, so Reduce Transparency can turn it off. */
    for (const rule of styles.match(/backdrop-filter: [^;]+;/g) ?? []) {
      expect(rule).toContain('var(--material-filter)')
    }
    expect(styles).toMatch(/@media \(prefers-reduced-transparency: reduce\)/)
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    /* Content panes never wear a material. */
    for (const content of ['.item-list', '.detail-pane', '.onepassword-group']) {
      const rule = componentCss.match(new RegExp(`\\n  \\${content} \\{[^}]*\\}`, 'g')) ?? []
      expect(rule.join('\n')).not.toContain('--material-')
    }
  })

  it('reads every shadow from a shadow token', () => {
    for (const rule of componentCss.match(/box-shadow: [^;]+;/g) ?? []) {
      expect(rule).toMatch(/box-shadow: (?:var\(--shadow-[a-z]+\)|none);/)
    }
  })

  it('mirrors the app tokens in the extension popup', () => {
    for (const [, name, value] of popup.matchAll(/\n\s*(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
      expect(styles).toContain(`${name}: ${value};`)
    }
  })
})

/* The platform skins (src/skin/): tokens.css holds the per-skin values, skins.css and mobile.css only shapes. */
const skinTokens = readFileSync('src/skin/tokens.css', 'utf8')
const skinShapes = ['src/skin/skins.css', 'src/skin/mobile.css'].map((path) => readFileSync(path, 'utf8')).join('\n')

function skinBlock(selector: string): string {
  const start = skinTokens.indexOf(`${selector} {`)
  return start < 0 ? '' : skinTokens.slice(start, skinTokens.indexOf('\n}', start))
}

describe('platform skin rules', () => {
  it('keeps colour values out of the skin shape rules', () => {
    expect(skinShapes).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(skinShapes).not.toMatch(/\brgba?\(/)
    expect(skinShapes).not.toMatch(/outline:\s*none\s*;/)
  })

  it('gives every colour a skin sets in light a dark value too', () => {
    for (const skin of ['winui', 'material']) {
      const light = skinBlock(`:root[data-skin="${skin}"]`)
      const dark = skinBlock(`:root[data-skin="${skin}"][data-theme="dark"]`)
      expect(light).not.toBe('')
      const lightColors = [...light.matchAll(/(--color-[a-z0-9-]+):/g)].map((match) => match[1])
      const darkColors = new Set([...dark.matchAll(/(--color-[a-z0-9-]+):/g)].map((match) => match[1]))
      expect(lightColors.filter((name) => !darkColors.has(name))).toEqual([])
    }
  })

  it('keeps every skin on the system font, with no webfont', () => {
    expect(skinTokens).not.toMatch(/@font-face/)
    expect(skinBlock(':root[data-skin="winui"]')).toMatch(/font-family:\s*"Segoe UI Variable Text"/)
    expect(skinBlock(':root[data-skin="material"]')).toMatch(/font-family: Roboto/)
  })

  it('leaves the Apple skin to the base tokens, so macOS draws exactly as before', () => {
    /* Apple-skin rules exist only for the phone layout (iOS); the desktop Apple skin is styles.css alone. */
    const appleLines = `${skinTokens}\n${skinShapes}`.split('\n').filter((line) => line.includes('data-skin="apple"'))
    expect(appleLines.length).toBeGreaterThan(0)
    for (const line of appleLines) expect(line).toContain('[data-layout="mobile"]')
  })
})
