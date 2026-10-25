import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import ja from './locales/ja'
import zh from './locales/zh'

/*
 * The UI languages, in the order the Settings picker lists them (after "Follow System"). A new language needs
 * its bundle in `locales/<code>.ts`, an entry here and in `languageNames`, the Rust table (`native_i18n.rs`) and
 * an extension `_locales` folder — see AGENTS.md "Adding a language". `pt` is Brazilian Portuguese (pt-PT and
 * bare pt resolve to it); `zh` is Simplified Chinese.
 */
export const supportedLanguages = ['en', 'zh', 'ja'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

/** What Settings stores: a language the user picked, or `system` (the default) to follow the OS. */
export type LanguagePreference = SupportedLanguage | 'system'

export const languageStorageKey = 'mimatory-language'

/** Each language in its own name, the way the macOS and Windows language pickers write them. */
export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  ja: '日本語',
  zh: '简体中文',
}

export const languageOptions: Array<{ value: SupportedLanguage; label: string }> = supportedLanguages.map((value) => ({
  label: languageNames[value],
  value,
}))

function isSupported(value: string | null | undefined): value is SupportedLanguage {
  return supportedLanguages.includes(value as SupportedLanguage)
}

/**
 * One OS / browser language tag (`de-AT`, `pt_PT.UTF-8`, `zh-Hans-SG`) → a UI language, or null when there is
 * none for it. Every `zh*` reads Simplified Chinese (there is no Traditional bundle; it is closer than English),
 * every `pt*` Brazilian Portuguese, and the legacy `in` code Indonesian.
 */
export function matchLanguage(tag: string): SupportedLanguage | null {
  const primary = tag
    .trim()
    .split(/[-_.@]/)[0]
    ?.toLowerCase()
  if (!primary) return null
  if (primary === 'in') return matchLanguage('id')
  return isSupported(primary) ? primary : null
}

/** The first of the system's preferred languages the app speaks; English when it speaks none of them. */
export function resolveSystemLanguage(tags: readonly string[]): SupportedLanguage {
  for (const tag of tags) {
    const match = matchLanguage(tag)
    if (match) return match
  }
  return 'en'
}

/*
 * The OS's preferred languages. The webview's navigator.languages is the first guess; in the app the Rust side
 * reports the OS list itself (`system_locales`, read through sys-locale), because a macOS WKWebView answers with
 * the bundle's localizations rather than the user's list.
 */
let nativeSystemTags: string[] | null = null

export function systemLanguageTags(): string[] {
  if (nativeSystemTags?.length) return nativeSystemTags
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  if (!nav) return []
  return nav.languages?.length ? [...nav.languages] : nav.language ? [nav.language] : []
}

/** A stored value → the preference. Nothing stored (or something unknown) means follow the system. */
export function readLanguagePreference(value: string | null): LanguagePreference {
  return isSupported(value) ? value : 'system'
}

export function resolveLanguage(
  preference: LanguagePreference,
  tags: readonly string[] = systemLanguageTags(),
): SupportedLanguage {
  return preference === 'system' ? resolveSystemLanguage(tags) : preference
}

/** A stored preference or a language code → the language the UI shows. */
export function getInitialLanguage(value: string | null): SupportedLanguage {
  return resolveLanguage(readLanguagePreference(value))
}

export function getStoredLanguagePreference(): LanguagePreference {
  try {
    return readLanguagePreference(globalThis.localStorage?.getItem(languageStorageKey) ?? null)
  } catch {
    return 'system'
  }
}

/*
 * Only an explicit pick is stored: nothing under the key is "follow the system" (an install from before
 * 2026-10-25 that never opened the picker had nothing stored and silently read Chinese; it now follows the OS,
 * while one that picked a language keeps it).
 */
function storeLanguagePreference(preference: LanguagePreference): void {
  try {
    if (preference === 'system') globalThis.localStorage?.removeItem(languageStorageKey)
    else globalThis.localStorage?.setItem(languageStorageKey, preference)
  } catch {
    // No storage (a locked-down webview): the choice lasts until the window closes.
  }
}

/** Stores the preference and switches this window to it. Returns the language now shown. */
export async function applyLanguagePreference(preference: LanguagePreference): Promise<SupportedLanguage> {
  storeLanguagePreference(preference)
  const language = resolveLanguage(preference)
  if (i18n.language !== language) await i18n.changeLanguage(language)
  return language
}

const resources = {
  en: { translation: en },
  ja: { translation: ja },
  zh: { translation: zh },
}

void i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  lng: resolveLanguage(getStoredLanguagePreference()),
  resources,
})

/* Following the system: re-resolve whenever the OS list may have changed. The webview fires `languagechange`
   where it can; the app also re-reads the OS list from Rust at startup and whenever the window regains focus
   (System Settings ▸ Language is a different app, so coming back is when a change shows up). */
function followSystemLanguage(): void {
  if (getStoredLanguagePreference() !== 'system') return
  const language = resolveSystemLanguage(systemLanguageTags())
  if (i18n.language !== language) void i18n.changeLanguage(language)
}

async function refreshNativeSystemTags(): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const tags = await invoke<string[]>('system_locales')
    if (Array.isArray(tags) && tags.length) nativeSystemTags = tags
  } catch {
    // An older backend without the command: navigator.languages stands in.
  }
  followSystemLanguage()
}

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', followSystemLanguage)
  window.addEventListener('focus', () => void refreshNativeSystemTags())
  void refreshNativeSystemTags()
}

/* Assistive tech pronounces the whole window in `documentElement.lang`; the static value in
   index.html is only correct for one locale, so it has to follow the in-app language. */
function applyDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = isSupported(language) ? language : 'en'
  }
}

applyDocumentLanguage(i18n.language)
i18n.on('languageChanged', applyDocumentLanguage)

export default i18n
