import { openUrl } from '@tauri-apps/plugin-opener'

/** Only these schemes leave the app; the opener capability allows the same set (`opener:allow-default-urls`). */
const externalSchemes = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function isOpenableUrl(value: string): boolean {
  try {
    return externalSchemes.has(new URL(value).protocol)
  } catch {
    return false
  }
}

function inTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Opens a stored URL in the user's default browser. WKWebView ignores `target="_blank"`, so inside the app the
 * click is handed to tauri-plugin-opener; in a browser preview the plain link does the work.
 * Returns true when it took over the click.
 */
export function openExternal(value: string, opener: (url: string) => Promise<void> = openUrl): boolean {
  if (!inTauri() || !isOpenableUrl(value)) return false
  void opener(value).catch((error: unknown) => console.error('Could not open URL', error))
  return true
}
