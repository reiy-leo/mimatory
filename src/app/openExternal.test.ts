import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOpenableUrl, openExternal } from './openExternal'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }))

describe('isOpenableUrl', () => {
  it('allows web, mail and phone links only', () => {
    expect(isOpenableUrl('https://example.com/login')).toBe(true)
    expect(isOpenableUrl('http://192.168.1.1')).toBe(true)
    expect(isOpenableUrl('mailto:a@b.c')).toBe(true)
    expect(isOpenableUrl('tel:+6512345678')).toBe(true)
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false)
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false)
    expect(isOpenableUrl('example.com')).toBe(false)
  })
})

describe('openExternal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves the click to the link outside Tauri', () => {
    vi.stubGlobal('window', {})
    const opener = vi.fn(() => Promise.resolve())
    expect(openExternal('https://example.com', opener)).toBe(false)
    expect(opener).not.toHaveBeenCalled()
  })

  it('hands openable URLs to the opener inside Tauri', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    const opener = vi.fn(() => Promise.resolve())
    expect(openExternal('https://example.com', opener)).toBe(true)
    expect(opener).toHaveBeenCalledWith('https://example.com')
    expect(openExternal('file:///tmp/x', opener)).toBe(false)
  })
})
