import type { TFunction } from 'i18next'
import i18n from './i18n'
import type { SyncErrorCode, SyncErrorInfo } from './syncApi'

/**
 * Sync errors and the WebDAV address rules, for the Settings ▸ Sync pane. Rust sends a stable `code` (and the
 * HTTP `status` when there is one); the pane translates the code instead of showing the Chinese prose Rust built.
 */

/** Every code `src-tauri/src/sync/error.rs` can send; `sync.errors.<code>` exists in each bundle (tested). */
export const syncErrorCodes: SyncErrorCode[] = [
  'http',
  'network',
  'decrypt',
  'unsupported_format',
  'invalid_remote',
  'remote_password_required',
  'remote_password_wrong',
  'not_connected',
  'locked',
  'conflict',
  'google_not_configured',
  'google_unsupported_platform',
  'google_reauth',
  'oauth_cancelled',
  'invalid_url',
  'busy',
  'local',
]

/** HTTP statuses that get their own explanation (`sync.httpHints.<status>`); the rest show the gloss alone. */
export const syncHttpHintStatuses = [301, 302, 307, 308, 401, 403, 404, 405, 409, 412, 423, 507] as const

/* Statuses with a short meaning of their own (`http.<status>` in each bundle); the rest read `http.unknown`. */
export const httpGlossStatuses = [
  301, 302, 307, 308, 400, 401, 403, 404, 405, 408, 409, 412, 413, 423, 429, 500, 501, 502, 503, 504, 507,
] as const

/*
 * Owner rule (2026-10-13): a response code shown anywhere carries a short gloss — "401 未授权". Since the UI
 * speaks more than Chinese (2026-10-25) the gloss is in the UI language: Chinese in zh, "401 Unauthorized" in en,
 * "401 Не авторизован" in ru. Rust keeps its own Chinese table (`http_gloss` in error.rs) for log text only.
 */
export function httpStatusLabel(status: number, t: TFunction = i18n.t): string {
  const known = (httpGlossStatuses as readonly number[]).includes(status)
  return `${status} ${t(known ? `http.${status}` : 'http.unknown')}`
}

export function isSyncErrorCode(value: string): value is SyncErrorCode {
  return (syncErrorCodes as string[]).includes(value)
}

/** One line for the pane: the translated reason, and for HTTP the status with its gloss in front. */
export function describeSyncError(t: TFunction, error: SyncErrorInfo): string {
  const code = isSyncErrorCode(error.code) ? error.code : 'local'
  if (code === 'http' && typeof error.status === 'number') {
    const hinted = (syncHttpHintStatuses as readonly number[]).includes(error.status)
    const hint = hinted ? t(`sync.httpHints.${error.status}`) : t('sync.errors.http')
    return t('sync.httpError', { hint, status: httpStatusLabel(error.status, t) })
  }
  return t(`sync.errors.${code}`)
}

/** A rejection from a sync command is a SyncErrorInfo; anything else (a bridge failure) is shown as local. */
export function toSyncError(value: unknown): SyncErrorInfo {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const { code, message, status } = value as Partial<SyncErrorInfo>
    return {
      code: (typeof code === 'string' && isSyncErrorCode(code) ? code : 'local') as SyncErrorCode,
      message: typeof message === 'string' ? message : '',
      status: typeof status === 'number' ? status : null,
    }
  }
  return { code: 'local', message: String(value), status: null }
}

export type WebdavUrlCheck =
  | { kind: 'empty' }
  | { kind: 'ok'; url: string; addedScheme: boolean }
  | { kind: 'needs_https' }
  | { kind: 'credentials' }
  | { kind: 'invalid' }

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * The same rules as `webdav::normalize_url` (owner 2026-10-23: no WebDAV without TLS): https only, plain http
 * only for this computer (tests), a bare host gets https:// in front, and no user name or password in the URL.
 * Checked as the user types so the form says what is wrong before anything is sent.
 */
export function checkWebdavUrl(input: string): WebdavUrlCheck {
  const trimmed = input.trim()
  if (!trimmed) return { kind: 'empty' }
  const addedScheme = !trimmed.includes('://')
  let url: URL
  try {
    url = new URL(addedScheme ? `https://${trimmed}` : trimmed)
  } catch {
    return { kind: 'invalid' }
  }
  if (!url.hostname) return { kind: 'invalid' }
  if (url.username || url.password) return { kind: 'credentials' }
  if (url.protocol === 'http:')
    return loopbackHosts.has(url.hostname) ? { addedScheme, kind: 'ok', url: url.href } : { kind: 'needs_https' }
  if (url.protocol !== 'https:') return { kind: 'needs_https' }
  return { addedScheme, kind: 'ok', url: url.href }
}
