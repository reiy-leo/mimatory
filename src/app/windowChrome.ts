import { Effect, EffectState, getCurrentWindow, type WindowOptions } from '@tauri-apps/api/window'
import type { Platform } from '../skin/platform'
import type { Theme } from './theme'

/**
 * The settings window's chrome per platform, mirroring the main window's tauri.<platform>.conf.json:
 * macOS keeps the overlay title bar over a transparent window wearing the sidebar material; Windows 11 keeps
 * its native title bar over Mica; Linux draws no decorations (Hyprland has no server-side title bar, and a GTK
 * client-side one would fight the tiling), so the settings view brings its own close button there.
 */
export function settingsWindowChrome(platform: Platform): Partial<WindowOptions> {
  switch (platform) {
    case 'windows':
      return {
        decorations: true,
        transparent: true,
        windowEffects: { effects: [Effect.Mica] },
      }
    case 'linux':
      return { decorations: false }
    default:
      return {
        decorations: true,
        hiddenTitle: true,
        titleBarStyle: 'overlay',
        // Native sidebar material behind the settings sidebar; the content pane stays opaque in CSS.
        transparent: true,
        windowEffects: { effects: [Effect.Sidebar], state: EffectState.FollowsWindowActiveState },
      }
  }
}

/**
 * Windows draws its own title bar (and Mica) and GTK its own window theme, so an in-app Light/Dark override
 * has to reach the native window too or the chrome stays in the system appearance around a page that does
 * not. macOS is left to follow the system, as it always has (see .agent/todo.md, vibrancy check).
 */
export function syncWindowTheme(theme: Theme, platform: Platform) {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
  if (platform !== 'windows' && platform !== 'linux') return
  void getCurrentWindow()
    .setTheme(theme === 'system' ? null : theme)
    .catch(() => {})
}
