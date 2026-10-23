import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { currentPlatformState } from '../skin/runtime'
import i18n, { getInitialLanguage, type SupportedLanguage } from './i18n'
import { loadSecurityPreferences, type SecurityPreferences, saveSecurityPreferences } from './securityPreferences'
import { applyTheme, getInitialTheme, type Theme } from './theme'
import { syncWindowTheme } from './windowChrome'

/**
 * What the window follows from Settings: the appearance, the language and the security preferences, applied
 * here and kept in step when another window changes them (moved out of App.tsx 2026-10-23).
 */
export function useWindowAppearance() {
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme(localStorage.getItem('passless-theme')))
  const [, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('passless-language')),
  )

  useEffect(() => {
    localStorage.setItem('passless-theme', theme)
    syncWindowTheme(theme, currentPlatformState().platform)
    return applyTheme(theme)
  }, [theme])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<Theme>('passless-theme-changed', (event) => setTheme(event.payload)).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SupportedLanguage>('passless-language-changed', (event) => {
      setLanguage(event.payload)
      localStorage.setItem('passless-language', event.payload)
      void i18n.changeLanguage(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SecurityPreferences>('passless-security-preferences-changed', (event) => {
      setSecurityPreferences(event.payload)
      saveSecurityPreferences(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  return { securityPreferences, setLanguage, setSecurityPreferences, setTheme, theme }
}
