import { describe, expect, it } from 'vitest'
import {
  detectCardBrand,
  expiryStatus,
  fieldIssue,
  formatCardNumber,
  formatDate,
  formatIban,
  formatMonthYear,
  formatMonthYearInput,
  ibanValid,
  luhnValid,
  maskCardNumber,
  openableUrl,
  parseIsoDate,
  parseMonthYear,
  parseSshPublicKey,
  publicKeyFromOpenSshPrivateKey,
  sshFingerprint,
  sshKeyTypeOption,
  swiftValid,
  urlHostname,
} from './fieldFormats'

// A throwaway public key (no private half exists anywhere), checked against `ssh-keygen -lf -E sha256`.
const publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGUROBHbTQxZVCTUfsYzpzhL2rZTKazqH9Gu7acE/Wen deploy@example'
const publicKeyFingerprint = 'SHA256:vWF5su9tjnV25wEWC/Y1x+Hyk0eWc0Lacgo0hsDAXiI'

describe('card numbers', () => {
  it('detects the network from the issuer prefix', () => {
    expect(detectCardBrand('4242 4242 4242 4242')).toBe('visa')
    expect(detectCardBrand('5555555555554444')).toBe('mastercard')
    expect(detectCardBrand('2223003122003222')).toBe('mastercard')
    expect(detectCardBrand('378282246310005')).toBe('amex')
    expect(detectCardBrand('6011111111111117')).toBe('discover')
    expect(detectCardBrand('3530111333300000')).toBe('jcb')
    expect(detectCardBrand('6200000000000005')).toBe('unionpay')
    expect(detectCardBrand('30569309025904')).toBe('diners')
    expect(detectCardBrand('9999')).toBeNull()
    expect(detectCardBrand('')).toBeNull()
  })

  it('groups digits the way the network prints them', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('4242-4242 42')).toBe('4242 4242 42')
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005')
    expect(formatCardNumber('30569309025904')).toBe('3056 930902 5904')
    expect(formatCardNumber('4'.repeat(25))).toBe('4444 4444 4444 4444 444')
  })

  it('masks every digit but the last four, keeping the groups', () => {
    expect(maskCardNumber('4242 4242 4242 4242')).toBe('•••• •••• •••• 4242')
    expect(maskCardNumber('378282246310005')).toBe('•••• •••••• •0005')
    expect(maskCardNumber('123')).toBe('123')
  })

  it('checks the Luhn digit', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true)
    expect(luhnValid('4242 4242 4242 4241')).toBe(false)
    expect(luhnValid('')).toBe(false)
  })
})

describe('dates', () => {
  it('parses the month/year spellings people type', () => {
    expect(parseMonthYear('08/29')).toEqual({ month: 8, year: 2029 })
    expect(parseMonthYear('8/2029')).toEqual({ month: 8, year: 2029 })
    expect(parseMonthYear('2029-08')).toEqual({ month: 8, year: 2029 })
    expect(parseMonthYear('0829')).toEqual({ month: 8, year: 2029 })
    expect(parseMonthYear('13/29')).toBeNull()
    expect(parseMonthYear('soon')).toBeNull()
  })

  it('auto-formats a month/year while typing without fighting backspace', () => {
    expect(formatMonthYearInput('0')).toBe('0')
    expect(formatMonthYearInput('08')).toBe('08')
    expect(formatMonthYearInput('082')).toBe('08/2')
    expect(formatMonthYearInput('0829')).toBe('08/29')
    expect(formatMonthYearInput('8')).toBe('08')
    expect(formatMonthYearInput('08/2029')).toBe('08/2029')
  })

  it('accepts only real ISO days', () => {
    expect(parseIsoDate('2030-06-30')).toEqual({ day: 30, month: 6, year: 2030 })
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('30/06/2030')).toBeNull()
  })

  it('formats dates in the reader locale and leaves legacy text alone', () => {
    expect(formatDate('2030-06-30', 'en-US')).toBe('Jun 30, 2030')
    expect(formatDate('2030-06-30', 'zh')).toBe('2030年6月30日')
    expect(formatDate('2030-06-30', 'ja')).toBe('2030/06/30')
    expect(formatDate('next summer', 'en')).toBe('next summer')
    expect(formatMonthYear('08/29', 'en-US')).toBe('08/2029')
    expect(formatMonthYear('08/29', 'ja')).toBe('2029/08')
  })

  it('reports expired and expiring values', () => {
    const now = new Date(Date.UTC(2026, 9, 14, 12))
    expect(expiryStatus('09/26', 'month_year', now)).toBe('expired')
    // A card marked 10/26 still works through 31 October.
    expect(expiryStatus('10/26', 'month_year', now)).toBe('expiring')
    expect(expiryStatus('11/26', 'month_year', now)).toBe('expiring')
    expect(expiryStatus('12/26', 'month_year', now)).toBeNull()
    expect(expiryStatus('12/26', 'month_year', now, 90)).toBe('expiring')
    expect(expiryStatus('2026-10-13', 'date', now)).toBe('expired')
    expect(expiryStatus('2026-10-14', 'date', now)).toBe('expiring')
    expect(expiryStatus('2027-10-14', 'date', now)).toBeNull()
    expect(expiryStatus('whenever', 'date', now)).toBeNull()
  })
})

