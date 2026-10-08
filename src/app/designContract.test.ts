import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync('src/styles.css', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const popup = readFileSync('browser-extension/popup.tailwind.css', 'utf8')
const popupHtml = readFileSync('browser-extension/popup.html', 'utf8')
/* Everything after the token block: component rules may only read variables, never name a colour. */
const componentCss = styles.slice(styles.indexOf('@layer components'))

/* The default palette is a second, undocumented colour system. */
const paletteClasses =
  /\b(?:bg|text|border|ring|fill|stroke|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

/* Any length or colour literal inside a bracket, not just one at the start: a px hidden in a calc()
   is still a number nobody chose. Percentages, fr units and auto/minmax/var() stay allowed. */
const arbitraryVisualValue = /[a-z]+-\[[^\]]*(?:#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em)\b)[^\]]*\]/

/** DESIGN.md is the contract; these are the rules that coding agents most often re-break. */
describe('design contract', () => {
  it('keeps colour values in the token layer only', () => {
    expect(componentCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('keeps the sentence-case rule: no capitalised or letter-spaced labels', () => {
    /* Only the slots that can carry styling are in scope — `uppercase: true` is a generator option. */
    const classSlots = [
      ...(styles.match(/@apply[^;]+;/g) ?? []),
      ...(popup.match(/@apply[^;]+;/g) ?? []),
      ...(app.match(/className="[^"]*"/g) ?? []),
      ...(popupHtml.match(/class="[^"]*"/g) ?? []),
    ].join('\n')
    expect(styles).not.toMatch(/text-transform:\s*uppercase/)
    expect(classSlots).not.toMatch(/\buppercase\b/)
    expect(classSlots).not.toMatch(/\btracking-(?!normal\b)/)
  })

  it('forbids the default Tailwind palette and arbitrary visual values', () => {
    expect(app).not.toMatch(paletteClasses)
    expect(`${app}\n${styles}`).not.toMatch(arbitraryVisualValue)
  })

  it('ships no self-hosted webfont: the system stack is the whole typeface story', () => {
    expect(styles).not.toMatch(/@font-face/)
    expect(styles).not.toMatch(/public\/fonts/)
    expect(popup).not.toMatch(/@font-face/)
  })

  it('draws the focus ring at 2px with a 2px offset', () => {
    for (const source of [styles, popup]) {
      for (const rule of source.match(/outline: [^;]+;/g) ?? []) {
        expect(rule).toContain('var(--border-width-focused)')
        expect(rule).toContain('var(--color-border-focused)')
      }
      expect(source).toContain('outline-offset: var(--space-025)')
    }
  })
})
