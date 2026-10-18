import { KeyRound, RotateCw } from 'lucide-react'
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { usePlatformState } from '../skin/runtime'
import { useAnchoredPanel } from './anchoredPanel'
import {
  applyGeneratorChange,
  clampToLimits,
  type GeneratorChange,
  generatorAmount,
  generatorLimits,
  generatorTypes,
  passwordRuns,
  rememberedGeneratorOptions,
  rememberGeneratorOptions,
  strengthFill,
} from './passwordGenerator'
import type { PasswordGeneratorMode, PasswordGeneratorOptions, PasswordStrength } from './vaultApi'

export type PasswordGeneratorPanelProps = {
  generate: (options: PasswordGeneratorOptions) => Promise<string>
  initialOptions: PasswordGeneratorOptions
  measure?: (value: string) => Promise<PasswordStrength | null>
  onCancel: () => void
  onOptionsChange?: (options: PasswordGeneratorOptions) => void
  onUse: (password: string) => void
  /** A bottom sheet on phones instead of a popover. */
  sheet?: boolean
  style?: CSSProperties
}

const typeLabelKeys: Record<PasswordGeneratorMode, string> = {
  passphrase: 'generator.typePassphrase',
  pin: 'generator.typePin',
  random: 'generator.typeRandom',
}

const amountLabelKeys: Record<PasswordGeneratorMode, string> = {
  passphrase: 'generator.words',
  pin: 'generator.digits',
  random: 'generator.characters',
}

const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled])'

/**
 * 1Password 8's generator: Cancel · regenerate · Use, the password with digits and symbols coloured, a thin
 * strength bar, then hairline-separated rows (Type, the length slider with its number field, Numbers, Symbols).
 * Every change regenerates at once; Use hands the password back, Cancel and Escape hand nothing back.
 */
