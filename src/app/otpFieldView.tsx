import { ScanQrCode } from 'lucide-react'
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FieldActionMenu,
  type FieldMenuAnchor,
  FieldMenuButton,
  LargeTypeOverlay,
  useLongPress,
} from './fieldActionControls'
import { getTotpProgress, otpCodeGroups } from './totpDisplay'
import type { FieldTotpPreview } from './vaultModel'

/**
 * The one-time password as a field row of the credentials card (1Password 8, owner screenshot 2026-10-17):
 * label, then the code as "214 • 685" with a countdown pill; selecting the row copies the code, the chevron adds
 * Show in Large Type and the two ways to hand the secret to another authenticator.
 */
export function OtpFieldView({
  label,
  onCopy,
  onCopySecret,
  onCopySetupLink,
  preview,
}: {
  label: string
  onCopy: () => void
  onCopySecret: () => void
  onCopySetupLink: () => void
  preview?: FieldTotpPreview
}) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<FieldMenuAnchor | null>(null)
  const [largeType, setLargeType] = useState(false)
  const [copied, setCopied] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const valueId = useId()
  const hintId = useId()
  const longPress = useLongPress((anchor) => setMenuAnchor(anchor))
  const copyTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  function copy() {
    if (!preview) return
    onCopy()
    setCopied(true)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const groups = preview ? otpCodeGroups(preview.code) : []
  const seconds = preview?.secondsRemaining ?? 0
  return (
    <div
      className={[
        'field-row',
        preview ? 'is-actionable' : '',
        copied ? 'is-copied' : '',
        menuAnchor ? 'is-menu-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuAnchor({ bottom: event.clientY, left: event.clientX, right: event.clientX + 220, top: event.clientY })
      }}
      ref={rowRef}
    >
      {preview ? (
        <button
          aria-describedby={hintId}
          aria-labelledby={`${labelId} ${valueId}`}
          className="field-row-primary"
          onClick={() => {
            if (longPress.consumeClick()) return
            copy()
          }}
          type="button"
          {...longPress.handlers}
        />
      ) : null}
      <div className="field-row-main">
        <span className="field-row-label" id={labelId}>
          {label}
        </span>
        <span className="field-row-value otp-value" id={valueId}>
          {preview ? (
            <>
              <span className="otp-code">
                {groups.map((group, index) => (
                  <span className="contents" key={group + index.toString()}>
                    {index > 0 ? (
                      <span aria-hidden="true" className="otp-code-separator">
                        •
                      </span>
                    ) : null}
                    <span>{group}</span>
                  </span>
                ))}
              </span>
              <span
                aria-label={t('vault.otpSecondsRemaining', { seconds })}
                className={seconds <= 5 ? 'otp-countdown is-ending' : 'otp-countdown'}
                role="timer"
                style={{ '--otp-progress': getTotpProgress(seconds).toString() } as CSSProperties}
              >
                <span aria-hidden="true" className="otp-countdown-ring" />
                <span>{seconds}</span>
              </span>
            </>
          ) : (
            <span className="field-row-caption">{t('vault.otpCodePending')}</span>
          )}
        </span>
      </div>
      <div className="field-row-actions">
        {preview ? (
          <span aria-live="polite" className="field-row-hint" id={hintId}>
            {copied ? t('fieldActions.copied') : t('fieldActions.copy')}
          </span>
        ) : null}
        <FieldMenuButton expanded={menuAnchor !== null} label={label} onOpen={setMenuAnchor} />
      </div>
      {menuAnchor ? (
        <FieldActionMenu
          actions={preview ? ['copy', 'largeType', 'copySecret', 'copySetupLink'] : ['copySecret', 'copySetupLink']}
          anchor={menuAnchor}
          label={label}
          onClose={(restoreFocus) => {
            setMenuAnchor(null)
            if (restoreFocus) rowRef.current?.querySelector<HTMLButtonElement>('.field-menu-button')?.focus()
          }}
          onSelect={(id) => {
            if (id === 'copy') copy()
            else if (id === 'largeType') setLargeType(true)
            else if (id === 'copySecret') onCopySecret()
            else if (id === 'copySetupLink') onCopySetupLink()
          }}
        />
      ) : null}
      {/* The code changes every period, so the overlay follows the live code rather than a snapshot. */}
      {largeType && preview ? (
        <LargeTypeOverlay label={label} onClose={() => setLargeType(false)} value={preview.code} />
      ) : null}
    </div>
  )
}

export function OtpScanButton({ label, onScan }: { label: string; onScan: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      aria-label={`${t('fieldRows.scanQr')}: ${label}`}
      className="field-type-button"
      onClick={onScan}
      title={t('fieldRows.scanQr')}
      type="button"
    >
      <ScanQrCode aria-hidden="true" size={18} />
    </button>
  )
}
