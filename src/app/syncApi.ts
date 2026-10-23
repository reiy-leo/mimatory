import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// Typed wrappers for the Rust sync commands (src-tauri/src/sync/commands.rs). Design and remote
// layout: .agent/sync.md. Every command rejects with a SyncErrorInfo object, never a string, so the
// UI can translate `code` (and show `status` with its gloss) instead of parsing Rust prose.

export type SyncState = 'locked' | 'disconnected' | 'needs_remote_password' | 'syncing' | 'error' | 'idle'

export type SyncProvider = 'webdav' | 'google'

export type SyncErrorCode =
  | 'http'
  | 'network'
  | 'decrypt'
  | 'unsupported_format'
  | 'invalid_remote'
  | 'remote_password_required'
  | 'remote_password_wrong'
  | 'not_connected'
  | 'locked'
  | 'conflict'
  | 'google_not_configured'
  | 'google_unsupported_platform'
  | 'google_reauth'
  | 'oauth_cancelled'
  | 'invalid_url'
  | 'busy'
  | 'local'

export type SyncErrorInfo = {
  code: SyncErrorCode
  /** HTTP status when `code` is `http` (412, 401, …). */
  status: number | null
  /** Short Chinese message with the HTTP gloss, e.g. "412 前置条件失败". */
  message: string
}

export type SyncReport = {
  pulled: number
  pushed: number
  deferred: number
  at: string
}

export type SyncStatus = {
  state: SyncState
  provider: SyncProvider | null
  webdav_url: string | null
  webdav_username: string | null
  google_available: boolean
  last_sync_at: string | null
  last_error: SyncErrorInfo | null
  last_report: SyncReport | null
  remote_folder: string
}

export function isSyncErrorInfo(value: unknown): value is SyncErrorInfo {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value
}

export const syncApi = {
  cancelConnect: () => invoke<void>('sync_cancel_connect'),
  /** Opens the system browser for Google consent; resolves once connected and synced. */
  connectGoogle: () => invoke<SyncStatus>('sync_connect_google'),
  /** Connects (or switches to) a WebDAV server, then runs the first round. */
  connectWebdav: (url: string, username: string, password: string) =>
    invoke<SyncStatus>('sync_connect_webdav', { password, url, username }),
  disconnect: () => invoke<SyncStatus>('sync_disconnect'),
  now: () => invoke<SyncStatus>('sync_now'),
  onStatus: (handler: (status: SyncStatus) => void): Promise<UnlistenFn> =>
    listen<SyncStatus>('sync:status', (event) => handler(event.payload)),
  /** Debounced: call after every local write; the backend starts a round 3s after the last call. */
  request: () => invoke<void>('sync_request'),
  status: () => invoke<SyncStatus>('sync_status'),
  /** The remote was created by a vault with another master password / salt. */
  unlockRemote: (masterPassword: string) => invoke<SyncStatus>('sync_unlock_remote', { masterPassword }),
}