describe('web addresses', () => {
  it('opens only http(s) and adds a scheme to a bare host', () => {
    expect(openableUrl('github.com')).toBe('https://github.com/')
    expect(openableUrl('http://intranet.example/login')).toBe('http://intranet.example/login')
    expect(openableUrl('javascript:alert(1)')).toBeNull()
    expect(openableUrl('file:///etc/passwd')).toBeNull()
    expect(openableUrl('not a url')).toBeNull()
    expect(urlHostname('https://www.example.com/path?q=1')).toBe('www.example.com')
  })
})

describe('bank identifiers', () => {
  it('validates IBAN check digits and groups them', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true)
    expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false)
    expect(formatIban('gb82west12345698765432')).toBe('GB82 WEST 1234 5698 7654 32')
  })

  it('validates SWIFT/BIC shape', () => {
    expect(swiftValid('DEUTDEFF')).toBe(true)
    expect(swiftValid('deutdeff500')).toBe(true)
    expect(swiftValid('DEUT')).toBe(false)
  })
})

describe('field issues', () => {
  it('never flags an empty value', () => {
    for (const type of ['card_number', 'email', 'url', 'date', 'month_year', 'phone']) {
      expect(fieldIssue(type, '  ')).toBeNull()
    }
  })

  it('names the problem for each type', () => {
    expect(fieldIssue('card_number', '4242 4242')).toBe('cardLength')
    expect(fieldIssue('card_number', '4242 4242 4242 4241')).toBe('cardChecksum')
    expect(fieldIssue('card_number', '4242 4242 4242 4242')).toBeNull()
    expect(fieldIssue('month_year', '13/29')).toBe('monthYear')
    expect(fieldIssue('date', '2026-02-30')).toBe('date')
    expect(fieldIssue('email', 'rei@')).toBe('email')
    expect(fieldIssue('email', 'rei@example.com')).toBeNull()
    expect(fieldIssue('url', 'not a url')).toBe('url')
    expect(fieldIssue('phone', 'call me')).toBe('phone')
    expect(fieldIssue('phone', '+86 (21) 5555-0100')).toBeNull()
    expect(fieldIssue('concealed', '12a', 'cvv')).toBe('cvv')
    expect(fieldIssue('concealed', '123', 'cvv')).toBeNull()
    expect(fieldIssue('concealed', '12 34', 'digits')).toBe('digits')
    expect(fieldIssue('text', 'GB00', 'iban')).toBe('iban')
    expect(fieldIssue('text', 'DEUT', 'swift')).toBe('swift')
    expect(fieldIssue('multiline', 'hello', 'ssh_public_key')).toBe('sshPublicKey')
    expect(fieldIssue('multiline', publicKey, 'ssh_public_key')).toBeNull()
  })
})

describe('SSH keys', () => {
  it('parses a public key line and its type', () => {
    const parsed = parseSshPublicKey(publicKey)
    expect(parsed?.keyType).toBe('ssh-ed25519')
    expect(parsed?.comment).toBe('deploy@example')
    expect(parseSshPublicKey('ssh-rsa AAAAC3NzaC1lZDI1NTE5AAAAIGUROBHbTQxZVCTUfsYzpzhL2rZTKazqH9Gu7acE/Wen')).toBeNull()
    expect(sshKeyTypeOption('ssh-ed25519')).toBe('ed25519')
    expect(sshKeyTypeOption('ecdsa-sha2-nistp256')).toBe('ecdsa')
    expect(sshKeyTypeOption('ssh-rsa')).toBe('rsa')
  })

  it('computes the same SHA256 fingerprint as ssh-keygen', async () => {
    expect(await sshFingerprint(publicKey)).toBe(publicKeyFingerprint)
    expect(await sshFingerprint('nonsense')).toBeNull()
  })

  it('recovers the public key from an OpenSSH private key container without decrypting it', () => {
    // A synthetic container: header strings, one key, the public blob, then an opaque private section.
    const blob = Uint8Array.from(atob(publicKey.split(' ')[1]), (c) => c.charCodeAt(0))
    const sshString = (bytes: Uint8Array) => {
      const out = new Uint8Array(4 + bytes.length)
      new DataView(out.buffer).setUint32(0, bytes.length)
      out.set(bytes, 4)
      return out
    }
    const text = (value: string) => new TextEncoder().encode(value)
    const parts = [
      text('openssh-key-v1\0'),
      sshString(text('aes256-ctr')),
      sshString(text('bcrypt')),
      sshString(new Uint8Array(8)),
      Uint8Array.of(0, 0, 0, 1),
      sshString(blob),
      sshString(new Uint8Array(32)),
    ]
    const container = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
      container.set(part, offset)
      offset += part.length
    }
    let binary = ''
    for (const byte of container) binary += String.fromCharCode(byte)
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${btoa(binary).replace(/(.{70})/g, '$1\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
    expect(publicKeyFromOpenSshPrivateKey(pem)).toBe(publicKey.split(' ').slice(0, 2).join(' '))
    expect(
      publicKeyFromOpenSshPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'),
    ).toBeNull()
  })
})
