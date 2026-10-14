/**
 * Pure formatting, parsing and validation for item fields, keyed by field type. Nothing here touches
 * React or the bridge, so every rule the editor and the read-only view apply is unit-tested in one place.
 */

/** Every value type a field can carry. `password` keeps the generator and strength meter; `concealed` is a
 * secret that is not a password (a PIN, a security code, an account number). Unknown strings read as text. */
export const valueFieldTypes = [
  'text',
  'multiline',
  'email',
  'url',
  'phone',
  'address',
  'password',
  'concealed',
  'concealed_multiline',
  'otp',
  'date',
  'month_year',
  'card_number',
  'select',
] as const

export type ValueFieldType = (typeof valueFieldTypes)[number]

/** Types whose value is a secret: masked at rest, revealed on request, copyable without revealing. */
const concealedTypes = new Set(['password', 'concealed', 'concealed_multiline', 'security_questions'])
const multilineTypes = new Set(['multiline', 'address', 'concealed_multiline'])

export function isConcealedType(fieldType: string): boolean {
  return concealedTypes.has(fieldType)
}

export function isMultilineType(fieldType: string): boolean {
  return multilineTypes.has(fieldType)
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

// ---------------------------------------------------------------------------------------------------
// Card numbers

export type CardBrand = 'amex' | 'diners' | 'discover' | 'jcb' | 'mastercard' | 'unionpay' | 'visa'

/** Issuer prefixes (IIN ranges) for the networks a card field can name. First match wins. */
export function detectCardBrand(value: string): CardBrand | null {
  const digits = digitsOnly(value)
  if (!digits) return null
  const prefix = (length: number) => Number(digits.slice(0, length))
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^3(?:0[0-5]|[689])/.test(digits)) return 'diners'
  if (/^35(?:2[89]|[3-8])/.test(digits)) return 'jcb'
  if (/^4/.test(digits)) return 'visa'
  if (/^5[1-5]/.test(digits) || (digits.length >= 4 && prefix(4) >= 2221 && prefix(4) <= 2720)) return 'mastercard'
  if (/^(?:6011|65|64[4-9])/.test(digits)) return 'discover'
  if (/^62/.test(digits)) return 'unionpay'
  return null
}

/** Digit groups a card network prints its numbers in. Amex is 4-6-5, 14-digit Diners 4-6-4, else fours. */
function cardGroups(digits: string): number[] {
  const brand = detectCardBrand(digits)
  if (brand === 'amex') return [4, 6, 5]
  if (brand === 'diners' && digits.length === 14) return [4, 6, 4]
  return [4, 4, 4, 4, 3]
}

function groupDigits(digits: string, groups: number[]): string {
  const parts: string[] = []
  let cursor = 0
  for (const size of groups) {
    if (cursor >= digits.length) break
    parts.push(digits.slice(cursor, cursor + size))
    cursor += size
  }
  if (cursor < digits.length) parts.push(digits.slice(cursor))
  return parts.join(' ')
}

export const cardNumberMaxDigits = 19

/** What the card field shows while typing: digits only, grouped the way the network prints them. */
export function formatCardNumber(value: string): string {
  const digits = digitsOnly(value).slice(0, cardNumberMaxDigits)
  return groupDigits(digits, cardGroups(digits))
}

/** Every digit but the last four replaced, keeping the grouping so the number still reads as a card. */
export function maskCardNumber(value: string, mask = '•'): string {
  const digits = digitsOnly(value)
  if (digits.length <= 4) return digits
  const masked = mask.repeat(digits.length - 4) + digits.slice(-4)
  const groups = cardGroups(digits)
  const parts: string[] = []
  let cursor = 0
  for (const size of groups) {
    if (cursor >= masked.length) break
    parts.push(masked.slice(cursor, cursor + size))
    cursor += size
  }
  if (cursor < masked.length) parts.push(masked.slice(cursor))
  return parts.join(' ')
}

export function luhnValid(value: string): boolean {
  const digits = digitsOnly(value)
  if (!digits) return false
  let sum = 0
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index])
    if (index % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

// ---------------------------------------------------------------------------------------------------
// Dates

export type MonthYear = { month: number; year: number }

/** Accepts MM/YY, MM/YYYY, M/YY, MM-YY, MMYY and the ISO YYYY-MM a month input writes. */
export function parseMonthYear(value: string): MonthYear | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let month: number
  let year: number
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})$/)
  const slashed = trimmed.match(/^(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})$/)
  const packed = trimmed.match(/^(\d{2})(\d{2})$/)
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
  } else if (slashed) {
    month = Number(slashed[1])
    year = Number(slashed[2])
  } else if (packed) {
    month = Number(packed[1])
    year = Number(packed[2])
  } else {
    return null
  }
  if (year < 100) year += 2000
  if (month < 1 || month > 12) return null
  return { month, year }
}

