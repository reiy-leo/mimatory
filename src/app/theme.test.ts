import { describe, expect, it, vi } from 'vitest'
import { clearLegacyThemeOverride, legacyThemeStorageKey, resolveAppearance } from './theme'

describe('resolveAppearance', () => {
  it('follows the system preference', () => {
    expect(resolveAppearance(true)).toBe('dark')
    expect(resolveAppearance(false)).toBe('light')
  })
})

describe('clearLegacyThemeOverride', () => {
  it('deletes the stored Light / Dark choice an older build wrote', () => {
    const removeItem = vi.fn()
    clearLegacyThemeOverride({ removeItem })
    expect(removeItem).toHaveBeenCalledWith(legacyThemeStorageKey)
    expect(legacyThemeStorageKey).toBe('passless-theme')
  })

  it('does not throw when storage is unavailable', () => {
    expect(() =>
      clearLegacyThemeOverride({
        removeItem: () => {
          throw new Error('denied')
        },
      }),
    ).not.toThrow()
  })
})
