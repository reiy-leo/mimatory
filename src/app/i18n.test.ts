import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import i18n, {
  getInitialLanguage,
  languageNames,
  matchLanguage,
  readLanguagePreference,
  resolveLanguage,
  resolveSystemLanguage,
  supportedLanguages,
} from './i18n'

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
    if (path.endsWith('i18n.ts') || path.includes('/locales/') || path.endsWith('.test.ts')) return []
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
  it('follows the system when nothing is stored', () => {
    expect(readLanguagePreference(null)).toBe('system')
    expect(readLanguagePreference('klingon')).toBe('system')
    expect(readLanguagePreference('ja')).toBe('ja')
    expect(resolveLanguage('system', ['xx-YY', 'ja-JP', 'en-US'])).toBe('ja')
    expect(resolveLanguage('zh', ['ja-JP'])).toBe('zh')
    expect(resolveSystemLanguage([])).toBe('en')
    expect(resolveSystemLanguage(['tlh'])).toBe('en')
  })

  it('maps OS and browser tags onto the UI languages', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-Hans-CN', 'zh-SG', 'zh_CN.UTF-8', 'zh-TW'])
      expect(matchLanguage(tag)).toBe('zh')
    expect(matchLanguage('en-GB')).toBe('en')
    expect(matchLanguage('ja_JP')).toBe('ja')
    expect(matchLanguage('')).toBeNull()
    expect(matchLanguage('nl-NL')).toBeNull()
    const expected: Record<string, string> = {
      de: 'de-AT',
      es: 'es-419',
      fr: 'fr-CA',
      id: 'id-ID',
      pt: 'pt-PT',
      ru: 'ru-RU',
    }
    for (const [language, tag] of Object.entries(expected)) {
      if ((supportedLanguages as readonly string[]).includes(language)) expect(matchLanguage(tag)).toBe(language)
    }
    if ((supportedLanguages as readonly string[]).includes('pt')) {
      expect(matchLanguage('pt-BR')).toBe('pt')
      expect(matchLanguage('pt')).toBe('pt')
    }
    if ((supportedLanguages as readonly string[]).includes('id')) expect(matchLanguage('in-ID')).toBe('id')
  })

  it('keeps a language picked before follow-system existed', () => {
    expect(getInitialLanguage('en')).toBe('en')
    expect(getInitialLanguage('zh')).toBe('zh')
  })

  it('names every language in its own name', () => {
    expect(Object.keys(languageNames).sort()).toEqual([...supportedLanguages].sort())
    expect(languageNames.zh).toBe('简体中文')
    expect(languageNames.en).toBe('English')
  })

  it('serves every bundle', async () => {
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.language')).toBe('语言')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.language')).toBe('Language')
    await i18n.changeLanguage('ja')
    expect(i18n.t('settings.language')).toBe('言語')
    for (const language of supportedLanguages) {
      expect(i18n.getFixedT(language)('settings.languageSystem')).not.toBe('settings.languageSystem')
    }
  })

  /*
   * Parity with en, the reference bundle. A plural is the base key (the "other" form, which i18next falls back
   * to) plus `_one` / `_few` / `_many` / `_two` / `_zero` variants where the language needs them: a locale that
   * gives a key any variant gives it every category Intl.PluralRules lists for that language (ru: one, few,
   * many). Variants aside, the keys are exactly en's, no string is empty, and the {{placeholders}} are en's.
   */
  const pluralSuffix = /_(zero|one|two|few|many)$/

  function strings(language: string): Map<string, string> {
    const t = i18n.getFixedT(language)
    return new Map(flattenKeys(bundle(language)).map((key) => [key, t(key)]))
  }

  function baseKeys(map: Map<string, string>): string[] {
    return [...map.keys()].filter((key) => !(pluralSuffix.test(key) && map.has(key.replace(pluralSuffix, '')))).sort()
  }

  const placeholders = (value: string) => [...new Set([...value.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]))].sort()

  it('keeps every locale on the same translation keys as en', () => {
    const reference = baseKeys(strings('en'))
    expect(reference.length).toBeGreaterThan(800)
    for (const language of supportedLanguages) {
      expect({ keys: baseKeys(strings(language)), language }).toEqual({ keys: reference, language })
    }
  })

  it('leaves no string empty', () => {
    for (const language of supportedLanguages) {
      const empty = [...strings(language)].filter(([, value]) => !value.trim()).map(([key]) => key)
      expect({ empty, language }).toEqual({ empty: [], language })
    }
  })

  it('keeps the placeholders of en', () => {
    const english = strings('en')
    for (const language of supportedLanguages) {
      const wrong = [...strings(language)]
        .filter(([key, value]) => {
          const base = english.has(key) ? key : key.replace(pluralSuffix, '')
          return placeholders(value).join() !== placeholders(english.get(base) ?? '').join()
        })
        .map(([key]) => key)
      expect({ language, wrong }).toEqual({ language, wrong: [] })
    }
  })

  /* es, fr and pt list a `many` form that only applies to exact millions ("1 000 000 d’éléments"), which reads
     the same as the base ("other") form i18next falls back to, so it is never required. */
  const otherCoversMany = new Set(['es', 'fr', 'pt'])

  it('gives a plural every form the language needs', () => {
    for (const language of supportedLanguages) {
      const map = strings(language)
      const categories: string[] = new Intl.PluralRules(language)
        .resolvedOptions()
        .pluralCategories.filter((c) => c !== 'other')
      const required = categories.filter((c) => !(c === 'many' && otherCoversMany.has(language)))
      const plurals = new Set(
        [...map.keys()]
          .filter((key) => pluralSuffix.test(key) && map.has(key.replace(pluralSuffix, '')))
          .map((key) => key.replace(pluralSuffix, '')),
      )
      const missing = [...plurals].flatMap((base) =>
        required.filter((category) => !map.has(`${base}_${category}`)).map((category) => `${base}_${category}`),
      )
      const stray = [...map.keys()].filter((key) => {
        const match = key.match(pluralSuffix)
        return match && map.has(key.replace(pluralSuffix, '')) && !categories.includes(match[1])
      })
      expect({ language, missing, stray }).toEqual({ language, missing: [], stray: [] })
    }
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
    const app = readFileSync('src/app/vaultModel.ts', 'utf8')
    const itemTypes = [...app.matchAll(/icon: \w+, itemType: '([a-z_]+)' \}/g)].map((match) => match[1])
    /* The Add More menu's field entries (addMoreOptions.ts) each pick a default label and a placeholder. */
    const addMore = readFileSync('src/app/addMoreOptions.ts', 'utf8')
    const fieldTypes = [...addMore.matchAll(/id: '([a-z_]+)',\s*kind: 'field'/g)].map((match) => match[1])
    const tagSource = readFileSync('src/app/tagIcons.ts', 'utf8')
    const tagIcons = [...tagSource.matchAll(/\{ icon: \w+, name: '([a-z-]+)' \}/g)].map((match) => match[1])
    /* The "no colour" swatch is stored as an empty string, so its key is the one name the source does
       not carry and the picker's `tagColorLabelKey` supplies instead. */
    const tagColors = ['none', ...[...tagSource.matchAll(/swatchClass: 'bg-accent-icon-([a-z]+)'/g)].map((m) => m[1])]

    expect(itemTypes.length).toBeGreaterThan(10)
    expect(fieldTypes.length).toBeGreaterThan(10)
    expect(tagIcons.length).toBeGreaterThan(10)
    expect(tagColors.length).toBeGreaterThan(10)

    const derived = [
      ...itemTypes.map((itemType) => `itemTypes.${itemType}`),
      ...fieldTypes.map((fieldType) => `vault.customFieldDefaults.${fieldType}`),
      ...tagIcons.map((tagIcon) => `tagIcons.${tagIcon}`),
      ...tagColors.map((tagColor) => `tagColors.${tagColor}`),
    ]
    expect(missingFromSomeLocale(derived)).toEqual([])
  })

  /* The app is Mimatory, and 密码库存 in Chinese (owner, 2026-10-24): every zh string that names the app — the
     app's own and the extension's — says 密码库存, while en and ja keep Mimatory. */
  it('names the app 密码库存 in Chinese and Mimatory elsewhere', () => {
    expect(i18n.getFixedT('zh')('settings.appName')).toBe('密码库存')
    expect(i18n.getFixedT('zh')('lock.appName')).toBe('密码库存')
    expect(i18n.getFixedT('zh')('settings.windowTitle')).toBe('密码库存设置')
    expect(i18n.getFixedT('en')('settings.appName')).toBe('Mimatory')
    expect(i18n.getFixedT('ja')('settings.appName')).toBe('Mimatory')

    const zhValues = flattenKeys(bundle('zh')).map((key) => i18n.getFixedT('zh')(key))
    expect(zhValues.filter((value) => /mimatory|密码通/i.test(value))).toEqual([])

    const extension = (locale: string) =>
      JSON.parse(
        readFileSync(join(process.cwd(), 'browser-extension/_locales', locale, 'messages.json'), 'utf8'),
      ) as Record<string, { description?: string; message: string }>
    const zhExtension = Object.values(extension('zh_CN')).flatMap(({ description, message }) => [
      message,
      description ?? '',
    ])
    expect(zhExtension.filter((value) => /mimatory/i.test(value))).toEqual([])
    expect(extension('zh_CN').appName.message).toBe('密码库存')
    expect(extension('zh_CN').extensionName.message).toContain('密码库存')
    expect(extension('en').appName.message).toBe('Mimatory')
    expect(extension('ja').appName.message).toBe('Mimatory')
  })
})
