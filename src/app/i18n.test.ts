import { describe, expect, it } from 'vitest'
import i18n, { getInitialLanguage, supportedLanguages } from './i18n'

function flattenKeys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, nested]) =>
    typeof nested === 'object' && nested !== null
      ? flattenKeys(nested as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
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
    const [chinese, english, japanese] = supportedLanguages.map((language) =>
      flattenKeys(i18n.getResourceBundle(language, 'translation') as Record<string, unknown>).sort(),
    )

    expect(english).toEqual(chinese)
    expect(japanese).toEqual(chinese)
  })
})
