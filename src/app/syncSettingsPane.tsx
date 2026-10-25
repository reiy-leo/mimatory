import { CircleAlert, CircleCheck, Loader2, RefreshCw } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatItemTimestamp } from './relativeTime'
import { type SyncErrorInfo, type SyncProvider, type SyncStatus, syncApi } from './syncApi'
import { checkWebdavUrl, describeSyncError, toSyncError } from './syncErrors'

type Busy = 'google' | 'webdav' | 'now' | 'disconnect' | 'unlock' | null
type Confirm = 'disconnect' | 'switch' | null

/**
 * Settings ▸ Sync (.agent/sync.md): Google Drive or WebDAV, one at a time. Disconnected it offers the two;
 * connected it shows where the data goes, when it last synced, Sync Now, Switch Provider and Disconnect (both
 * confirmed). A remote set up under another master password asks for that password in a sheet. Every error is
 * translated from its `code`; an HTTP one shows the status with its gloss in the UI language ("401 未授权", "401 Unauthorized").
 *
 * `googleSync` comes from the platform table (desktop only); `google_available` from the build (the OAuth client id
 * is compiled in). Without either, the Google option stays visible but disabled, with the reason.
 */
export function SyncSettingsPane({ googleSync }: { googleSync: boolean }) {
  const { i18n, t } = useTranslation()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [choice, setChoice] = useState<SyncProvider | null>(null)
  const [switching, setSwitching] = useState(false)
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [actionError, setActionError] = useState<SyncErrorInfo | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [remoteSheet, setRemoteSheet] = useState(false)
  const [remotePassword, setRemotePassword] = useState('')
  const [remoteError, setRemoteError] = useState<SyncErrorInfo | null>(null)
  const remotePasswordRef = useRef<HTMLInputElement>(null)
  const lastState = useRef<SyncStatus['state'] | null>(null)

  // The status as Rust sees it, then every change it announces. The vault can be locked or unlocked in the main
  // window while this pane is open, which no sync event reports, so focus re-reads it too.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    const read = () => {
      syncApi
        .status()
        .then((next) => {
          if (!disposed) setStatus(next)
        })
        .catch(() => {})
    }
    read()
    syncApi
      .onStatus((next) => setStatus(next))
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {})
    window.addEventListener('focus', read)
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('focus', read)
    }
  }, [])

  // A remote made by a vault with another master password: ask for it once, as soon as that is known.
  useEffect(() => {
    const state = status?.state ?? null
    if (state === 'needs_remote_password' && lastState.current !== state) {
      setRemoteError(null)
      setRemotePassword('')
      setRemoteSheet(true)
    }
    if (state !== 'needs_remote_password') setRemoteSheet(false)
    lastState.current = state
  }, [status?.state])

  useEffect(() => {
    if (remoteSheet) remotePasswordRef.current?.focus()
  }, [remoteSheet])

  // Escape dismisses whichever sheet is up, like its Cancel button.
  useEffect(() => {
    if (!confirm && !remoteSheet) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (busy === 'unlock' || busy === 'disconnect') return
      setConfirm(null)
      setRemoteSheet(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, confirm, remoteSheet])

  const googleReady = googleSync && Boolean(status?.google_available)
  const provider = choice ?? (googleReady ? 'google' : 'webdav')
  const connected = Boolean(status?.provider)
  const locked = !status || status.state === 'locked'
  const showChooser = !locked && (!connected || switching)
  const urlCheck = checkWebdavUrl(url)
  const canConnectWebdav = urlCheck.kind === 'ok' && username.trim() !== '' && appPassword !== '' && busy === null
  const folder = status?.remote_folder ?? 'mimatory/'
  const shownError = actionError ?? status?.last_error ?? null

  async function run(kind: Exclude<Busy, null>, task: () => Promise<SyncStatus>): Promise<boolean> {
    setBusy(kind)
    setActionError(null)
    try {
      setStatus(await task())
      return true
    } catch (error) {
      const info = toSyncError(error)
      // Cancelling the Google sign-in is the user's own choice, not something to report.
      if (info.code !== 'oauth_cancelled') setActionError(info)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function connectWebdav(event: FormEvent) {
    event.preventDefault()
    if (!canConnectWebdav || urlCheck.kind !== 'ok') return
    const done = await run('webdav', () => syncApi.connectWebdav(urlCheck.url, username.trim(), appPassword))
    if (done) {
      setAppPassword('')
      setSwitching(false)
      setChoice(null)
    }
  }

  async function connectGoogle() {
    const done = await run('google', () => syncApi.connectGoogle())
    if (done) {
      setSwitching(false)
      setChoice(null)
    }
  }

  async function cancelGoogle() {
    await syncApi.cancelConnect().catch(() => {})
  }

  async function disconnect() {
    const done = await run('disconnect', () => syncApi.disconnect())
    setConfirm(null)
    if (done) {
      setSwitching(false)
      setChoice(null)
    }
  }

  function startSwitch() {
    setConfirm(null)
    setActionError(null)
    // Offer the other provider first: switching is usually about leaving the current one.
    setChoice(status?.provider === 'google' ? 'webdav' : googleReady ? 'google' : 'webdav')
    setSwitching(true)
  }

  async function unlockRemote(event: FormEvent) {
    event.preventDefault()
    if (!remotePassword || busy) return
    setBusy('unlock')
    setRemoteError(null)
    try {
      setStatus(await syncApi.unlockRemote(remotePassword))
      setRemotePassword('')
      setRemoteSheet(false)
    } catch (error) {
      setRemoteError(toSyncError(error))
    } finally {
      setBusy(null)
    }
  }

  const lastSync = status?.last_sync_at
    ? formatItemTimestamp(status.last_sync_at, i18n.language)
    : t('sync.neverSynced')
  const report = status?.last_report

  function statusLine() {
    if (!status) return null
    if (status.state === 'syncing' || busy === 'now') {
      return (
        <p aria-live="polite" className="sync-status" role="status">
          <Loader2 aria-hidden="true" className="import-spinner" size={16} />
          {t('sync.syncing')}
        </p>
      )
    }
    if (status.state === 'needs_remote_password') {
      return (
        <p aria-live="polite" className="sync-status is-warning" role="status">
          <CircleAlert aria-hidden="true" size={16} />
          {t('sync.needsRemotePassword')}
        </p>
      )
    }
    if (status.state === 'error') {
      return (
        <p aria-live="polite" className="sync-status is-error" role="status">
          <CircleAlert aria-hidden="true" size={16} />
          {t('sync.stateError')}
        </p>
      )
    }
    return (
      <p aria-live="polite" className="sync-status is-ok" role="status">
        <CircleCheck aria-hidden="true" size={16} />
        {t('sync.upToDate')}
      </p>
    )
  }

  return (
    <div className="settings-section">
      {locked ? (
        <div className="integration-card">
          <h2>{t('sync.title')}</h2>
          <p>{t('sync.description')}</p>
          <p className="sync-note">{t('sync.lockedNote')}</p>
        </div>
      ) : null}

      {!locked && connected && !switching && status ? (
        <div className="integration-card">
          <h2>{t('sync.title')}</h2>
          {statusLine()}
          <dl className="sync-details">
            <div>
              <dt>{t('sync.provider')}</dt>
              <dd>{status.provider === 'google' ? t('sync.googleDrive') : t('sync.webdav')}</dd>
            </div>
            {status.provider === 'webdav' ? (
              <>
                <div>
                  <dt>{t('sync.server')}</dt>
                  <dd title={status.webdav_url ?? ''}>{status.webdav_url}</dd>
                </div>
                <div>
                  <dt>{t('sync.account')}</dt>
                  <dd>{status.webdav_username}</dd>
                </div>
                <div>
                  <dt>{t('sync.folder')}</dt>
                  <dd>{folder}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>{t('sync.folder')}</dt>
                <dd>{t('sync.googleFolder')}</dd>
              </div>
            )}
            <div>
              <dt>{t('sync.lastSync')}</dt>
              <dd title={status.last_sync_at ? new Date(status.last_sync_at).toLocaleString(i18n.language) : ''}>
                {lastSync}
              </dd>
            </div>
            {report && report.pulled + report.pushed > 0 ? (
              <div>
                <dt>{t('sync.lastRound')}</dt>
                <dd>{t('sync.lastRoundCounts', { pulled: report.pulled, pushed: report.pushed })}</dd>
              </div>
            ) : null}
          </dl>
          {shownError ? (
            <div className="error-banner" role="alert">
              {describeSyncError(t, shownError)}
            </div>
          ) : null}
          <div className="integration-actions">
            {status.state === 'needs_remote_password' ? (
              <button className="primary-button" onClick={() => setRemoteSheet(true)} type="button">
                {t('sync.enterRemotePassword')}
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={busy !== null || status.state === 'syncing'}
                onClick={() => void run('now', () => syncApi.now())}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={16} />
                {t('sync.syncNow')}
              </button>
            )}
            <button
              className="secondary-button"
              disabled={busy !== null}
              onClick={() => setConfirm('switch')}
              type="button"
            >
              {t('sync.switchProvider')}
            </button>
            <button
              className="danger-button"
              disabled={busy !== null}
              onClick={() => setConfirm('disconnect')}
              type="button"
            >
              {t('sync.disconnect')}
            </button>
          </div>
          <p className="sync-note">{t('sync.autoNote')}</p>
        </div>
      ) : null}

      {showChooser ? (
        <div className="integration-card">
          <h2>{switching ? t('sync.switchTitle') : t('sync.title')}</h2>
          <p>{switching ? t('sync.switchDescription') : t('sync.description')}</p>
          <fieldset className="sync-provider-choice" disabled={busy !== null}>
            <legend className="sr-only">{t('sync.provider')}</legend>
            <div className="segmented-control">
              {(['google', 'webdav'] as const).map((option) => (
                <button
                  aria-pressed={provider === option}
                  className="segment-button secondary-button"
                  key={option}
                  onClick={() => {
                    setChoice(option)
                    setActionError(null)
                  }}
                  type="button"
                >
                  {option === 'google' ? t('sync.googleDrive') : t('sync.webdav')}
                </button>
              ))}
            </div>
          </fieldset>

          {provider === 'google' ? (
            <div className="sync-form">
              <p>{t('sync.googleDescription')}</p>
              {!googleReady ? (
                <p className="field-hint">
                  <CircleAlert aria-hidden="true" size={16} />
                  <span>{googleSync ? t('sync.googleNotConfigured') : t('sync.googleUnsupported')}</span>
                </p>
              ) : null}
              {busy === 'google' ? (
                <div className="integration-actions">
                  <p aria-live="polite" className="sync-status" role="status">
                    <Loader2 aria-hidden="true" className="import-spinner" size={16} />
                    {t('sync.googleWaiting')}
                  </p>
                  <button className="secondary-button" onClick={() => void cancelGoogle()} type="button">
                    {t('sync.cancel')}
                  </button>
                </div>
              ) : (
                <div className="integration-actions">
                  {switching ? (
                    <button className="secondary-button" onClick={() => setSwitching(false)} type="button">
                      {t('sync.cancel')}
                    </button>
                  ) : null}
                  <button
                    className="primary-button"
                    disabled={!googleReady || busy !== null}
                    onClick={() => void connectGoogle()}
                    type="button"
                  >
                    {t('sync.connectGoogle')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form className="sync-form" onSubmit={connectWebdav}>
              <p>{t('sync.webdavDescription')}</p>
              <label>
                {t('sync.webdavUrl')}
                <input
                  aria-describedby="sync-webdav-url-note"
                  aria-invalid={
                    urlCheck.kind === 'needs_https' || urlCheck.kind === 'credentials' || urlCheck.kind === 'invalid'
                  }
                  autoCapitalize="off"
                  autoComplete="url"
                  disabled={busy !== null}
                  inputMode="url"
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://dav.example.com/dav/"
                  spellCheck={false}
                  type="text"
                  value={url}
                />
              </label>
              <p
                className={
                  urlCheck.kind === 'needs_https' || urlCheck.kind === 'credentials' || urlCheck.kind === 'invalid'
                    ? 'sync-field-message is-error'
                    : 'sync-field-message'
                }
                id="sync-webdav-url-note"
              >
                {urlCheck.kind === 'needs_https'
                  ? t('sync.urlNeedsHttps')
                  : urlCheck.kind === 'credentials'
                    ? t('sync.urlHasCredentials')
                    : urlCheck.kind === 'invalid'
                      ? t('sync.urlInvalid')
                      : urlCheck.kind === 'ok' && urlCheck.addedScheme
                        ? t('sync.urlAddedHttps', { url: urlCheck.url })
                        : t('sync.urlHint')}
              </p>
              <label>
                {t('sync.username')}
                <input
                  autoCapitalize="off"
                  autoComplete="username"
                  disabled={busy !== null}
                  onChange={(event) => setUsername(event.target.value)}
                  spellCheck={false}
                  type="text"
                  value={username}
                />
              </label>
              <label>
                {t('sync.appPassword')}
                <input
                  autoComplete="current-password"
                  disabled={busy !== null}
                  onChange={(event) => setAppPassword(event.target.value)}
                  type="password"
                  value={appPassword}
                />
              </label>
              <p className="sync-field-message">{t('sync.appPasswordHint')}</p>
              <p className="sync-field-message">{t('sync.folderHint', { folder })}</p>
              <div className="integration-actions">
                {busy === 'webdav' ? (
                  <p aria-live="polite" className="sync-status" role="status">
                    <Loader2 aria-hidden="true" className="import-spinner" size={16} />
                    {t('sync.connecting')}
                  </p>
                ) : null}
                {switching ? (
                  <button
                    className="secondary-button"
                    disabled={busy !== null}
                    onClick={() => setSwitching(false)}
                    type="button"
                  >
                    {t('sync.cancel')}
                  </button>
                ) : null}
                <button className="primary-button" disabled={!canConnectWebdav} type="submit">
                  {t('sync.connectWebdav')}
                </button>
              </div>
            </form>
          )}

          {actionError ? (
            <div className="error-banner" role="alert">
              {describeSyncError(t, actionError)}
            </div>
          ) : null}
          <p className="sync-note">{t('sync.encryptionNote')}</p>
        </div>
      ) : null}

      {confirm ? (
        <div className="confirm-layer">
          <button
            aria-label={t('sync.cancel')}
            className="confirm-backdrop"
            disabled={busy === 'disconnect'}
            onClick={() => setConfirm(null)}
            type="button"
          />
          <div aria-labelledby="sync-confirm-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
            <h2 id="sync-confirm-title">
              {confirm === 'disconnect' ? t('sync.disconnectTitle') : t('sync.switchConfirmTitle')}
            </h2>
            <p>{confirm === 'disconnect' ? t('sync.disconnectBody') : t('sync.switchConfirmBody')}</p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                disabled={busy === 'disconnect'}
                onClick={() => setConfirm(null)}
                type="button"
              >
                {t('sync.cancel')}
              </button>
              {confirm === 'disconnect' ? (
                <button
                  className="danger-button"
                  disabled={busy === 'disconnect'}
                  onClick={() => void disconnect()}
                  type="button"
                >
                  {t('sync.disconnect')}
                </button>
              ) : (
                <button className="primary-button" onClick={startSwitch} type="button">
                  {t('sync.switchContinue')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {remoteSheet ? (
        <div className="confirm-layer">
          <button
            aria-label={t('sync.cancel')}
            className="confirm-backdrop"
            disabled={busy === 'unlock'}
            onClick={() => setRemoteSheet(false)}
            type="button"
          />
          <div aria-labelledby="sync-remote-title" aria-modal="true" className="confirm-dialog" role="dialog">
            <h2 id="sync-remote-title">{t('sync.remotePasswordTitle')}</h2>
            <p>{t('sync.remotePasswordBody')}</p>
            <form onSubmit={unlockRemote}>
              <label>
                {t('sync.remotePasswordLabel')}
                <input
                  autoComplete="off"
                  disabled={busy === 'unlock'}
                  onChange={(event) => setRemotePassword(event.target.value)}
                  ref={remotePasswordRef}
                  type="password"
                  value={remotePassword}
                />
              </label>
              {remoteError ? (
                <p className="sync-field-message is-error" role="alert">
                  {describeSyncError(t, remoteError)}
                </p>
              ) : null}
              <div className="confirm-actions">
                {busy === 'unlock' ? <Loader2 aria-hidden="true" className="import-spinner" size={16} /> : null}
                <button
                  className="secondary-button"
                  disabled={busy === 'unlock'}
                  onClick={() => setRemoteSheet(false)}
                  type="button"
                >
                  {t('sync.cancel')}
                </button>
                <button className="primary-button" disabled={!remotePassword || busy === 'unlock'} type="submit">
                  {t('sync.remotePasswordSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