/** Keeps a month/year field to MM/YY(YY) while typing: a slash appears once a third digit arrives, and a
 * leading 2–9 is read as a one-digit month, so "8" becomes "08". Backspacing over the slash still works
 * because two digits alone never get one. */
export function formatMonthYearInput(value: string): string {
  let digits = digitsOnly(value).slice(0, 6)
  if (/^[2-9]/.test(digits)) digits = `0${digits}`.slice(0, 6)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

export type IsoDate = { day: number; month: number; year: number }

/** A real calendar day in the YYYY-MM-DD form a date input writes; 2026-02-30 is not one. */
export function parseIsoDate(value: string): IsoDate | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return { day, month, year }
}

/** A stored date in the reader's locale. A value that is not ISO (an older free-text entry) is shown as is. */
export function formatDate(value: string, locale: string): string {
  const date = parseIsoDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  )
}

export function formatMonthYear(value: string, locale: string): string {
  const parsed = parseMonthYear(value)
  if (!parsed) return value
  return new Intl.DateTimeFormat(locale, { month: '2-digit', timeZone: 'UTC', year: 'numeric' }).format(
    new Date(Date.UTC(parsed.year, parsed.month - 1, 1)),
  )
}

export type ExpiryStatus = 'expired' | 'expiring'

const dayMs = 24 * 60 * 60 * 1000

/** The last moment a stored expiry is still good: the end of the day for a date, the end of the month for a
 * card's month/year (a card marked 08/29 works through 31 August 2029). Null when the value does not parse. */
export function expiryEnd(value: string, fieldType: string): number | null {
  if (fieldType === 'month_year') {
    const parsed = parseMonthYear(value)
    return parsed ? Date.UTC(parsed.year, parsed.month, 1) - 1 : null
  }
  const date = parseIsoDate(value)
  return date ? Date.UTC(date.year, date.month - 1, date.day + 1) - 1 : null
}

/** "Expired" once the end has passed, "expiring" inside the warning window, nothing otherwise. */
export function expiryStatus(value: string, fieldType: string, now: Date, warnDays = 60): ExpiryStatus | null {
  const end = expiryEnd(value, fieldType)
  if (end === null) return null
  const current = now.getTime()
  if (end < current) return 'expired'
  if (end - current <= warnDays * dayMs) return 'expiring'
  return null
}

// ---------------------------------------------------------------------------------------------------
// Web addresses

/** Only http(s) addresses are ever handed to the opener; a bare host gets https:// in front. */
export function openableUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.toString()
  } catch {
    return null
  }
}

export function urlHostname(value: string): string | null {
  const openable = openableUrl(value)
  return openable ? new URL(openable).hostname : null
}

// ---------------------------------------------------------------------------------------------------
// Bank identifiers

export function normalizeIban(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, '$1 ')
}

/** ISO 13616 check digits: move the first four characters to the end, letters to numbers, mod 97 = 1. */
export function ibanValid(value: string): boolean {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const character of rearranged) {
    const code = /\d/.test(character) ? character : String(character.charCodeAt(0) - 55)
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

export function swiftValid(value: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value.replace(/\s/g, '').toUpperCase())
}

// ---------------------------------------------------------------------------------------------------
// Validation

/** A field's extra rule beyond what its type implies. */
export type FieldValidation = 'cvv' | 'digits' | 'iban' | 'ssh_public_key' | 'swift'

/** Each issue maps to an `fieldHints.*` message that says what is wrong and how to fix it. */
export type FieldIssue =
  | 'cardChecksum'
  | 'cardLength'
  | 'cvv'
  | 'date'
  | 'digits'
  | 'email'
  | 'iban'
  | 'monthYear'
  | 'phone'
  | 'sshPublicKey'
  | 'swift'
  | 'url'

/** The one problem worth telling the user about, or null. Empty values are never an issue: every field is
 * optional, and the hint is advice, not a gate on saving. */
