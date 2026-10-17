import { AlertTriangle, Clock, Eye, EyeOff, KeyRound } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  anchorOf,
  FieldActionMenu,
  type FieldMenuAnchor,
  FieldMenuButton,
  fieldActionLabel,
  LargeTypeOverlay,
  useLongPress,
} from './fieldActionControls'
import { emailHref, type FieldActionId, fieldActions, fieldPlainValue, phoneHref } from './fieldActions'
import {
  cardNumberMaxDigits,
  detectCardBrand,
  digitsOnly,
  expiryStatus,
  type FieldIssue,
  type FieldValidation,
  fieldIssue,
  formatCardNumber,
  formatDate,
  formatIban,
  formatMonthYear,
  formatMonthYearInput,
  isConcealedType,
  isMultilineType,
  maskCardNumber,
  openableUrl,
  parseIsoDate,
  sshFingerprint,
  urlHostname,
} from './fieldFormats'
import { type OptionSetName, optionLabelKey, optionSets } from './itemTemplates'
import { openExternal } from './openExternal'
import type { PasswordStrength } from './vaultApi'

/**
 * The two faces of every field, chosen by its type alone: `FieldView` for the read-only item and
 * `FieldEditor` for the form. A template field adds its options, rules and monospace hint through
 * `FieldMeta`; a custom field the user added has no meta and still gets its type's full behaviour.
 */

export type FieldMeta = {
  expiry?: boolean
  inputMode?: 'numeric'
  monospace?: boolean
  options?: OptionSetName
  validation?: FieldValidation
}

/** Fixed length, so a masked value does not give its length away. */
const maskedText = '••••••••'

const strengthLevels = ['weak', 'fair', 'strong', 'excellent'] as const

export function optionLabel(t: (key: string) => string, set: OptionSetName | undefined, value: string): string {
  if (set && (optionSets[set] as readonly string[]).includes(value)) return t(optionLabelKey(set, value))
  return value
}

function cardBrandLabel(t: (key: string) => string, value: string): string | null {
  const brand = detectCardBrand(value)
  return brand ? t(optionLabelKey('cardBrand', brand)) : null
}

export function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  const { t } = useTranslation()
  return (
    <div className={`password-strength is-${strength.level}`}>
      <span aria-hidden="true" className="password-strength-bar">
        {strengthLevels.map((level) => (
          <span
            className={
              strengthLevels.indexOf(level) <= strengthLevels.indexOf(strength.level)
                ? 'password-strength-segment filled'
                : 'password-strength-segment'
            }
            key={level}
          />
        ))}
      </span>
      <span className="password-strength-label">
        <span>{t(`vault.strength.${strength.level}`)}</span>
        <span>{t('vault.strengthBits', { bits: strength.bits })}</span>
      </span>
    </div>
  )
}

function useStrength(value: string, measure?: (value: string) => Promise<PasswordStrength | null>) {
  const [strength, setStrength] = useState<PasswordStrength | null>(null)
  // The caller's function is a fresh closure every render; only the value decides when to measure.
  const measureRef = useRef(measure)
  measureRef.current = measure
  const canMeasure = Boolean(measure)
  useEffect(() => {
    const current = measureRef.current
    if (!canMeasure || !current || !value) {
      setStrength(null)
      return
    }
    let stale = false
    current(value)
      .then((next) => {
        if (!stale) setStrength(next)
      })
      .catch(() => {
        if (!stale) setStrength(null)
      })
    return () => {
      stale = true
    }
  }, [canMeasure, value])
  return strength
}

/** Expired / expires soon, said in words with its own glyph, never by colour alone. */
function ExpiryBadge({ fieldType, value }: { fieldType: string; value: string }) {
  const { t } = useTranslation()
  const status = expiryStatus(value, fieldType, new Date())
  if (!status) return null
  return (
    <span className={`field-status is-${status}`}>
      {status === 'expired' ? <AlertTriangle aria-hidden="true" size={12} /> : <Clock aria-hidden="true" size={12} />}
      {status === 'expired' ? t('vault.expired') : t('vault.expiresSoon')}
    </span>
  )
}

export type FieldViewProps = {
  /** Replaces the copy button, for a value that is not text worth copying (an attachment). */
  actions?: ReactNode
  /** Open & Fill can reach the browser extension (desktop); without it a website only opens. */
  canFill?: boolean
  /** What the copy button writes; defaults to the stored value (card numbers copy digits only). */
  copyValue?: string
  /** Replaces the rendered value, for fields whose value is a reference (a related item's id). */
  display?: ReactNode
  fieldType: string
  footer?: ReactNode
  label: string
  meta?: FieldMeta
  onCopy: (value: string, label: string, sensitive: boolean) => void
  /** Opens a URL field. `fill` asks for Open & Fill; the caller owns the item id the extension needs. */
  onOpenUrl?: (url: string, fill: boolean) => void
  /** ⌘R / Ctrl+R: every secure field of the item revealed at once; a field's own toggle still wins after. */
  revealAll?: boolean
  /** A card number names its network under the digits unless a sibling row already does. */
  showBrand?: boolean
  value: string
  /** The item's own login website, where selecting the address means Open & Fill. */
  website?: boolean
}

