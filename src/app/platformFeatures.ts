import type { Platform } from '../skin/platform'

/**
 * What exists on which platform. Everything platform-specific in the UI asks this table instead of testing a
 * platform name inline, so a new platform is one row here (and the Rust side gates the same features with
 * `#[cfg(desktop)]` / `cfg(target_os)`; see AGENTS.md "Platforms").
 */
export interface PlatformFeatures {
  /** File attachments: the native picker (rfd) is desktop-only. */
  attachments: boolean
  /** Launch at login (tauri-plugin-autostart): desktop only. */
  autostart: boolean
  /** Which biometric unlock the lock screen offers, if any. */
  biometrics: 'touch-id' | 'biometrics' | null
  /** The browser extension's loopback bridge on 127.0.0.1:17891: desktop only. */
  browserExtension: boolean
  /** The ⌘/Ctrl shortcuts are meaningful (a hardware keyboard is the norm). */
  keyboardShortcuts: boolean
  /** Quick Access: a tray + overlay window, desktop only. How it is summoned differs (see quickAccessKeys). */
  quickAccess: boolean
  /** Settings open in their own window on desktop; on phones they are a tab inside the one window. */
  settingsWindow: boolean
  /** The window draws no title bar of its own (Linux under Hyprland), so the app offers its own close. */
  undecoratedWindows: boolean
}

const desktop: PlatformFeatures = {
  attachments: true,
  autostart: true,
  biometrics: null,
  browserExtension: true,
  keyboardShortcuts: true,
  quickAccess: true,
  settingsWindow: true,
  undecoratedWindows: false,
}

const phone: PlatformFeatures = {
  attachments: false,
  autostart: false,
  biometrics: 'biometrics',
  browserExtension: false,
  keyboardShortcuts: false,
  quickAccess: false,
  settingsWindow: false,
  undecoratedWindows: false,
}

export function featuresFor(platform: Platform): PlatformFeatures {
  switch (platform) {
    case 'macos':
      return { ...desktop, biometrics: 'touch-id' }
    case 'windows':
      return desktop
    case 'linux':
      return { ...desktop, undecoratedWindows: true }
    case 'ios':
    case 'android':
      return phone
    default:
      // A plain browser (the Vite preview): show everything, as on the Mac.
      return { ...desktop, biometrics: 'touch-id' }
  }
}

/** ⌘ on Apple platforms, Ctrl everywhere else. */
export function usesCommandKey(platform: Platform): boolean {
  return platform === 'macos' || platform === 'ios' || platform === 'unknown'
}

export function isPrimaryModifier(event: { ctrlKey: boolean; metaKey: boolean }, platform: Platform): boolean {
  return usesCommandKey(platform) ? event.metaKey : event.ctrlKey
}

/** A shortcut written once as `mod+<key>` (`mod+,`, `mod+shift+Space`) in the platform's own notation. */
export function shortcutLabel(shortcut: string, platform: Platform): string {
  const parts = shortcut.split('+').map((part) => (part.length === 1 ? part.toUpperCase() : part))
  if (usesCommandKey(platform)) {
    return parts.map((part) => (part === 'mod' ? '⌘' : part === 'shift' ? '⇧' : part === 'alt' ? '⌥' : part)).join(' ')
  }
  return parts
    .map((part) => (part === 'mod' ? 'Ctrl' : part === 'shift' ? 'Shift' : part === 'alt' ? 'Alt' : part))
    .join('+')
}

/**
 * How Quick Access is summoned: a global hotkey on macOS and Windows; on Linux the compositor owns global keys,
 * so the user binds `passless --quick-access` (Hyprland: `bind = SUPER SHIFT, SPACE, exec, passless
 * --quick-access`) and the running app toggles the panel. Null where there is no Quick Access.
 */
export function quickAccessKeys(platform: Platform): string | null {
  if (!featuresFor(platform).quickAccess) return null
  if (platform === 'linux') return 'passless --quick-access'
  return shortcutLabel('mod+shift+Space', platform)
}
