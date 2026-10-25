import i18n from './i18n'
import { describeSyncError, httpStatusLabel, isSyncErrorCode } from './syncErrors'

/**
 * Turns whatever a command rejected with into one localized line. Rust rejects with
 * `{ code, message, detail?, status? }` (`src-tauri/src/command_error.rs`); the line comes from
 * `errors.<code>`, never from the English `message`. Sync commands reject with their own codes and go through
 * `describeSyncError`. Anything else — an unknown code, a plain string from an old bridge or a test stub, a
 * JS `Error` — reads as the localized generic line with the raw text after it, so nothing is lost.
 */

/** Every code `command_error.rs` can send; `errors.<code>` exists in each bundle (tested both ways). */
export const errorCodes = [
  'internal',
  'unsupported_platform',
  'master_password_already_set',
  'master_password_missing',
  'invalid_master_password',
  'locked',
  'vault_not_found',
  'passkey_item_not_found',
  'tag_name_empty',
  'tag_not_found',
  'vault_name_empty',
  'vault_destination_required',
  'vault_last_one',
  'vault_last_open',
  'relation_self',
  'relation_cycle',
  'relation_item_not_found',
  'item_has_relations',
  'item_relations_block_move',
  'invalid_icon_mode',
  'item_not_found',
  'empty_character_set',
  'database',
  'crypto',
  'serialization',
  'no_data_directory',
  'filesystem',
  'import_unreadable',
  'import_not_1pux',
  'import_bad_json',
  'import_no_data',
  'totp_invalid_secret',
  'clock',
  'passkey_rp_mismatch',
  'passkey_insecure_origin',
  'passkey_unsupported_algorithm',
  'passkey_bad_encoding',
  'passkey_bad_key',
  'site_icon',
  'http',
  'network',
  'biometric_unavailable',
  'biometric_timeout',
  'biometric_failed',
  'biometric_needs_password',
  'database_init',
  'autostart',
] as const

export type ErrorCode = (typeof errorCodes)[number]

export type CommandErrorInfo = {
  code: string
  message: string
  detail?: string
  status?: number | null
}

/* Codes whose inner error (the SQLite or file-system message) is worth showing after the translated line:
   it is what someone would search for or send in a bug report. The rest say everything in their own line. */
const showsDetail = new Set<string>([
  'database',
  'database_init',
  'crypto',
  'serialization',
  'filesystem',
  'import_unreadable',
  'import_not_1pux',
  'import_bad_json',
  'network',
  'autostart',
])

/* Codes that mean "something broke inside": no line of their own beyond the generic one, so the raw text
   follows it. */
const genericCodes = new Set<string>(['internal'])

export function isErrorCode(value: string): value is ErrorCode {
  return (errorCodes as readonly string[]).includes(value)
}

function rawText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function asCommandError(value: unknown): CommandErrorInfo | null {
  if (typeof value !== 'object' || value === null || !('code' in value)) return null
  const { code, detail, message, status } = value as Partial<CommandErrorInfo>
  if (typeof code !== 'string') return null
  return {
    code,
    detail: typeof detail === 'string' ? detail : undefined,
    message: typeof message === 'string' ? message : '',
    status: typeof status === 'number' ? status : null,
  }
}

/** The generic line with the raw text after it: "出了点问题：<raw>". */
export function genericError(raw: string): string {
  const trimmed = raw.trim()
  return trimmed ? i18n.t('errors.withRaw', { raw: trimmed }) : i18n.t('errors.unknown')
}

export function describeError(value: unknown): string {
  const error = asCommandError(value)
  if (!error) return genericError(rawText(value))

  if (error.code === 'http' && typeof error.status === 'number') {
    return i18n.t('errors.httpStatus', { status: httpStatusLabel(error.status) })
  }
  if (isErrorCode(error.code) && !genericCodes.has(error.code)) {
    const line = i18n.t(`errors.${error.code}`)
    return showsDetail.has(error.code) && error.detail
      ? i18n.t('errors.withDetail', { detail: error.detail, line })
      : line
  }
  if (isSyncErrorCode(error.code)) {
    return describeSyncError(i18n.t, { code: error.code, message: error.message, status: error.status ?? null })
  }
  return genericError(error.message || error.detail || rawText(value))
}

/** The stable code of a rejection, when it has one: lets a caller react to one case without parsing prose. */
export function errorCode(value: unknown): string | null {
  return asCommandError(value)?.code ?? null
}
