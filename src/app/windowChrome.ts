import { Effect, EffectState, type WindowOptions } from '@tauri-apps/api/window'
import type { Platform } from '../skin/platform'

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
