import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import ja from './locales/ja'
import zh from './locales/zh'

export const supportedLanguages = ['zh', 'en', 'ja'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

export const languageOptions: Array<{ value: SupportedLanguage; label: string }> = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
]

export function getInitialLanguage(value: string | null): SupportedLanguage {
  return supportedLanguages.includes(value as SupportedLanguage) ? (value as SupportedLanguage) : 'zh'
}

function getStoredLanguage(): string | null {
  try {
    return globalThis.localStorage?.getItem('mimatory-language') ?? null
  } catch {
    return null
  }
}

const resources = {
  en: { translation: en },
  ja: { translation: ja },
  zh: { translation: zh },
}

void i18n.use(initReactI18next).init({
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
  },
  lng: getInitialLanguage(getStoredLanguage()),
  resources,
})

/* Assistive tech pronounces the whole window in `documentElement.lang`; the static value in
   index.html is only correct for one of the three locales, so it has to follow the in-app language. */
function applyDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getInitialLanguage(language)
  }
}

applyDocumentLanguage(i18n.language)
i18n.on('languageChanged', applyDocumentLanguage)

export default i18n
