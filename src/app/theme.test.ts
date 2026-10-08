import { describe, expect, it } from 'vitest'
import { getInitialTheme } from './theme'

describe('getInitialTheme', () => {
  it('uses the saved theme when it is valid', () => {
    expect(getInitialTheme('dark', false)).toBe('dark')
    expect(getInitialTheme('light', true)).toBe('light')
  })

  it('falls back to the system preference when no valid saved theme exists', () => {
    expect(getInitialTheme(null, true)).toBe('dark')
    expect(getInitialTheme('invalid', false)).toBe('light')
  })
})
