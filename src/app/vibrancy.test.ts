import { describe, expect, it } from 'vitest'
import { hasNativeVibrancy } from './vibrancy'

describe('hasNativeVibrancy', () => {
  it('is on only inside Tauri on macOS', () => {
    expect(hasNativeVibrancy({ isTauri: true, platform: 'MacIntel', userAgent: '' })).toBe(true)
    expect(
      hasNativeVibrancy({ isTauri: true, platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)' }),
    ).toBe(true)
  })

  it('stays off in a browser and on other platforms', () => {
    expect(hasNativeVibrancy({ isTauri: false, platform: 'MacIntel', userAgent: 'Macintosh' })).toBe(false)
    expect(hasNativeVibrancy({ isTauri: true, platform: 'Win32', userAgent: 'Windows NT 10.0' })).toBe(false)
  })
})
