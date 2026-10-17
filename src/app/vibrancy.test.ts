import { describe, expect, it } from 'vitest'
import { hasNativeVibrancy, nativeWindowMaterial } from './vibrancy'

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

describe('nativeWindowMaterial', () => {
  it('is vibrancy on the Mac and Mica on Windows, only inside Tauri', () => {
    expect(nativeWindowMaterial({ isTauri: true, platform: 'MacIntel', userAgent: '' })).toBe('vibrancy')
    expect(nativeWindowMaterial({ isTauri: true, platform: 'Win32', userAgent: 'Windows NT 10.0' })).toBe('mica')
    expect(nativeWindowMaterial({ isTauri: false, platform: 'Win32', userAgent: 'Windows NT 10.0' })).toBeNull()
  })

  it('is nothing on Linux and on the phones', () => {
    expect(nativeWindowMaterial({ isTauri: true, platform: 'Linux x86_64', userAgent: 'X11; Linux' })).toBeNull()
    expect(nativeWindowMaterial({ isTauri: true, platform: 'iPhone', userAgent: 'iPhone OS 18_0' })).toBeNull()
    expect(
      nativeWindowMaterial({ isTauri: true, maxTouchPoints: 5, platform: 'MacIntel', userAgent: 'Macintosh' }),
    ).toBeNull()
    expect(nativeWindowMaterial({ isTauri: true, platform: 'Linux armv8l', userAgent: 'Android 15' })).toBeNull()
  })
})
