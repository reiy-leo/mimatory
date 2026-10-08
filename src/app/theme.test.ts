import { describe, expect, it } from 'vitest'
import { getInitialTheme, getInitialThemeColor, getThemeColor, themeColors } from './theme'

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

describe('theme colors', () => {
  it('uses all Tailwind 400 theme colors in the picker', () => {
    expect(themeColors.map((color) => color.name)).toEqual([
      'slate',
      'gray',
      'zinc',
      'neutral',
      'stone',
      'red',
      'orange',
      'amber',
      'yellow',
      'lime',
      'green',
      'emerald',
      'teal',
      'cyan',
      'sky',
      'blue',
      'indigo',
      'violet',
      'purple',
      'fuchsia',
      'pink',
      'rose',
    ])
  })

  it('falls back to slate when no valid theme color is saved', () => {
    expect(getInitialThemeColor(null)).toBe('slate')
    expect(getInitialThemeColor('olive')).toBe('slate')
    expect(getThemeColor('blue').value).toBe('#60a5fa')
  })
})
