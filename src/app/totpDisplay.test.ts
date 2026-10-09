import { describe, expect, it } from 'vitest'
import {
  buildOtpAuthUri,
  formatOtpCode,
  getTotpProgress,
  normalizeTotpSecret,
  otpSecretFieldIndexes,
} from './totpDisplay'

describe('totp display helpers', () => {
  it('formats six digit OTP codes in two groups', () => {
    expect(formatOtpCode('423598')).toBe('423 598')
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

  it('strips the spacing and padding a pasted secret arrives with', () => {
    expect(normalizeTotpSecret(' jbsw ydko npbq g=== ')).toBe('JBSWYDKONPBQG')
  })

  it('reports which fields hold a secret without renumbering them', () => {
    expect(otpSecretFieldIndexes([{ field_type: 'text' }, { field_type: 'otp' }, { field_type: 'otp' }])).toEqual([
      1, 2,
    ])
    expect(otpSecretFieldIndexes([])).toEqual([])
  })

  it('builds a setup link another authenticator can read', () => {
    expect(buildOtpAuthUri({ account: 'me@example.com', issuer: 'GitHub Inc', secret: 'jbsw ydko npbq g' })).toBe(
      'otpauth://totp/GitHub%20Inc:me%40example.com?secret=JBSWYDKONPBQG&algorithm=SHA1&digits=6&period=30&issuer=GitHub%20Inc',
    )
  })

  it('leaves out the label and issuer when the login carries neither', () => {
    expect(buildOtpAuthUri({ account: '   ', issuer: '', secret: 'JBSWYDKO' })).toBe(
      'otpauth://totp/?secret=JBSWYDKO&algorithm=SHA1&digits=6&period=30',
    )
  })
})
