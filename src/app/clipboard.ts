/**
 * One way to put a value on the clipboard, for the main window and Quick Access alike. A secret (password,
 * concealed field, card number, one-time password or its seed) is wiped after 90 seconds when Settings ▸ Security
 * "Clear clipboard after 90 seconds" is on — only if the clipboard still holds that value, so something the user
 * copied since is left alone. Plain values (a username, a hostname) are never wiped, as before.
 */

export const clipboardClearDelayMs = 90 * 1000

export type ClipboardLike = Pick<Clipboard, 'readText' | 'writeText'>

export type CopyOptions = {
  clearAfter90Seconds: boolean
  clipboard?: ClipboardLike
  schedule?: (callback: () => void, delay: number) => unknown
  sensitive: boolean
}

export async function copyText(value: string, options: CopyOptions): Promise<boolean> {
  if (!value) return false
  const clipboard = options.clipboard ?? navigator.clipboard
  const schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay))
  await clipboard.writeText(value)
  if (options.sensitive && options.clearAfter90Seconds) {
    schedule(() => void clearIfUnchanged(clipboard, value), clipboardClearDelayMs)
  }
  return true
}

async function clearIfUnchanged(clipboard: ClipboardLike, value: string) {
  try {
    if ((await clipboard.readText()) === value) await clipboard.writeText('')
  } catch {
    // Reading can be refused (WKWebView without a gesture); clearing blind is the safer failure.
    await clipboard.writeText('').catch(() => {})
  }
}
