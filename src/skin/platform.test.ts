import { describe, expect, it } from 'vitest'
import { detectPlatform, layoutForWidth, readOverrides, resolvePlatformState, skinForPlatform } from './platform'

const UA = {
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
}

describe('platform detection', () => {
  it('reads the user agent', () => {
    expect(detectPlatform({ userAgent: UA.mac })).toBe('macos')
    expect(detectPlatform({ userAgent: UA.iphone })).toBe('ios')
    expect(detectPlatform({ userAgent: UA.win })).toBe('windows')
    // Android's user agent says Linux too; Android wins.
    expect(detectPlatform({ userAgent: UA.android })).toBe('android')
    expect(detectPlatform({ userAgent: UA.linux })).toBe('linux')
    expect(detectPlatform({ userAgent: '' })).toBe('unknown')
  })

  it('tells iPadOS in desktop mode from a Mac by its touch points', () => {
    expect(detectPlatform({ maxTouchPoints: 5, userAgent: UA.mac })).toBe('ios')
    expect(detectPlatform({ maxTouchPoints: 0, userAgent: UA.mac })).toBe('macos')
  })

  it('maps platforms to skins the way Mindough does', () => {
    expect(skinForPlatform('macos')).toBe('apple')
    expect(skinForPlatform('ios')).toBe('apple')
    expect(skinForPlatform('windows')).toBe('winui')
    expect(skinForPlatform('android')).toBe('material')
    expect(skinForPlatform('linux')).toBe('material')
    expect(skinForPlatform('unknown')).toBe('material')
  })

  it('switches to the phone layout by width on every platform', () => {
    expect(layoutForWidth(390)).toBe('mobile')
    expect(layoutForWidth(760)).toBe('mobile')
    expect(layoutForWidth(761)).toBe('desktop')
  })

  it('takes debug overrides from the query string and ignores junk', () => {
    expect(readOverrides('?platform=windows&layout=mobile')).toEqual({
      layout: 'mobile',
      platform: 'windows',
      skin: undefined,
    })
    expect(readOverrides('?platform=beos&skin=aqua')).toEqual({
      layout: undefined,
      platform: undefined,
      skin: undefined,
    })
    expect(resolvePlatformState({ userAgent: UA.mac }, 1280, { platform: 'android' })).toEqual({
      layout: 'desktop',
      platform: 'android',
      skin: 'material',
    })
    expect(resolvePlatformState({ userAgent: UA.mac }, 1280, { skin: 'winui' }).skin).toBe('winui')
  })
})
