import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Check, Cog, Copy, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlatformState } from '../skin/runtime'
import { copyText } from './clipboard'
import { describeError } from './errors'
import { applyLanguagePreference, getStoredLanguagePreference, type LanguagePreference, languageOptions } from './i18n'
import { featuresFor, quickAccessKeys, shortcutLabel } from './platformFeatures'
import {
  type AccountPasswordRequirement,
  type AutoLockIdleDuration,
  accountPasswordOptions,
  autoLockIdleOptions,
  type DeviceUnlockDuration,
  deviceUnlockOptions,
  loadSecurityPreferences,
  type SecurityPreferences,
  saveSecurityPreferences,
} from './securityPreferences'
import {
  isSettingsTab,
  type SettingsTab,
  settingsTabEvent,
  settingsTabIcons,
  settingsTabLabels,
  settingsTabs,
} from './settingsTabs'
import { forgetSiteIcons, readSiteIconsEnabled, writeSiteIconsEnabled } from './siteIcons'
import { SyncSettingsPane } from './syncSettingsPane'
import { followSystemAppearance } from './theme'
import { Toast, toastPositions, useToastPosition, writeToastPosition } from './toast'
import {
  type AppStatus,
  type BreachCheckResult,
  type BrowserConnectionStatus,
  vaultApi,
  type WatchtowerReport,
} from './vaultApi'
import { followLanguageInTitle } from './windowTitle'

/**
 * Settings: its own window on desktop, a tab of the one window on phones (`embedded`). What a pane offers
 * follows `featuresFor(platform)` — no extension pairing, launch-at-login or keyboard shortcuts on a phone, no
 * Touch ID rows off the Mac.
 */
