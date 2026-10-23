import { getCurrentWindow } from '@tauri-apps/api/window'
import i18n from './i18n'

/**
 * Titles the current window from an i18n key and keeps it in step with the UI language: the app's name reads
 * 密码库存 in zh and Mimatory otherwise (owner, 2026-10-24) — what the Windows title bar, the taskbar and a Hyprland
 * bar show. Quick Access never calls this: Hyprland float rules match its fixed English title (shell.rs).
 * Returns the unsubscribe.
 */
export function followLanguageInTitle(key: 'settings.appName' | 'settings.windowTitle'): () => void {
  const applyTitle = () => {
    const title = i18n.t(key)
    document.title = title
    if ('__TAURI_INTERNALS__' in window)
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {})
  }
  applyTitle()
  i18n.on('languageChanged', applyTitle)
  return () => i18n.off('languageChanged', applyTitle)
}