const copiedFeedbackMs = 1500

/** Opens a URL outside the app: the opener plugin inside Tauri, a new tab in a browser preview. */
export function openUrlExternally(url: string) {
  if (!openExternal(url)) window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * One read-only field, 1Password-style: selecting the row runs its primary action (copy; Open & Fill for the
 * item's website), the hovered or focused row says which in its trailing hint and then says "Copied", and the
 * chevron — or a right-click, or a long press on a phone — lists everything else the type offers.
 */
export function FieldView({
  actions,
  canFill = false,
  copyValue,
  display,
  fieldType,
  footer,
  label,
  meta,
  onCopy,
  onOpenUrl,
  revealAll = false,
  showBrand = true,
  value,
  website = false,
}: FieldViewProps) {
  const { i18n, t } = useTranslation()
  const [revealed, setRevealed] = useState(revealAll)
  const [copied, setCopied] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<FieldMenuAnchor | null>(null)
  const [largeType, setLargeType] = useState(false)
  const copiedTimer = useRef<number | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const valueId = useId()
  const hintId = useId()
  const longPress = useLongPress((anchor) => setMenuAnchor(anchor))
  const concealed = isConcealedType(fieldType)
  const isCard = fieldType === 'card_number'
  const secret = concealed || isCard
  const locale = i18n.language
  const url = fieldType === 'url' ? openableUrl(value) : null

  useEffect(() => setRevealed(revealAll), [revealAll])
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    },
    [],
  )

  let content: ReactNode = value
  let caption: string | null = null
  if (display !== undefined) content = display
  else if (isCard) {
    content = revealed ? formatCardNumber(value) : maskCardNumber(value)
    caption = showBrand ? cardBrandLabel(t, value) : null
  } else if (concealed) content = revealed ? value : maskedText
  else if (fieldType === 'date') content = formatDate(value, locale)
  else if (fieldType === 'month_year') content = formatMonthYear(value, locale)
  else if (fieldType === 'select') content = optionLabel(t, meta?.options, value)
  else if (fieldType === 'url') content = urlHostname(value) ?? value
  else if (meta?.validation === 'iban') content = formatIban(value)

  const valueClasses = ['field-row-value']
  if (meta?.monospace || isCard || fieldType === 'concealed_multiline') valueClasses.push('is-mono')
  if (isMultilineType(fieldType) && (!concealed || revealed)) valueClasses.push('is-multiline')
  if (secret && !revealed) valueClasses.push('is-masked')

  // A pop-up field copies the words it shows ("Visa"), not the option id it stores.
  const plain =
    copyValue ?? (fieldType === 'select' ? optionLabel(t, meta?.options, value) : fieldPlainValue(fieldType, value))
  // A reference shown by name (a linked item, a provider) is not text to enlarge, and an attachment brings its
  // own button instead of a menu.
  const available =
    actions !== undefined
      ? { menu: [], primary: null }
      : display !== undefined
        ? { menu: ['copy' as const], primary: 'copy' as const }
        : fieldActions({ canFill, fieldType, revealed, value, website })

  function copy() {
    onCopy(plain, label, secret)
    setCopied(true)
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), copiedFeedbackMs)
  }

  function run(id: FieldActionId) {
    switch (id) {
      case 'copy':
        copy()
        return
      case 'open':
      case 'openAndFill': {
        if (!url) return
        if (onOpenUrl) onOpenUrl(url, id === 'openAndFill')
        else openUrlExternally(url)
        return
      }
      case 'reveal':
        setRevealed(true)
        return
      case 'conceal':
        setRevealed(false)
        return
      case 'largeType':
        setLargeType(true)
        return
      case 'sendEmail': {
        const href = emailHref(value)
        if (href) openUrlExternally(href)
        return
      }
      case 'call': {
        const href = phoneHref(value)
        if (href) openUrlExternally(href)
        return
      }
    }
  }

  const primary = available.primary
  const hint = copied ? t('fieldActions.copied') : primary ? fieldActionLabel(t, primary) : null
  const openMenu = (anchor: FieldMenuAnchor) => {
    if (available.menu.length) setMenuAnchor(anchor)
  }

  return (
    <div
      className={[
        'field-row',
        primary ? 'is-actionable' : '',
        copied ? 'is-copied' : '',
        menuAnchor ? 'is-menu-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onContextMenu={(event) => {
        if (!available.menu.length) return
        event.preventDefault()
        openMenu({ bottom: event.clientY, left: event.clientX, right: event.clientX + 220, top: event.clientY })
      }}
      ref={rowRef}
    >
      {primary ? (
        // The whole row is the primary action, drawn as a transparent button under the content so the
        // trailing buttons stay their own targets (a button cannot hold the strength meter's blocks).
        <button
          aria-describedby={hintId}
          aria-labelledby={`${labelId} ${valueId}`}
          className="field-row-primary"
          onClick={() => {
            if (longPress.consumeClick()) return
            run(primary)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault()
              openMenu(anchorOf(event.currentTarget))
            }
          }}
          type="button"
          {...longPress.handlers}
        />
      ) : null}
      <div className="field-row-main">
        <span className="field-row-label" id={labelId}>
          {label}
        </span>
        <span className={valueClasses.join(' ')} id={valueId} title={url ?? undefined}>
          {content}
        </span>
        {caption || (meta?.expiry && (fieldType === 'date' || fieldType === 'month_year')) ? (
          <span className="field-row-meta">
            {caption ? <span className="field-row-caption">{caption}</span> : null}
            {meta?.expiry ? <ExpiryBadge fieldType={fieldType} value={value} /> : null}
          </span>
        ) : null}
        {footer}
      </div>
      <div className="field-row-actions">
        {hint ? (
          <span aria-live="polite" className="field-row-hint" id={hintId}>
            {hint}
          </span>
        ) : null}
        {actions}
        {available.menu.length ? (
          <FieldMenuButton expanded={menuAnchor !== null} label={label} onOpen={openMenu} />
        ) : null}
      </div>
      {menuAnchor ? (
        <FieldActionMenu
          actions={available.menu}
          anchor={menuAnchor}
          label={label}
          onClose={(restoreFocus) => {
            setMenuAnchor(null)
            if (restoreFocus) rowRef.current?.querySelector<HTMLButtonElement>('.field-menu-button')?.focus()
          }}
          onSelect={run}
        />
      ) : null}
      {largeType ? <LargeTypeOverlay label={label} onClose={() => setLargeType(false)} value={plain} /> : null}
    </div>
  )
}