export function SettingsWindow({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  const { platform } = usePlatformState()
  const features = featuresFor(platform)
  const visibleSettingsTabs = settingsTabs.filter(
    (id) => (id !== 'browser' || features.browserExtension) && (id !== 'shortcuts' || features.keyboardShortcuts),
  )
  const quickAccess = quickAccessKeys(platform)
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    return isSettingsTab(requested) ? requested : 'general'
  })
  // The toolbar search in the main window can ask an open Settings for another pane.
  useEffect(() => {
    const onLocal = (event: Event) => {
      const tab = (event as CustomEvent<unknown>).detail
      if (isSettingsTab(tab)) setActiveTab(tab)
    }
    window.addEventListener(settingsTabEvent, onLocal)
    if (embedded) return () => window.removeEventListener(settingsTabEvent, onLocal)
    let unlisten: (() => void) | null = null
    let disposed = false
    listen<unknown>(settingsTabEvent, (event) => {
      if (isSettingsTab(event.payload)) setActiveTab(event.payload)
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener(settingsTabEvent, onLocal)
    }
  }, [embedded])
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [siteIconsOn, setSiteIconsOn] = useState(() => readSiteIconsEnabled())
  const toastPosition = useToastPosition()
  const [watchtower, setWatchtower] = useState<WatchtowerReport | null>(null)
  const [breachResult, setBreachResult] = useState<BreachCheckResult | null>(null)
  const [browserToken, setBrowserToken] = useState('')
  const [tokenCopied, setTokenCopied] = useState(false)
  const [connection, setConnection] = useState<BrowserConnectionStatus | null>(null)
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [language, setLanguage] = useState<LanguagePreference>(() => getStoredLanguagePreference())

  // Native messaging state while the Browser Extension pane is open: registration happens shortly after
  // startup and a host connects whenever the extension wakes, so it is re-read every few seconds.
  useEffect(() => {
    if (activeTab !== 'browser' || !features.browserExtension) return
    let cancelled = false
    const read = () => {
      vaultApi
        .browserConnectionStatus()
        .then((next) => {
          if (!cancelled) setConnection(next)
        })
        .catch(() => {})
    }
    read()
    const timer = window.setInterval(read, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeTab, features.browserExtension])

  // Light and dark follow the system only (owner 2026-10-23); there is no setting for it.
  useEffect(() => followSystemAppearance(), [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<LanguagePreference>('mimatory-language-changed', (event) => {
      setLanguage(event.payload)
      void applyLanguagePreference(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SecurityPreferences>('mimatory-security-preferences-changed', (event) => {
      setSecurityPreferences(event.payload)
      saveSecurityPreferences(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    vaultApi
      .initialize()
      .then(setStatus)
      .catch((nextError) => setError(describeError(nextError)))
    vaultApi
      .isAutostartEnabled()
      .then(setAutostartEnabled)
      .catch(() => setAutostartEnabled(false))
  }, [])

  async function updateSiteIcons(enabled: boolean) {
    setError(null)
    writeSiteIconsEnabled(enabled)
    setSiteIconsOn(enabled)
    if (enabled) return
    // Off means off: the icons already saved go too, not just future downloads.
    forgetSiteIcons()
    try {
      await vaultApi.clearSiteIcons()
    } catch {
      // Locked: nothing can be read without the key anyway, and the next unlock with the setting
      // off neither shows nor fetches any icon.
    }
  }

  async function updateAutostart(enabled: boolean) {
    setError(null)
    try {
      await vaultApi.setAutostart(enabled)
      setAutostartEnabled(enabled)
    } catch (nextError) {
      setError(describeError(nextError))
    }
  }

  async function loadWatchtower() {
    setError(null)
    try {
      setWatchtower(await vaultApi.watchtower())
    } catch (nextError) {
      setError(describeError(nextError))
    }
  }

  async function checkBreaches() {
    setError(null)
    setOperationMessage(t('messages.checkingBreaches'))
    try {
      setBreachResult(await vaultApi.checkBreaches())
    } catch (nextError) {
      setError(describeError(nextError))
    } finally {
      setOperationMessage(null)
    }
  }

  async function copyPairingToken() {
    // The token unlocks the bridge, so it follows the same 90-second clipboard clear as a password.
    const copied = await copyText(browserToken, {
      clearAfter90Seconds: loadSecurityPreferences().clearClipboardAfter90Seconds,
      sensitive: true,
    }).catch(() => false)
    if (!copied) return
    setTokenCopied(true)
    window.setTimeout(() => setTokenCopied(false), 1500)
  }

  async function generatePairingToken() {
    setTokenCopied(false)
    setBrowserToken(await vaultApi.generateBrowserPairingToken())
  }

  async function updateLanguage(nextLanguage: LanguagePreference) {
    setLanguage(nextLanguage)
    await applyLanguagePreference(nextLanguage)
    await emit('mimatory-language-changed', nextLanguage)
  }

  async function updateSecurityPreferences(nextPreferences: SecurityPreferences) {
    setSecurityPreferences(nextPreferences)
    saveSecurityPreferences(nextPreferences)
    await emit('mimatory-security-preferences-changed', nextPreferences)
  }

  async function updateSecurityPreference<K extends keyof SecurityPreferences>(key: K, value: SecurityPreferences[K]) {
    await updateSecurityPreferences({
      ...securityPreferences,
      [key]: value,
    })
  }

  const locked = status ? !status.unlocked : true
  // Linux windows have no title bar (Hyprland), so the settings window offers its own way out: a close
  // button and Escape.
  const ownCloseButton = features.undecoratedWindows && !embedded

  // Its own window (not the pane embedded on phones) is titled in the UI language: 密码库存设置 in zh.
  useEffect(() => (embedded ? undefined : followLanguageInTitle('settings.windowTitle')), [embedded])

  useEffect(() => {
    if (!ownCloseButton) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void getCurrentWebviewWindow().close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ownCloseButton])

  const Shell = embedded ? 'div' : 'main'

  return (
    <Shell className="settings-shell" data-tauri-drag-region>
      <aside className="settings-sidebar h-full" data-tauri-drag-region="deep">
        <div className="settings-title">
          <div className="brand-mark">
            <Cog size={16} />
          </div>
          <div>
            <strong>{t('settings.title')}</strong>
            <span>{t('settings.subtitle')}</span>
          </div>
        </div>
        <nav aria-label={t('landmarks.settingsSections')} className="settings-tabs">
          {visibleSettingsTabs.map((id) => {
            const Icon = settingsTabIcons[id]
            return (
              <button
                className={activeTab === id ? 'active' : ''}
                key={id}
                onClick={() => setActiveTab(id)}
                title={t(settingsTabLabels[id])}
                type="button"
              >
                <Icon aria-hidden="true" size={16} />
                <span>{t(settingsTabLabels[id])}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <section className="settings-content">
        <header className="settings-header" data-tauri-drag-region="deep">
          <div>
            <h1>{t(settingsTabLabels[activeTab])}</h1>
            <p>{locked ? t('settings.lockedHint') : t('settings.unlockedHint')}</p>
          </div>
          {ownCloseButton ? (
            <button
              aria-label={t('common.close')}
              className="icon-button settings-close-button"
              onClick={() => void getCurrentWebviewWindow().close()}
              title={t('common.close')}
              type="button"
            >
              <X size={16} />
            </button>
          ) : null}
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        <Toast message={operationMessage} onDismiss={() => setOperationMessage(null)} />

        {activeTab === 'general' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('settings.language')}</h2>
              <p>{t('settings.languageDescription')}</p>
              <label>
                {t('settings.language')}
                <select onChange={(event) => updateLanguage(event.target.value as LanguagePreference)} value={language}>
                  <option value="system">{t('settings.languageSystem')}</option>
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="integration-card">
              <h2>{t('settings.siteIcons')}</h2>
              <p>{t('settings.siteIconsDescription')}</p>
              <label className="checkbox-row">
                <input
                  checked={siteIconsOn}
                  onChange={(event) => void updateSiteIcons(event.target.checked)}
                  type="checkbox"
                />
                {t('settings.downloadSiteIcons')}
              </label>
            </div>
            {features.autostart ? (
              <div className="integration-card">
                <h2>{t('settings.autostart')}</h2>
                <p>{t('settings.autostartDescription')}</p>
                <label className="checkbox-row">
                  <input
                    checked={autostartEnabled}
                    onChange={(event) => void updateAutostart(event.target.checked)}
                    type="checkbox"
                  />
                  {t('settings.autostart')}
                </label>
              </div>
            ) : null}
            <div className="integration-card">
              <h2>{t('settings.vaultStatus')}</h2>
              <div className="watchtower-grid">
                <span>
                  {t('settings.database')}: {status?.database_ready ? t('settings.ready') : t('settings.pending')}
                </span>
                <span>
                  {t('settings.masterPassword')}:{' '}
                  {status?.has_master_password ? t('settings.configured') : t('settings.notConfigured')}
                </span>
                <span>
                  {t('settings.session')}: {status?.unlocked ? t('settings.unlocked') : t('settings.locked')}
                </span>
                <span>
                  {t('settings.app')}: {t('settings.appName')}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'sync' ? <SyncSettingsPane googleSync={features.googleSync} /> : null}

        {activeTab === 'appearance' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('settings.toastPosition')}</h2>
              <p>{t('settings.toastPositionDescription')}</p>
              <div className="segmented-control">
                {toastPositions.map((option) => (
                  <button
                    aria-pressed={toastPosition === option}
                    className="segment-button secondary-button"
                    key={option}
                    onClick={() => writeToastPosition(option)}
                    type="button"
                  >
                    {t(`settings.toastPositions.${option}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'browser' && features.browserExtension ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('integrations.browserExtension')}</h2>
              <p>{t('integrations.browserDescription')}</p>
              <p>{t('integrations.nativeDescription')}</p>
              {connection ? (
                <>
                  <p aria-live="polite" role="status">
                    {connection.connected > 0 ? t('integrations.nativeConnected') : t('integrations.nativeWaiting')}
                  </p>
                  <p>
                    {connection.registeredBrowsers.length > 0
                      ? t('integrations.nativeRegistered', { browsers: connection.registeredBrowsers.join(', ') })
                      : t('integrations.nativeNotRegistered')}
                  </p>
                  <p>
                    {t('integrations.extensionId')} <code>{connection.extensionId}</code>
                  </p>
                </>
              ) : null}
            </div>
            <div className="integration-card">
              <h2>{t('integrations.pairingFallback')}</h2>
              <p>{t('integrations.pairingFallbackDescription')}</p>
              <code>http://127.0.0.1:17891</code>
              <button className="secondary-button" disabled={locked} onClick={generatePairingToken} type="button">
                {t('integrations.generatePairingToken')}
              </button>
              {browserToken ? (
                <div className="pairing-token-row">
                  <code>{browserToken}</code>
                  <button
                    aria-label={tokenCopied ? t('fieldActions.copied') : t('fieldActions.copy')}
                    className="icon-button pairing-token-copy"
                    onClick={copyPairingToken}
                    title={tokenCopied ? t('fieldActions.copied') : t('fieldActions.copy')}
                    type="button"
                  >
                    {tokenCopied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'watchtower' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('integrations.watchtower')}</h2>
              <p>{t('integrations.watchtowerDescription')}</p>
              <button className="secondary-button" disabled={locked} onClick={loadWatchtower} type="button">
                {t('integrations.runWatchtower')}
              </button>
              {watchtower ? (
                <div className="watchtower-grid">
                  <strong>{t('integrations.score', { score: watchtower.score })}</strong>
                  <span>{t('integrations.items', { count: watchtower.total_items })}</span>
                  <span>{t('integrations.weak', { count: watchtower.weak_passwords.length })}</span>
                  <span>{t('integrations.reused', { count: watchtower.reused_passwords.length })}</span>
                  <span>{t('integrations.missingWebsites', { count: watchtower.missing_websites.length })}</span>
                  <span>{t('integrations.missingTotp', { count: watchtower.missing_totp.length })}</span>
                  <span>{t('integrations.expiring', { count: watchtower.expiring_items.length })}</span>
                </div>
              ) : null}
              <button className="secondary-button" disabled={locked} onClick={checkBreaches} type="button">
                {t('integrations.checkBreaches')}
              </button>
              {breachResult ? (
                <p>{t('integrations.breachedResult', { count: breachResult.breached_passwords.length })}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'security' ? (
          <div className="settings-section">
            <div className="security-group">
              <h2>{t('security.unlock')}</h2>
              {/* The phones keep the same preference key: it means "biometric unlock" wherever it exists. */}
              {features.biometrics ? (
                <label className="security-check-row">
                  <input
                    checked={securityPreferences.unlockUsingTouchId}
                    onChange={(event) => updateSecurityPreference('unlockUsingTouchId', event.target.checked)}
                    type="checkbox"
                  />
                  {features.biometrics === 'touch-id'
                    ? t('security.unlockUsingTouchId')
                    : t('security.unlockUsingBiometrics')}
                </label>
              ) : null}
              {features.biometrics === 'touch-id' ? (
                <label className="security-check-row">
                  <input
                    checked={securityPreferences.unlockWithMacPassword}
                    onChange={(event) => updateSecurityPreference('unlockWithMacPassword', event.target.checked)}
                    type="checkbox"
                  />
                  {t('security.unlockWithMacPassword')}
                </label>
              ) : null}
              <label className="security-inline-row">
                <span>{t('security.unlockWithDevice')}</span>
                <select
                  onChange={(event) =>
                    updateSecurityPreference('deviceUnlockDuration', event.target.value as DeviceUnlockDuration)
                  }
                  value={securityPreferences.deviceUnlockDuration}
                >
                  {deviceUnlockOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`security.deviceUnlockOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="security-inline-row">
                <span>{t('security.requireAccountPassword')}</span>
                <select
                  onChange={(event) =>
                    updateSecurityPreference(
                      'accountPasswordRequirement',
                      event.target.value as AccountPasswordRequirement,
                    )
                  }
                  value={securityPreferences.accountPasswordRequirement}
                >
                  {accountPasswordOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`security.accountPasswordOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="security-help">{t('security.accountPasswordHelp')}</p>
            </div>

            <div className="security-group">
              <h2>{t('security.autoLock')}</h2>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.lockWhenDeviceLocks}
                  onChange={(event) => updateSecurityPreference('lockWhenDeviceLocks', event.target.checked)}
                  type="checkbox"
                />
                {t('security.lockWhenDeviceLocks')}
              </label>
              <label className="security-inline-row">
                <span>{t('security.lockAfterIdle')}</span>
                <select
                  onChange={(event) =>
                    updateSecurityPreference('autoLockIdleDuration', event.target.value as AutoLockIdleDuration)
                  }
                  value={securityPreferences.autoLockIdleDuration}
                >
                  {autoLockIdleOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`security.autoLockOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="security-group">
              <h2>{t('security.clipboard')}</h2>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.clearClipboardAfter90Seconds}
                  onChange={(event) => updateSecurityPreference('clearClipboardAfter90Seconds', event.target.checked)}
                  type="checkbox"
                />
                {t('security.clearClipboardAfter90Seconds')}
              </label>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.useUniversalClipboard}
                  onChange={(event) => updateSecurityPreference('useUniversalClipboard', event.target.checked)}
                  type="checkbox"
                />
                {t('security.useUniversalClipboard')}
              </label>
            </div>
          </div>
        ) : null}

        {activeTab === 'shortcuts' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('shortcuts.title')}</h2>
              <p>{t('shortcuts.description')}</p>
              <div className="shortcut-list">
                {[
                  [shortcutLabel('mod+,', platform), 'shortcuts.openSettings'],
                  [shortcutLabel('mod+n', platform), 'shortcuts.newItem'],
                  [shortcutLabel('mod+f', platform), 'shortcuts.focusSearch'],
                  [shortcutLabel('mod+↑', platform), 'shortcuts.previousItem'],
                  [shortcutLabel('mod+↓', platform), 'shortcuts.nextItem'],
                  [shortcutLabel('mod+k', platform), 'shortcuts.lockVault'],
                  [shortcutLabel('mod+c', platform), 'shortcuts.copyUsername'],
                  [shortcutLabel('mod+shift+c', platform), 'shortcuts.copyPassword'],
                  [shortcutLabel('mod+alt+c', platform), 'shortcuts.copyOtp'],
                  [shortcutLabel('mod+shift+f', platform), 'shortcuts.openAndFill'],
                  [shortcutLabel('mod+r', platform), 'shortcuts.revealSecure'],
                  // Linux: the compositor owns global keys, so the row names the command to bind.
                  ...(quickAccess ? [[quickAccess, 'shortcuts.quickAccess']] : []),
                ].map(([keys, label]) => (
                  <div className="shortcut-row" key={keys}>
                    <kbd>{keys}</kbd>
                    <span>{t(label)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </Shell>
  )
}
