import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import i18n, { getInitialLanguage, type SupportedLanguage } from './i18n'
import { loadSecurityPreferences, type SecurityPreferences, saveSecurityPreferences } from './securityPreferences'
import { clearLegacyThemeOverride, followSystemAppearance } from './theme'

/**
 * What the window follows: the system appearance, and from Settings the language and the security preferences, applied
 * here and kept in step when another window changes them (moved out of App.tsx 2026-10-23).
 */
export function useWindowAppearance() {
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('mimatory-language')),
  )

  // The appearance is the system's, always; an override an older build stored is dropped on the way in.
  useEffect(() => {
    clearLegacyThemeOverride()
    return followSystemAppearance()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SupportedLanguage>('mimatory-language-changed', (event) => {
      setLanguage(event.payload)
      localStorage.setItem('mimatory-language', event.payload)
      void i18n.changeLanguage(event.payload)
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