/** The fingerprint is computed from the public key on the fly and never stored, so it cannot drift. */
export function SshFingerprintView({
  label,
  onCopy,
  publicKey,
}: {
  label: string
  onCopy: FieldViewProps['onCopy']
  publicKey: string
}) {
  const fingerprint = useSshFingerprint(publicKey)
  if (!fingerprint) return null
  return <FieldView fieldType="text" label={label} meta={{ monospace: true }} onCopy={onCopy} value={fingerprint} />
}

export function useSshFingerprint(publicKey: string): string | null {
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    if (!publicKey.trim()) {
      setFingerprint(null)
      return
    }
    sshFingerprint(publicKey)
      .then((next) => {
        if (!stale) setFingerprint(next)
      })
      .catch(() => {
        if (!stale) setFingerprint(null)
      })
    return () => {
      stale = true
    }
  }, [publicKey])
  return fingerprint
}

/** The edit-mode echo of the derived fingerprint, so a pasted key can be checked against the server's. */
export function SshFingerprintCaption({ label, publicKey }: { label: string; publicKey: string }) {
  const fingerprint = useSshFingerprint(publicKey)
  if (!fingerprint) return null
  return (
    <p className="field-caption">
      <span>{label}</span>
      <code>{fingerprint}</code>
    </p>
  )
}

function hintText(t: (key: string, options?: Record<string, unknown>) => string, issue: FieldIssue, value: string) {
  if (issue === 'cardLength') return t('fieldHints.cardLength', { count: digitsOnly(value).length })
  return t(`fieldHints.${issue}`)
}

function textareaRows(value: string, minimum: number) {
  return Math.min(Math.max(value.split('\n').length, minimum), 14)
}

export type FieldEditorProps = {
  fieldType: string
  footer?: ReactNode
  label: string
  /** Measures a password while it is typed; only `password` fields pass it. */
  measureStrength?: (value: string) => Promise<PasswordStrength | null>
  meta?: FieldMeta
  onChange: (value: string) => void
  onGenerate?: () => Promise<string>
  placeholder: string
  value: string
}

/**
 * The value control for one field in the form. Hints appear once focus leaves the field
 * (text-fields.md › "Validate fields when it makes sense": an address is checked when people move on),
 * say what is wrong and how to fix it, and never block saving.
 */
