import { describe, expect, it } from 'vitest'
import { formatOtpCode, getTotpProgress } from './totpDisplay'

describe('totp display helpers', () => {
  it('formats six digit OTP codes in two groups', () => {
    expect(formatOtpCode('423598')).toBe('423 • 598')
  })

  it('keeps non-standard OTP codes readable', () => {
    expect(formatOtpCode('12345678')).toBe('12345678')
  })

  it('normalizes countdown progress across a thirty second TOTP window', () => {
    expect(getTotpProgress(30)).toBe(1)
    expect(getTotpProgress(15)).toBe(0.5)
    expect(getTotpProgress(0)).toBe(0)
    expect(getTotpProgress(45)).toBe(1)
  })
})
