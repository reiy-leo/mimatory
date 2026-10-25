import i18n, { getInitialLanguage } from './i18n'
import { vaultApi } from './vaultApi'

/**
 * Tells Rust the in-app language, now and on every change, so the UI it builds itself — the tray menu and
 * tooltip, the macOS menu bar, native picker titles, the Touch ID prompt — follows it (`native_i18n.rs`; the
 * app's name is 密码库存 in zh, Mimatory in en/ja). The main window reports for the app: a change made in
 * Settings reaches it through `mimatory-language-changed`. Until the first report Rust uses the OS locale.
 * Returns the unsubscribe.
 */
export function followLanguageInNativeUi(): () => void {
  const report = (language: string) => {
    if ('__TAURI_INTERNALS__' in window) void vaultApi.setNativeLocale(getInitialLanguage(language)).catch(() => {})
  }
  report(i18n.language)
  i18n.on('languageChanged', report)
  return () => i18n.off('languageChanged', report)
}
