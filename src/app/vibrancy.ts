/**
 * Native window materials. macOS: NSVisualEffectView vibrancy, configured on the Tauri side (the main window
 * via `windowEffects` in tauri.macos.conf.json, settings at creation in App.tsx, Quick Access in shell.rs).
 * Windows 11: Mica on the main and settings windows (tauri.windows.conf.json / App.tsx) and Acrylic on Quick
 * Access, the WinUI 3 materials. Those windows are transparent, so the page has to stop painting an opaque
 * window background where the material should show. This flags the document so CSS can do that only where the
 * material exists — in a browser (the Vite preview, tests) the CSS materials and solid fallbacks stay in charge.
 * Linux gets neither: Hyprland blurs behind a window itself, and the page stays opaque.
 */
export type WindowMaterial = 'vibrancy' | 'mica' | null

interface MaterialEnv {
  isTauri: boolean
  /** iPadOS reports itself as a Mac; only its touch points give it away. */
  maxTouchPoints?: number
  platform: string
  userAgent: string
}

export function hasNativeVibrancy(env: MaterialEnv): boolean {
  if (!env.isTauri) return false
  return /mac/i.test(env.platform) || /Macintosh|Mac OS X/.test(env.userAgent)
}

export function nativeWindowMaterial(env: MaterialEnv): WindowMaterial {
  if (!env.isTauri) return null
  // iOS and iPadOS (which reports a Mac user agent and platform) have no window material.
  if ((env.maxTouchPoints ?? 0) > 1 || /iphone|ipad|ipod/i.test(env.platform) || /iPhone|iPad/.test(env.userAgent)) {
    return null
  }
  if (hasNativeVibrancy(env)) return 'vibrancy'
  if (/win/i.test(env.platform) || /Windows NT/.test(env.userAgent)) return 'mica'
  return null
}

export function applyNativeVibrancyFlag(root: HTMLElement = document.documentElement) {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const material = nativeWindowMaterial({
    isTauri,
    maxTouchPoints: navigator.maxTouchPoints,
    platform: navigator.platform ?? '',
    userAgent: navigator.userAgent,
  })
  if (material === 'vibrancy') root.dataset.vibrancy = 'native'
  if (material === 'mica') root.dataset.windowMaterial = 'mica'
}
