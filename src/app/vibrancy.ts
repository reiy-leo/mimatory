/**
 * Native window vibrancy (macOS NSVisualEffectView) is configured on the Tauri side: the main window via
 * `windowEffects` in tauri.conf.json, settings at creation in App.tsx, Quick Access in shell.rs. Those windows
 * are transparent, so the page has to stop painting an opaque window background behind the sidebar for the
 * material to show through. This flags the document so CSS can do that only where the material exists —
 * in a browser (the Vite preview, tests) the CSS material and solid fallbacks stay in charge.
 */
export function hasNativeVibrancy(env: { isTauri: boolean; platform: string; userAgent: string }): boolean {
  if (!env.isTauri) return false
  return /mac/i.test(env.platform) || /Macintosh|Mac OS X/.test(env.userAgent)
}

export function applyNativeVibrancyFlag(root: HTMLElement = document.documentElement) {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (hasNativeVibrancy({ isTauri, platform: navigator.platform ?? '', userAgent: navigator.userAgent })) {
    root.dataset.vibrancy = 'native'
  }
}