export function FieldEditor({
  fieldType,
  footer,
  label,
  measureStrength,
  meta,
  onChange,
  onGenerate,
  placeholder,
  value,
}: FieldEditorProps) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const [focused, setFocused] = useState(false)
  const hintId = useId()
  const strength = useStrength(fieldType === 'password' ? value : '', measureStrength)
  const issue = focused ? null : fieldIssue(fieldType, value, meta?.validation)
  const common = {
    'aria-describedby': issue ? hintId : undefined,
    'aria-invalid': issue ? true : undefined,
    'aria-label': label,
    autoComplete: 'off',
    onBlur: () => setFocused(false),
    onFocus: () => setFocused(true),
    placeholder,
    spellCheck: false,
  } as const
  const inputClass = meta?.monospace ? 'custom-field-value-input is-mono' : 'custom-field-value-input'

  let control: ReactNode
  if (fieldType === 'select') {
    const choices = meta?.options ? (optionSets[meta.options] as readonly string[]) : []
    control = (
      <select {...common} className="field-select" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{t('vault.notSet')}</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {optionLabel(t, meta?.options, choice)}
          </option>
        ))}
        {/* A value typed by an older build, or by hand, stays selectable rather than vanishing. */}
        {value && !choices.includes(value) ? <option value={value}>{value}</option> : null}
      </select>
    )
  } else if (isMultilineType(fieldType)) {
    const concealed = fieldType === 'concealed_multiline'
    const classes = [inputClass, 'field-textarea']
    if (concealed || meta?.monospace) classes.push('is-mono')
    if (concealed && !revealed) classes.push('is-concealed')
    control = (
      <textarea
        {...common}
        className={classes.join(' ')}
        onChange={(event) => onChange(event.target.value)}
        rows={textareaRows(value, concealed || meta?.monospace ? 3 : 2)}
        value={value}
      />
    )
  } else if (fieldType === 'password' || fieldType === 'concealed' || fieldType === 'security_questions') {
    control = (
      <input
        {...common}
        className={`${inputClass} is-secret`}
        inputMode={meta?.inputMode}
        maxLength={meta?.validation === 'cvv' ? 4 : undefined}
        onChange={(event) => onChange(event.target.value)}
        type={revealed ? 'text' : 'password'}
        value={value}
      />
    )
  } else if (fieldType === 'card_number') {
    control = (
      <input
        {...common}
        className={`${inputClass} is-mono`}
        inputMode="numeric"
        // Grouping spaces included: 19 digits print in at most 5 groups.
        maxLength={cardNumberMaxDigits + 4}
        onChange={(event) => onChange(formatCardNumber(event.target.value))}
        type="text"
        value={value}
      />
    )
  } else if (fieldType === 'month_year') {
    control = (
      <input
        {...common}
        className={inputClass}
        inputMode="numeric"
        maxLength={7}
        onChange={(event) => onChange(formatMonthYearInput(event.target.value))}
        placeholder={t('vault.monthYearPlaceholder')}
        type="text"
        value={value}
      />
    )
  } else if (fieldType === 'date' && (!value || parseIsoDate(value))) {
    control = (
      <input
        {...common}
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    )
  } else {
    // email/url stay type="text": the detail form has no noValidate, so the browser's own constraint
    // validation on those types would block saving. The hint below does the checking instead.
    const inputMode =
      fieldType === 'email' ? 'email' : fieldType === 'phone' ? 'tel' : fieldType === 'url' ? 'url' : meta?.inputMode
    control = (
      <input
        {...common}
        className={inputClass}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    )
  }

  const canReveal =
    fieldType === 'password' ||
    fieldType === 'concealed' ||
    fieldType === 'concealed_multiline' ||
    fieldType === 'security_questions'
  const brand = fieldType === 'card_number' ? cardBrandLabel(t, value) : null

  return (
    <div className="field-editor">
      <div className="field-editor-row">
        {control}
        {brand ? <span className="field-row-caption">{brand}</span> : null}
        {canReveal ? (
          <button
            aria-label={revealed ? t('vault.concealField', { label }) : t('vault.revealField', { label })}
            aria-pressed={revealed}
            className="field-editor-button"
            onClick={() => setRevealed((current) => !current)}
            title={revealed ? t('vault.concealField', { label }) : t('vault.revealField', { label })}
            type="button"
          >
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        ) : null}
        {fieldType === 'password' && onGenerate ? (
          <button
            aria-label={t('vault.generateField', { label })}
            className="field-editor-button"
            onClick={async () => {
              onChange(await onGenerate())
              setRevealed(true)
            }}
            title={t('vault.generateField', { label })}
            type="button"
          >
            <KeyRound size={15} />
          </button>
        ) : null}
      </div>
      {strength ? <PasswordStrengthMeter strength={strength} /> : null}
      {footer}
      {issue ? (
        <p className="field-hint" id={hintId}>
          <AlertTriangle aria-hidden="true" size={12} />
          <span>{hintText(t, issue, value)}</span>
        </p>
      ) : null}
    </div>
  )
}
