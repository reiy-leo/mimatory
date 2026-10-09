import { describe, expect, it } from 'vitest'
import { clipboardImageFile, otpSecretFromQrText } from './otpQrImport'

const secret = 'JBSWYDKOABCDEFGH'

describe('otpSecretFromQrText', () => {
  it('takes the seed out of a setup link', () => {
    expect(otpSecretFromQrText(`otpauth://totp/Hark:me@example.com?secret=${secret}&issuer=Hark`)).toBe(secret)
  })

  it('uppercases and unpads a seed that the link encoded loosely', () => {
    expect(otpSecretFromQrText(`otpauth://totp/Hark?secret=jbswydkoabcdefgh%3D%3D`)).toBe(secret)
  })

  it('accepts a bare key when the enrolment page printed one', () => {
    expect(otpSecretFromQrText(`${secret.slice(0, 8)} ${secret.slice(8)}`)).toBe(secret)
  })

  it('refuses a link whose host is malformed rather than guessing at it', () => {
    expect(otpSecretFromQrText(`otpauth://:80?secret=${secret}`)).toBeNull()
  })

  it('refuses anything that is not a seed', () => {
    expect(otpSecretFromQrText('https://example.com/login')).toBeNull()
    expect(otpSecretFromQrText('otpauth://totp/Hark')).toBeNull()
    expect(otpSecretFromQrText('ABC2')).toBeNull()
    expect(otpSecretFromQrText('   ')).toBeNull()
  })
})

function eventWithItems(items: Array<{ getAsFile: () => File | null; kind: string; type: string }>) {
  return { clipboardData: { items } as unknown as DataTransfer }
}

describe('clipboardImageFile', () => {
  it('returns the image a paste carried', () => {
    const file = new File(['x'], 'qr.png', { type: 'image/png' })
    expect(clipboardImageFile(eventWithItems([{ getAsFile: () => file, kind: 'file', type: 'image/png' }]))).toBe(file)
  })

  it('skips the text that comes along with an image', () => {
    const file = new File(['x'], 'qr.png', { type: 'image/png' })
    expect(
      clipboardImageFile(
        eventWithItems([
          { getAsFile: () => null, kind: 'string', type: 'text/plain' },
          { getAsFile: () => file, kind: 'file', type: 'image/png' },
        ]),
      ),
    ).toBe(file)
  })

  it('returns nothing for a text-only paste', () => {
    expect(
      clipboardImageFile(eventWithItems([{ getAsFile: () => null, kind: 'string', type: 'text/plain' }])),
    ).toBeNull()
    expect(clipboardImageFile({ clipboardData: null })).toBeNull()
  })
})
