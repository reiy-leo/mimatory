import { describe, expect, it } from 'vitest'
import { getInitialTheme, resolveAppearance, themeOptions } from './theme'

describe('getInitialTheme', () => {
  it('uses the saved theme when it is valid', () => {
    expect(getInitialTheme('dark')).toBe('dark')
    expect(getInitialTheme('light')).toBe('light')
    expect(getInitialTheme('system')).toBe('system')
  })

  it('follows the system when no valid saved theme exists', () => {
    expect(getInitialTheme(null)).toBe('system')
    expect(getInitialTheme('invalid')).toBe('system')
  })
})

describe('resolveAppearance', () => {
  it('reads the system preference only for the system theme', () => {
    expect(resolveAppearance('system', true)).toBe('dark')
    expect(resolveAppearance('system', false)).toBe('light')
    expect(resolveAppearance('light', true)).toBe('light')
    expect(resolveAppearance('dark', false)).toBe('dark')
  })

  it('offers system first', () => {
    expect(themeOptions[0]).toBe('system')
  })
})
