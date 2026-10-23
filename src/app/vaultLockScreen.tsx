import { Eye, EyeOff, Fingerprint, Loader2 } from 'lucide-react'
import appIcon from '../assets/app-icon.png'
import { getLockScreenVariant, shouldShowTouchIdUnlock } from './lockScreen'
import type { VaultWindowModel } from './useVaultWindow'

/** The lock and first-run screens (moved from App.tsx). */
export function VaultLockScreen({ vw }: { vw: VaultWindowModel }) {
  const {
    biometricsAvailable,
    error,
    features,
    handleBiometricUnlock,
    handleUnlock,
    isUnlocking,
    masterPassword,
    masterPasswordInputRef,
    mode,
    securityPreferences,
    setMasterPassword,
    setShowPassword,
    showPassword,
    t,
  } = vw

  const lockVariant = getLockScreenVariant(mode)
  const showTouchIdUnlock = shouldShowTouchIdUnlock(
    biometricsAvailable,
    securityPreferences.unlockUsingTouchId,
    securityPreferences.unlockWithMacPassword,
  )
  const biometricLabel =
    features.biometrics === 'touch-id' ? t('lock.unlockWithTouchId') : t('lock.unlockWithBiometrics')
  if (lockVariant === 'compact-unlock') {
    return (
      <main className="lock-screen compact-lock-screen" data-tauri-drag-region>
        <form className="compact-unlock-form" onSubmit={handleUnlock}>
          <h1 className="compact-lock-brand">
            <span aria-hidden="true" className="brand-mark is-artwork">
              <img alt="" src={appIcon} />
            </span>
            <span>{t('lock.appName')}</span>
          </h1>
          <div aria-busy={isUnlocking} className="compact-password-control">
            <input
              aria-label={t('lock.masterPassword')}
              minLength={8}
              onChange={(event) => setMasterPassword(event.target.value)}
              placeholder={t('lock.enterPasswordPlaceholder')}
              readOnly={isUnlocking}
              ref={masterPasswordInputRef}
              type={showPassword ? 'text' : 'password'}
              value={masterPassword}
            />
            {isUnlocking ? (
              <span className="compact-unlock-progress" role="status" title={t('lock.unlocking')}>
                <Loader2 aria-hidden="true" className="unlock-spinner" size={16} />
                <span className="sr-only">{t('lock.unlocking')}</span>
              </span>
            ) : null}
            <button
              aria-label={t('vault.showPassword')}
              className="compact-unlock-icon-button"
              hidden={isUnlocking}
              onClick={() => setShowPassword((value) => !value)}
              title={t('vault.showPassword')}
              type="button"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            {showTouchIdUnlock && !isUnlocking ? (
              <button
                aria-label={biometricLabel}
                className="compact-unlock-icon-button"
                onClick={handleBiometricUnlock}
                title={biometricLabel}
                type="button"
              >
                <Fingerprint size={16} strokeWidth={1.5} />
              </button>
            ) : null}
          </div>
          {error ? <div className="compact-lock-error">{error}</div> : null}
        </form>
      </main>
    )
  }

  return (
    <main className="lock-screen" data-tauri-drag-region>
      <section className="lock-panel">
        <div className="brand large">
          <div className="brand-mark is-artwork">
            <img alt="" src={appIcon} />
          </div>
          <div>
            <strong>{t('lock.appName')}</strong>
            <span>{t('lock.tagline')}</span>
          </div>
        </div>
        <form onSubmit={handleUnlock}>
          <h1>{mode === 'setup' ? t('lock.createTitle') : t('lock.unlockTitle')}</h1>
          <p>{mode === 'setup' ? t('lock.createDescription') : t('lock.unlockDescription')}</p>
          <label>
            {t('lock.masterPassword')}
            <input
              minLength={8}
              onChange={(event) => setMasterPassword(event.target.value)}
              placeholder={t('lock.masterPasswordPlaceholder')}
              ref={masterPasswordInputRef}
              type="password"
              value={masterPassword}
            />
          </label>
          {error ? <div className="error-banner">{error}</div> : null}
          <button
            className="primary-button"
            disabled={masterPassword.length < 8 || mode === 'loading' || isUnlocking}
            type="submit"
          >
            {isUnlocking ? (
              <>
                <Loader2 aria-hidden="true" className="unlock-spinner" size={16} />
                {t('lock.unlocking')}
              </>
            ) : mode === 'setup' ? (
              t('lock.createVault')
            ) : (
              t('lock.unlock')
            )}
          </button>
          {mode === 'locked' && showTouchIdUnlock ? (
            <button className="secondary-button" onClick={handleBiometricUnlock} type="button">
              {biometricLabel}
            </button>
          ) : null}
        </form>
      </section>
    </main>
  )
}