export function fieldIssue(fieldType: string, value: string, validation?: FieldValidation): FieldIssue | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (validation === 'cvv') return /^\d{3,4}$/.test(trimmed) ? null : 'cvv'
  if (validation === 'digits') return /^\d+$/.test(trimmed) ? null : 'digits'
  if (validation === 'iban') return ibanValid(trimmed) ? null : 'iban'
  if (validation === 'swift') return swiftValid(trimmed) ? null : 'swift'
  if (validation === 'ssh_public_key') return parseSshPublicKey(trimmed) ? null : 'sshPublicKey'
  switch (fieldType) {
    case 'card_number': {
      const digits = digitsOnly(trimmed)
      if (digits.length < 12 || digits.length > cardNumberMaxDigits) return 'cardLength'
      return luhnValid(digits) ? null : 'cardChecksum'
    }
    case 'month_year':
      return parseMonthYear(trimmed) ? null : 'monthYear'
    case 'date':
      return parseIsoDate(trimmed) ? null : 'date'
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? null : 'email'
    case 'url':
      return openableUrl(trimmed) ? null : 'url'
    case 'phone':
      return /^[+\d\s().\-#*/]+$/.test(trimmed) && /\d/.test(trimmed) ? null : 'phone'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------------------------------
// SSH keys

export type SshPublicKey = { blob: Uint8Array<ArrayBuffer>; comment: string; keyType: string }

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Reads an SSH wire-format string (uint32 length + bytes) at `offset`. */
function readSshString(bytes: Uint8Array, offset: number): { next: number; value: Uint8Array } | null {
  if (offset + 4 > bytes.length) return null
  const length =
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  const start = offset + 4
  if (start + length > bytes.length) return null
  return { next: start + length, value: bytes.slice(start, start + length) }
}

const textDecoder = new TextDecoder()

/** An OpenSSH public key line: `<type> <base64 blob> [comment]`, where the blob must start with the same type. */
export function parseSshPublicKey(value: string): SshPublicKey | null {
  const [keyType, encoded, ...comment] = value.trim().split(/\s+/)
  if (!keyType || !encoded || !/^[a-z0-9@.-]+$/i.test(keyType)) return null
  const blob = base64ToBytes(encoded)
  if (!blob) return null
  const inner = readSshString(blob, 0)
  if (!inner || textDecoder.decode(inner.value) !== keyType) return null
  return { blob, comment: comment.join(' '), keyType }
}

/** `ssh-keygen -l -E sha256` style: SHA256 over the decoded blob, base64 without padding. */
export async function sshFingerprint(publicKey: string): Promise<string | null> {
  const parsed = parseSshPublicKey(publicKey)
  if (!parsed || !globalThis.crypto?.subtle) return null
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(parsed.blob)))
  return `SHA256:${bytesToBase64(digest).replace(/=+$/, '')}`
}

/** The option id of the `sshKeyType` select for a key's wire type. */
export function sshKeyTypeOption(keyType: string): string | null {
  if (keyType === 'ssh-ed25519') return 'ed25519'
  if (keyType === 'ssh-rsa') return 'rsa'
  if (keyType.startsWith('ecdsa-sha2-')) return 'ecdsa'
  if (keyType === 'sk-ssh-ed25519@openssh.com') return 'ed25519_sk'
  if (keyType.startsWith('sk-ecdsa-sha2-')) return 'ecdsa_sk'
  if (keyType === 'ssh-dss') return 'dsa'
  return null
}

const openSshPrivateHeader = '-----BEGIN OPENSSH PRIVATE KEY-----'
const openSshPrivateFooter = '-----END OPENSSH PRIVATE KEY-----'

/** An OpenSSH private key carries its public half in clear, even when the private half is encrypted with a
 * passphrase, so the public key line can be recovered without ever decrypting anything. */
export function publicKeyFromOpenSshPrivateKey(value: string): string | null {
  const start = value.indexOf(openSshPrivateHeader)
  const end = value.indexOf(openSshPrivateFooter)
  if (start < 0 || end < start) return null
  const body = value.slice(start + openSshPrivateHeader.length, end).replace(/\s/g, '')
  const bytes = base64ToBytes(body)
  if (!bytes) return null
  const magic = 'openssh-key-v1\0'
  if (textDecoder.decode(bytes.slice(0, magic.length)) !== magic) return null
  let offset = magic.length
  for (let skip = 0; skip < 3; skip += 1) {
    // cipher name, KDF name, KDF options
    const part = readSshString(bytes, offset)
    if (!part) return null
    offset = part.next
  }
  if (offset + 4 > bytes.length) return null
  offset += 4 // number of keys; the first public key follows
  const publicBlob = readSshString(bytes, offset)
  if (!publicBlob) return null
  const keyType = readSshString(publicBlob.value, 0)
  if (!keyType) return null
  return `${textDecoder.decode(keyType.value)} ${bytesToBase64(publicBlob.value)}`
}
