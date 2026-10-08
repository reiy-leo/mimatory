import { describe, expect, it } from 'vitest'
import { getLockScreenVariant, shouldShowTouchIdUnlock } from './lockScreen'

describe('lock screen presentation', () => {
  it('uses the compact unlock control for locked vaults', () => {
    expect(getLockScreenVariant('locked')).toBe('compact-unlock')
  })

  it('keeps setup mode in the full creation flow', () => {
    expect(getLockScreenVariant('setup')).toBe('setup')
  })

  it('shows Touch ID only when biometrics and an unlock preference are enabled', () => {
    expect(shouldShowTouchIdUnlock(true, true, false)).toBe(true)
    expect(shouldShowTouchIdUnlock(true, false, true)).toBe(true)
    expect(shouldShowTouchIdUnlock(false, true, true)).toBe(false)
    expect(shouldShowTouchIdUnlock(true, false, false)).toBe(false)
  })
})
