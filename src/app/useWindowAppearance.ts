import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { applyLanguagePreference, getStoredLanguagePreference, type LanguagePreference } from './i18n'
import { followLanguageInNativeUi } from './nativeLocale'
import { loadSecurityPreferences, type SecurityPreferences, saveSecurityPreferences } from './securityPreferences'
import { clearLegacyThemeOverride, followSystemAppearance } from './theme'
import { followLanguageInTitle } from './windowTitle'

/**
 * What the window follows: the system appearance, and from Settings the language and the security preferences, applied
 * here and kept in step when another window changes them (moved out of App.tsx 2026-10-23).
 */
export function useWindowAppearance() {
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [, setLanguage] = useState<LanguagePreference>(() => getStoredLanguagePreference())

  // The appearance is the system's, always; an override an older build stored is dropped on the way in.
  useEffect(() => {
    clearLegacyThemeOverride()
    return followSystemAppearance()
  }, [])

  // The main window's title is the app's name in the UI language (密码库存 in zh).
  useEffect(() => followLanguageInTitle('settings.appName'), [])
  // …and so are the tray, the macOS menu bar and the other Rust-built labels.
  useEffect(() => followLanguageInNativeUi(), [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<LanguagePreference>('mimatory-language-changed', (event) => {
      setLanguage(event.payload)
      void applyLanguagePreference(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SecurityPreferences>('mimatory-security-preferences-changed', (event) => {
      setSecurityPreferences(event.payload)
      saveSecurityPreferences(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  return { securityPreferences, setLanguage, setSecurityPreferences }
}
