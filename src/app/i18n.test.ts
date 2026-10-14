import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import i18n, { getInitialLanguage, supportedLanguages } from './i18n'

type Bundle = Record<string, unknown>

function flattenKeys(value: Bundle, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, nested]) =>
    typeof nested === 'object' && nested !== null
      ? flattenKeys(nested as Bundle, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

function lookup(root: Bundle, path: string): boolean {
  let cursor: unknown = root
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return false
    const next = (cursor as Bundle)[segment]
    if (next === undefined) return false
    cursor = next
  }
  return typeof cursor === 'string'
}

const bundle = (language: string) => i18n.getResourceBundle(language, 'translation') as Bundle

/* The namespaces the fallback locale declares. A string literal only counts as a key when it starts
   with one of these, which keeps class names and file paths out of the sweep. */
const namespaces = Object.keys(bundle('zh'))

/* Sources, not the bundles or the tests: i18n.ts holds the values, and a test naming a key is not a
   screen asking for one. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!path.endsWith('.ts') && !path.endsWith('.tsx')) return []
    if (path.endsWith('i18n.ts') || path.endsWith('.test.ts')) return []
    return [path]
  })
}

const sources = sourceFiles('src').map((path) => ({ path, text: readFileSync(path, 'utf8') }))

const keyLiteral = new RegExp(`'((?:${namespaces.join('|')})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)'`, 'g')

/* Not a key: a sync setting's default file name happens to read like one. A denylist is cheaper than
   resolving the call graph, and a genuine missing key would have to be spelled exactly this way to
   hide behind it. */
const notKeys = new Set(['vault.enc'])

function missingFromSomeLocale(keys: string[]): string[] {
  return keys.filter((key) => !supportedLanguages.every((language) => lookup(bundle(language), key)))
}

describe('i18n', () => {
  it('defaults to Chinese when no supported language is stored', () => {
    expect(getInitialLanguage(null)).toBe('zh')
    expect(getInitialLanguage('fr')).toBe('zh')
  })

  it('supports Chinese, English, and Japanese resources', async () => {
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.language')).toBe('语言')

    await i18n.changeLanguage('en')
    expect(i18n.t('settings.language')).toBe('Language')

    await i18n.changeLanguage('ja')
    expect(i18n.t('settings.language')).toBe('言語')
  })

  it('keeps every locale on the same translation keys', () => {
    const [chinese, english, japanese] = supportedLanguages.map((language) => flattenKeys(bundle(language)).sort())

    expect(english).toEqual(chinese)
    expect(japanese).toEqual(chinese)
  })

  /* Parity alone proves nothing about a key nobody defined: an absent one renders its own path, or
     whatever defaultValue the call site carried. This is the sweep that catches either. */
  it('translates every key the source names', () => {
    const referenced = new Set<string>()
    for (const { text } of sources) {
      for (const match of text.matchAll(keyLiteral)) if (!notKeys.has(match[1])) referenced.add(match[1])
    }

    expect(missingFromSomeLocale([...referenced])).toEqual([])
  })

  /* A defaultValue is how a screen keeps reading English in zh and ja with every check above green,
     so a call with a literal key is not allowed one. */
  it('carries no English fallback on a literal key', () => {
    const fallback = /t\(\s*'[^']+'\s*,\s*\{[^}]*\bdefaultValue\b/
    expect(sources.filter(({ text }) => fallback.test(text)).map(({ path }) => path)).toEqual([])
  })

  /* These families are only ever reached through a template string, so nothing above can see them: the
     item type comes from the sidebar's categories, the placeholder from the add-field menu, and the icon
     name from the tag picker's grid. */
  it('translates the keys built at runtime', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    const itemTypes = [...app.matchAll(/icon: \w+, itemType: '([a-z_]+)' \}/g)].map((match) => match[1])
    /* The lookbehind keeps `field_type` and `item_type` out of the sweep — only the add-field menu's
       own `type:` values pick a placeholder, and an item type is not one of them. */
    const fieldTypes = [...app.matchAll(/(?<![A-Za-z_])type: '([a-z_]+)'/g)].map((match) => match[1])
    const tagSource = readFileSync('src/app/tagIcons.ts', 'utf8')
    const tagIcons = [...tagSource.matchAll(/\{ icon: \w+, name: '([a-z-]+)' \}/g)].map((match) => match[1])
    /* The "no colour" swatch is stored as an empty string, so its key is the one name the source does
       not carry and the picker's `tagColorLabelKey` supplies instead. */
    const tagColors = ['none', ...[...tagSource.matchAll(/swatchClass: 'bg-accent-icon-([a-z]+)'/g)].map((m) => m[1])]
    /* The appearance segments are labelled `settings.<theme>` from the option list in theme.ts. */
    const themeSource = readFileSync('src/app/theme.ts', 'utf8')
    const themeList = themeSource.match(/themeOptions: Theme\[\] = \[([^\]]+)\]/)?.[1] ?? ''
    const themes = [...themeList.matchAll(/'([a-z]+)'/g)].map((match) => match[1])

    expect(itemTypes.length).toBeGreaterThan(10)
    expect(fieldTypes.length).toBeGreaterThan(10)
    expect(tagIcons.length).toBeGreaterThan(10)
    expect(tagColors.length).toBeGreaterThan(10)
    expect(themes).toEqual(['system', 'light', 'dark'])

    const derived = [
      ...itemTypes.map((itemType) => `itemTypes.${itemType}`),
      ...fieldTypes.map((fieldType) => `vault.customFieldDefaults.${fieldType}`),
      ...tagIcons.map((tagIcon) => `tagIcons.${tagIcon}`),
      ...tagColors.map((tagColor) => `tagColors.${tagColor}`),
      ...themes.map((theme) => `settings.${theme}`),
    ]
    expect(missingFromSomeLocale(derived)).toEqual([])
  })
})
