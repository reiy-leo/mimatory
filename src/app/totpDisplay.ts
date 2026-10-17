const totpDigits = 6
const totpPeriodSeconds = 30

export type OtpAuthLink = { account?: string; issuer?: string; secret: string }

export function formatOtpCode(code: string): string {
  const normalized = code.trim()
  if (!/^\d{6}$/.test(normalized)) return normalized
  return `${normalized.slice(0, 3)} ${normalized.slice(3)}`
}

export function getTotpProgress(secondsRemaining: number): number {
  return Math.max(0, Math.min(1, secondsRemaining / totpPeriodSeconds))
}

// Mirrors `totp::normalize_secret`: a secret saved with spacing or padding still has to encode into a
// link another authenticator accepts, because the app never rewrites what the user pasted.
export function normalizeTotpSecret(secret: string): string {
  return secret.trim().replace(/ /g, '').replace(/=/g, '').toUpperCase()
}

export function otpSecretFieldIndexes<T extends { field_type: string }>(fields: readonly T[]): number[] {
  return fields.flatMap((field, index) => (field.field_type === 'otp' ? [index] : []))
}

export function buildOtpAuthUri({ account, issuer, secret }: OtpAuthLink): string {
  const label = [issuer, account]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join(':')
  const parameters = [
    `secret=${encodeURIComponent(normalizeTotpSecret(secret))}`,
    'algorithm=SHA1',
    `digits=${totpDigits}`,
    `period=${totpPeriodSeconds}`,
  ]
  const trimmedIssuer = issuer?.trim() ?? ''
  if (trimmedIssuer) parameters.push(`issuer=${encodeURIComponent(trimmedIssuer)}`)
  return `otpauth://totp/${label}?${parameters.join('&')}`
}

/**
 * The secret as 1Password's editor shows it: lowercase base32 in groups of four ("jbsw y3dp ehpk 3pxp").
 * Display only — what is stored is `parseOtpSecretInput`'s normalized form.
 */
export function formatOtpSecret(secret: string): string {
  const normalized = normalizeTotpSecret(secret).toLowerCase()
  return normalized.replace(/(.{4})(?=.)/g, '$1 ')
}

/**
 * What a typed or pasted value stores: an `otpauth://` link gives up its `secret` parameter (the Rust TOTP
 * reads a bare key only), anything else is normalized base32 (spaces and padding gone, uppercase).
 */
export function parseOtpSecretInput(text: string): string {
  const trimmed = text.trim()
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const secret = new URL(trimmed).searchParams.get('secret')
      if (secret) return normalizeTotpSecret(secret)
    } catch {
      // Not a parseable link: keep what was typed, normalized like any key.
    }
  }
  return normalizeTotpSecret(trimmed.replace(/\s+/g, ''))
}

/** "214 • 685": the separator is drawn by the caller, so this only splits. */
export function otpCodeGroups(code: string): string[] {
  const normalized = code.trim()
  if (!/^\d{6,8}$/.test(normalized)) return [normalized]
  const half = Math.ceil(normalized.length / 2)
  return [normalized.slice(0, half), normalized.slice(half)]
}
