export type DeviceUnlockDuration = 'off' | '10m' | '1h' | '4h' | '8h' | '1d' | '7d' | '14d' | '30d' | 'always'
export type AccountPasswordRequirement = '1d' | '7d' | '14d' | '30d' | '90d' | '180d' | 'never'
export type AutoLockIdleDuration = '1m' | '2m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h' | '8h' | 'never'

export type SecurityPreferences = {
  unlockUsingTouchId: boolean
  unlockWithMacPassword: boolean
  deviceUnlockDuration: DeviceUnlockDuration
  accountPasswordRequirement: AccountPasswordRequirement
  lockWhenDeviceLocks: boolean
  autoLockIdleDuration: AutoLockIdleDuration
  clearClipboardAfter90Seconds: boolean
  useUniversalClipboard: boolean
}

export const defaultSecurityPreferences: SecurityPreferences = {
  accountPasswordRequirement: 'never',
  autoLockIdleDuration: '1h',
  clearClipboardAfter90Seconds: false,
  deviceUnlockDuration: 'always',
  lockWhenDeviceLocks: true,
  unlockUsingTouchId: true,
  unlockWithMacPassword: true,
  useUniversalClipboard: true,
}

const storageKey = 'passless-security-preferences'

export const deviceUnlockOptions: DeviceUnlockDuration[] = [
  'off',
  '10m',
  '1h',
  '4h',
  '8h',
  '1d',
  '7d',
  '14d',
  '30d',
  'always',
]
export const accountPasswordOptions: AccountPasswordRequirement[] = ['1d', '7d', '14d', '30d', '90d', '180d', 'never']
export const autoLockIdleOptions: AutoLockIdleDuration[] = [
  '1m',
  '2m',
  '5m',
  '10m',
  '15m',
  '30m',
  '1h',
  '4h',
  '8h',
  'never',
]

export function getAutoLockMilliseconds(duration: AutoLockIdleDuration): number | null {
  const minutesByDuration: Record<AutoLockIdleDuration, number | null> = {
    '1h': 60,
    '1m': 1,
    '2m': 2,
    '4h': 240,
    '5m': 5,
    '8h': 480,
    '10m': 10,
    '15m': 15,
    '30m': 30,
    never: null,
  }
  const minutes = minutesByDuration[duration]
  return minutes === null ? null : minutes * 60 * 1000
}

export function loadSecurityPreferences(): SecurityPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return defaultSecurityPreferences
    const parsed = JSON.parse(raw) as Partial<SecurityPreferences>
    return {
      ...defaultSecurityPreferences,
      ...parsed,
    }
  } catch {
    return defaultSecurityPreferences
  }
}

export function saveSecurityPreferences(preferences: SecurityPreferences) {
  globalThis.localStorage?.setItem(storageKey, JSON.stringify(preferences))
}