export function PasswordGeneratorPanel({
  generate,
  initialOptions,
  measure,
  onCancel,
  onOptionsChange,
  onUse,
  sheet = false,
  style,
}: PasswordGeneratorPanelProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState(initialOptions)
  const [round, setRound] = useState(0)
  const [password, setPassword] = useState('')
  const [strength, setStrength] = useState<PasswordStrength | null>(null)
  const [amountDraft, setAmountDraft] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const defaultButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const limits = generatorLimits[options.mode]
  const amount = generatorAmount(options)
  const amountLabel = t(amountLabelKeys[options.mode])

  // Each option change (and each press of regenerate) asks for a fresh password; a slow answer to an older
  // request never overwrites a newer one. `round` is the regenerate button's trigger.
  useEffect(() => {
    let stale = false
    generate(options)
      .then((next) => {
        if (!stale) setPassword(next)
      })
      .catch(() => {
        if (!stale) setPassword('')
      })
    return () => {
      stale = true
    }
  }, [generate, options, round])

  useEffect(() => {
    if (!measure || !password) {
      setStrength(null)
      return
    }
    let stale = false
    measure(password)
      .then((next) => {
        if (!stale) setStrength(next)
      })
      .catch(() => {
        if (!stale) setStrength(null)
      })
    return () => {
      stale = true
    }
  }, [measure, password])

  // The default button takes focus once the first password is there (it is disabled until then), so Return
  // uses the password and Escape (handled by the opener) cancels.
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current || !password) return
    focused.current = true
    defaultButtonRef.current?.focus()
  }, [password])

  function change(next: GeneratorChange) {
    const updated = applyGeneratorChange(options, next)
    setOptions(updated)
    onOptionsChange?.(updated)
  }

  function commitDraft() {
    if (amountDraft === null) return
    change({ kind: 'amount', value: clampToLimits(Number(amountDraft), limits) })
    setAmountDraft(null)
  }

  // Tab and Shift-Tab stay inside the panel while it is open.
  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const fill = strength ? strengthFill(strength.level) : null

  return (
    <div
      aria-labelledby={titleId}
      aria-modal={sheet ? true : undefined}
      className={sheet ? 'generator-popover is-sheet' : 'generator-popover'}
      onKeyDown={trapFocus}
      ref={panelRef}
      role="dialog"
      style={style}
    >
      <h2 className="sr-only" id={titleId}>
        {t('generator.title')}
      </h2>
      <div className="generator-popover-header">
        <button className="secondary-button generator-popover-action" onClick={onCancel} type="button">
          {t('generator.cancel')}
        </button>
        <button
          aria-label={t('generator.regenerate')}
          className="generator-popover-regenerate"
          onClick={() => setRound((value) => value + 1)}
          title={t('generator.regenerate')}
          type="button"
        >
          <RotateCw aria-hidden="true" size={18} />
        </button>
        <button
          className="primary-button generator-popover-action"
          disabled={!password}
          onClick={() => onUse(password)}
          ref={defaultButtonRef}
          type="button"
        >
          {t('generator.use')}
        </button>
      </div>
      <output
        aria-label={t('vault.generatedPassword')}
        aria-live="off"
        className="generator-popover-value"
        title={password}
      >
        {passwordRuns(password).map((run, index) => (
          <span className={`is-${run.kind}`} key={index}>
            {run.text}
          </span>
        ))}
      </output>
      <div className="generator-popover-strength">
        {strength && fill ? (
          <span
            aria-label={t(`vault.strength.${strength.level}`)}
            className={`generator-popover-strength-bar is-${strength.level} fill-${fill}`}
            role="img"
          />
        ) : null}
      </div>
      <div className="generator-popover-rows">
        <label className="generator-popover-row">
          <span className="generator-popover-label">{t('generator.type')}</span>
          <select
            className="generator-popover-select"
            onChange={(event) => change({ kind: 'type', mode: event.target.value as PasswordGeneratorMode })}
            value={options.mode}
          >
            {generatorTypes.map((mode) => (
              <option key={mode} value={mode}>
                {t(typeLabelKeys[mode])}
              </option>
            ))}
          </select>
        </label>
        <div className="generator-popover-row">
          <span className="generator-popover-label">{amountLabel}</span>
          <input
            aria-label={amountLabel}
            className="generator-popover-slider"
            max={limits.max}
            min={limits.min}
            onChange={(event) => change({ kind: 'amount', value: Number(event.target.value) })}
            step={limits.step}
            type="range"
            value={amount}
          />
          <input
            aria-label={amountLabel}
            className="generator-popover-number"
            inputMode="numeric"
            max={limits.max}
            min={limits.min}
            onBlur={commitDraft}
            onChange={(event) => {
              const typed = event.target.value
              const value = Number(typed)
              // A value inside the range applies as it is typed; "3" on the way to "32" waits for blur or Return.
              if (typed !== '' && Number.isInteger(value) && value >= limits.min && value <= limits.max) {
                change({ kind: 'amount', value })
                setAmountDraft(null)
              } else setAmountDraft(typed)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitDraft()
              }
            }}
            step={limits.step}
            type="number"
            value={amountDraft ?? String(amount)}
          />
        </div>
        {options.mode === 'random' ? (
          <>
            <label className="generator-popover-row is-switch">
              <span className="generator-popover-label">{t('generator.numbers')}</span>
              <input
                aria-checked={options.numbers}
                checked={options.numbers}
                onChange={(event) => change({ kind: 'toggle', option: 'numbers', value: event.target.checked })}
                role="switch"
                type="checkbox"
              />
            </label>
            <label className="generator-popover-row is-switch">
              <span className="generator-popover-label">{t('generator.symbols')}</span>
              <input
                aria-checked={options.symbols}
                checked={options.symbols}
                onChange={(event) => change({ kind: 'toggle', option: 'symbols', value: event.target.checked })}
                role="switch"
                type="checkbox"
              />
            </label>
          </>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The key button beside a password and the generator it opens: a 320pt popover anchored to the button
 * (flipping above near the window's foot, never leaving the window), a bottom sheet on phones. Focus goes back
 * to the button when the panel closes.
 */
export function PasswordGeneratorButton({
  className,
  generate,
  iconSize,
  label,
  measure,
  onUse,
}: {
  className: string
  generate: (options: PasswordGeneratorOptions) => Promise<string>
  iconSize: number
  label: string
  measure?: (value: string) => Promise<PasswordStrength | null>
  onUse: (password: string) => void
}) {
  const { layout } = usePlatformState()
  const sheet = layout === 'mobile'
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The caller's generate is a fresh closure each render; the panel must not regenerate because of that.
  const generateRef = useRef(generate)
  generateRef.current = generate
  const [stableGenerate] = useState(() => (options: PasswordGeneratorOptions) => generateRef.current(options))
  const measureRef = useRef(measure)
  measureRef.current = measure
  const [stableMeasure] = useState(() => (value: string) => measureRef.current?.(value) ?? Promise.resolve(null))

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])

  const { style } = useAnchoredPanel(open && !sheet, buttonRef, panelRef, { align: 'end', width: 320 })

  const panel = open ? (
    <div
      className="generator-popover-anchor"
      ref={panelRef}
      style={sheet ? undefined : { ...style, overflowY: 'auto' }}
    >
      <PasswordGeneratorPanel
        generate={stableGenerate}
        initialOptions={rememberedGeneratorOptions()}
        measure={measure ? stableMeasure : undefined}
        onCancel={close}
        onOptionsChange={rememberGeneratorOptions}
        onUse={(password) => {
          onUse(password)
          close()
        }}
        sheet={sheet}
      />
    </div>
  ) : null

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={className}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <KeyRound aria-hidden="true" size={iconSize} />
      </button>
      {panel
        ? createPortal(
            sheet ? (
              <div className="field-action-sheet-layer">
                <div aria-hidden="true" className="field-action-sheet-backdrop" />
                {panel}
              </div>
            ) : (
              panel
            ),
            document.body,
          )
        : null}
    </>
  )
}
