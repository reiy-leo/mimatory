import jsQR from 'jsqr'
import { normalizeTotpSecret } from './totpDisplay'

const base32Only = /^[A-Z2-7]+$/
// Shorter than this is not an authenticator seed: SHA1 secrets are at least 80 bits, which is 16
// base32 characters. Without a floor, any short base32-looking word in a QR would be stored.
const minimumSecretLength = 16

function asBase32Secret(text: string): string | null {
  const normalized = normalizeTotpSecret(text)
  return normalized.length >= minimumSecretLength && base32Only.test(normalized) ? normalized : null
}

// A setup QR holds an otpauth:// link, but some enrolment pages print the bare key instead, and a
// screenshot of either can land on the clipboard. Anything else — a plain URL, a page of text — is
// refused rather than written into the field, because the value it produces has to be a working seed.
export function otpSecretFromQrText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (!trimmed.toLowerCase().startsWith('otpauth://')) return asBase32Secret(trimmed)
  try {
    return asBase32Secret(new URL(trimmed).searchParams.get('secret') ?? '')
  } catch {
    return null
  }
}

export async function otpSecretFromQrImage(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height)
    return decoded?.data ? otpSecretFromQrText(decoded.data) : null
  } finally {
    bitmap.close()
  }
}

// The clipboard hands a paste over as a file, so the image never reaches disk and never has to be
// read back: a decrypted seed that no screen is showing is the point of the vault.
export function clipboardImageFile(event: { clipboardData: DataTransfer | null }): File | null {
  const items = event.clipboardData?.items
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}
