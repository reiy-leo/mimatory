/**
 * Platform detection and skin choice — the same mapping Mindough uses (apps/client/src/skin/platform.ts):
 * macOS and iOS wear the Apple skin, Windows the WinUI 3 (Windows 11) skin, Android and Linux the Material 3
 * skin. Layout follows the width, not the platform: at 760px and below every platform gets the phone layout
 * (bottom tab bar, one pane at a time), so a tiled Hyprland column or a narrow Windows snap gets it too.
 *
 * `?platform=` / `?skin=` / `?layout=` override the detection for screenshots and debugging only; nothing
 * persists them.
 */
export type Platform = 'macos' | 'ios' | 'windows' | 'android' | 'linux' | 'unknown'
export type Skin = 'apple' | 'winui' | 'material'
export type LayoutKind = 'desktop' | 'mobile'

export interface NavigatorLike {
  maxTouchPoints?: number
  platform?: string
  userAgent: string
  userAgentData?: { platform?: string }
}

export function detectPlatform(nav: NavigatorLike): Platform {
  const ua = nav.userAgent || ''
  const hint = (nav.userAgentData?.platform || nav.platform || '').toLowerCase()
  if (/android/i.test(ua) || hint === 'android') return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  // iPadOS 13+ asks for the desktop site with a macOS user agent; only the touch points tell them apart.
  if (/macintosh|mac os x/i.test(ua) || hint.startsWith('mac')) return (nav.maxTouchPoints ?? 0) > 1 ? 'ios' : 'macos'
  if (/windows/i.test(ua) || hint.startsWith('win')) return 'windows'
  if (/linux|cros|x11|wayland/i.test(ua) || hint.includes('linux') || hint === 'chrome os') return 'linux'
  return 'unknown'
}

/** macOS / iOS → Apple; Windows → WinUI; Android, Linux and anything unknown → Material (as in Mindough). */
export function skinForPlatform(platform: Platform): Skin {
  if (platform === 'macos' || platform === 'ios') return 'apple'
  if (platform === 'windows') return 'winui'
  return 'material'
}

/** Phones and narrow windows: at or under this width the app shows one pane at a time. */
export const MOBILE_MAX_WIDTH = 760

export function layoutForWidth(width: number): LayoutKind {
  return width <= MOBILE_MAX_WIDTH ? 'mobile' : 'desktop'
}

export function isMobilePlatform(platform: Platform): boolean {
  return platform === 'ios' || platform === 'android'
}

const platforms: Platform[] = ['macos', 'ios', 'windows', 'android', 'linux', 'unknown']
const skins: Skin[] = ['apple', 'winui', 'material']
const layouts: LayoutKind[] = ['desktop', 'mobile']

export interface PlatformOverrides {
  layout?: LayoutKind
  platform?: Platform
  skin?: Skin
}

/** Reads the debug overrides out of a query string (`?platform=windows&layout=mobile`). */
export function readOverrides(search: string): PlatformOverrides {
  const params = new URLSearchParams(search)
  const platform = params.get('platform') as Platform | null
  const skin = params.get('skin') as Skin | null
  const layout = params.get('layout') as LayoutKind | null
  return {
    layout: layout && layouts.includes(layout) ? layout : undefined,
    platform: platform && platforms.includes(platform) ? platform : undefined,
    skin: skin && skins.includes(skin) ? skin : undefined,
  }
}

export interface PlatformState {
  layout: LayoutKind
  platform: Platform
  skin: Skin
}

export function resolvePlatformState(nav: NavigatorLike, width: number, overrides: PlatformOverrides): PlatformState {
  const platform = overrides.platform ?? detectPlatform(nav)
  return {
    layout: overrides.layout ?? layoutForWidth(width),
    platform,
    skin: overrides.skin ?? skinForPlatform(platform),
  }
}
