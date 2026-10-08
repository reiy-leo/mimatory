import { beforeEach, describe, expect, it } from 'vitest'
import {
  defaultSecurityPreferences,
  getAutoLockMilliseconds,
  loadSecurityPreferences,
  saveSecurityPreferences,
} from './securityPreferences'

describe('security preferences', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    })
  })

  it('loads secure defaults when no preferences exist', () => {
    expect(loadSecurityPreferences()).toEqual(defaultSecurityPreferences)
  })

  it('persists user preferences', () => {
    saveSecurityPreferences({
      ...defaultSecurityPreferences,
      autoLockIdleDuration: '5m',
      clearClipboardAfter90Seconds: true,
    })

    expect(loadSecurityPreferences()).toMatchObject({
      autoLockIdleDuration: '5m',
      clearClipboardAfter90Seconds: true,
    })
  })

  it('maps auto-lock duration to milliseconds', () => {
    expect(getAutoLockMilliseconds('1m')).toBe(60_000)
    expect(getAutoLockMilliseconds('1h')).toBe(3_600_000)
    expect(getAutoLockMilliseconds('never')).toBeNull()
  })
})
