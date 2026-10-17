import { CircleMinus, Menu, SlidersHorizontal } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { usePlatformState } from '../skin/runtime'
import { type UrlMatchType, vaultApi, type WebsiteScope } from './vaultApi'

/**
 * The editor's half of the one field row (1Password 8, owner screenshots 2026-10-17): every editable field is
 * a `.field-slot` — a drag handle in a gutter *outside* the card, then a `.field-row` cell inside it with the
 * label above the value and the trailing buttons (type buttons, then the red remove). The read-only view draws
 * the same `.field-row` cell (`FieldView`), so both modes share padding, type, separators and the action area;
 * editing adds the gutter, the whole-cell focus ring and the remove button. Nothing in the form draws a field
 * any other way — `designContract.test.ts` checks it.
 */

export type DropPosition = 'after' | 'before'
export type DropIndicator = { container: string; index: number; position: DropPosition }

export type DragSource = {
  container: string
  index: number
  /** Which containers this entry may be dropped into. */
  accepts: (container: string) => boolean
}

export type ReorderControl = {
  container: string
  index: number
  /** Alt+↑ / Alt+↓ on the handle. */
  onKeyboardMove: (delta: -1 | 1) => void
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

/** A handle the keyboard can use too: Alt+↑ / Alt+↓ move the row; the label says so. */
export function ReorderHandle({ control, label }: { control: ReorderControl; label: string }) {
  const { t } = useTranslation()
  const hintId = useId()
  return (
    <>
      <button
        aria-describedby={hintId}
        aria-label={t('fieldRows.reorder', { label })}
        className="field-reorder-handle"
        onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
          event.preventDefault()
          control.onKeyboardMove(event.key === 'ArrowUp' ? -1 : 1)
        }}
        onPointerDown={control.onPointerDown}
        title={t('fieldRows.reorderHint')}
        type="button"
      >
        <Menu aria-hidden="true" size={18} />
      </button>
      <span className="sr-only" id={hintId}>
        {t('fieldRows.reorderHint')}
      </span>
    </>
  )
}

export type EditFieldRowProps = {
  children?: ReactNode
  className?: string
  /** A drop indicator on this row while something is dragged over it. */
  drop?: DropPosition
  /** Shown above the value, as text; a renamable field passes `labelInput` too. */
  label: string
  /** The section header carries its name as the value, so its label is the accessible name only. */
  labelHidden?: boolean
  labelInput?: { onChange: (value: string) => void; placeholder: string; value: string }
  onRemove?: () => void
  removeLabel?: string
  reorder?: ReorderControl
  /** Buttons that belong to the type (generator, autofill behaviour, QR scan), before the remove button. */
  trailing?: ReactNode
}

export function EditFieldRow({
  children,
  className,
  drop,
  label,
  labelHidden = false,
  labelInput,
  onRemove,
  removeLabel,
  reorder,
  trailing,
}: EditFieldRowProps) {
  const { t } = useTranslation()
  return (
    <div
      className={['field-slot', drop ? `is-drop-${drop}` : ''].filter(Boolean).join(' ')}
      data-reorder-container={reorder?.container}
      data-reorder-index={reorder?.index}
    >
      <span className="field-slot-handle">{reorder ? <ReorderHandle control={reorder} label={label} /> : null}</span>
      <div className={['field-row', 'is-edit', className].filter(Boolean).join(' ')}>
        <div className="field-row-main">
          {labelInput ? (
            <input
              aria-label={t('vault.fieldLabel')}
              className="field-row-label-input"
              onChange={(event) => labelInput.onChange(event.target.value)}
              placeholder={labelInput.placeholder}
              spellCheck={false}
              value={labelInput.value}
            />
          ) : labelHidden ? null : (
            <span className="field-row-label">{label}</span>
          )}
          {children}
        </div>
        {trailing || onRemove ? (
          <div className="field-row-actions">
            {trailing}
            {onRemove ? (
              <button
                aria-label={removeLabel ?? t('vault.removeField')}
                className="field-remove-button"
                onClick={onRemove}
                title={removeLabel ?? t('vault.removeField')}
                type="button"
              >
                <CircleMinus aria-hidden="true" size={18} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The blue "+ add more" / "add another website" line that closes a card, in the card's own cell. */
export function AddRowButton({
  children,
  onClick,
  expanded,
  zone,
}: {
  children: ReactNode
  expanded?: boolean
  onClick: (trigger: HTMLButtonElement) => void
  /** Makes the line a drop target that appends to this container (an empty section has no row to hit). */
  zone?: { container: string; index: number }
}) {
  return (
    <div
      className="field-slot"
      data-reorder-container={zone?.container}
      data-reorder-index={zone?.index}
      data-reorder-zone={zone ? '' : undefined}
    >
      <span className="field-slot-handle" />
      <div className="field-row is-edit is-add">
        <button
          aria-expanded={expanded}
          className="field-add-button"
          data-field-menu=""
          onClick={(event) => onClick(event.currentTarget)}
          type="button"
        >
          {children}
        </button>
      </div>
    </div>
  )
}

/**
 * Pointer drag for the handles. Rows announce themselves with `data-reorder-container` / `-index`; the
 * innermost row under the pointer that the source accepts is the target, its upper or lower half says
 * before or after, and a `data-reorder-zone` line appends. `onDrop` receives the destination as the index the
 * entry ends at once it has left its old place (fieldReorder.ts's convention).
 */
export function useFieldDrag(onDrop: (from: DragSource, to: { container: string; index: number }) => void) {
  const [indicator, setIndicator] = useState<DropIndicator | null>(null)
  const [dragging, setDragging] = useState<{ container: string; index: number } | null>(null)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  function hit(source: DragSource, x: number, y: number): DropIndicator | null {
    let best: { area: number; indicator: DropIndicator } | null = null
    for (const element of document.querySelectorAll<HTMLElement>('[data-reorder-container]')) {
      const container = element.dataset.reorderContainer ?? ''
      if (!container || !source.accepts(container)) continue
      const rect = element.getBoundingClientRect()
      if (y < rect.top || y > rect.bottom || x < rect.left - 48 || x > rect.right) continue
      const area = rect.width * rect.height
      if (best && best.area <= area) continue
      const index = Number(element.dataset.reorderIndex)
      const position: DropPosition =
        element.dataset.reorderZone !== undefined || y < rect.top + rect.height / 2 ? 'before' : 'after'
      best = { area, indicator: { container, index, position } }
    }
    return best?.indicator ?? null
  }

  function begin(event: ReactPointerEvent<HTMLButtonElement>, source: DragSource) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    handle.focus()
    setDragging({ container: source.container, index: source.index })
    let current: DropIndicator | null = null
    const scroller = handle.closest<HTMLElement>('.detail-fieldset')
    const move = (next: PointerEvent) => {
      current = hit(source, next.clientX, next.clientY)
      setIndicator(current)
      if (scroller) {
        const bounds = scroller.getBoundingClientRect()
        if (next.clientY < bounds.top + 40) scroller.scrollBy(0, -12)
        else if (next.clientY > bounds.bottom - 40) scroller.scrollBy(0, 12)
      }
    }
    const end = (finish: PointerEvent) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setIndicator(null)
      setDragging(null)
      if (finish.type !== 'pointerup' || !current) return
      let index = current.position === 'before' ? current.index : current.index + 1
      if (current.container === source.container && index > source.index) index -= 1
      if (current.container === source.container && index === source.index) return
      onDropRef.current(source, { container: current.container, index })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const dropAt = (container: string, index: number): DropPosition | undefined =>
    indicator && indicator.container === container && indicator.index === index ? indicator.position : undefined

  return { begin, dragging, dropAt }
}

const autofillModes: readonly UrlMatchType[] = ['domain', 'exact', 'never']

function modeLabel(t: (key: string) => string, mode: UrlMatchType) {
  if (mode === 'exact') return t('fieldRows.autofillExact')
  if (mode === 'never') return t('fieldRows.autofillNever')
  return t('fieldRows.autofillDomain')
}

/** Puts `{{domain}}` / `{{host}}` in bold without handing markup to the translation. */
function withStrong(text: string, value: string): ReactNode {
  const marker = '\u0000'
  const [before, after] = text.replace(value, marker).split(marker)
  if (after === undefined) return text
  return (
    <>
      {before}
      <strong>{value}</strong>
      {after}
    </>
  )
}

export function useWebsiteScope(url: string): WebsiteScope | null {
  const [scope, setScope] = useState<WebsiteScope | null>(null)
  useEffect(() => {
    let stale = false
    const trimmed = url.trim()
    if (!trimmed) {
      setScope(null)
      return
    }
    vaultApi
      .describeWebsite(trimmed)
      .catch(() => fallbackScope(trimmed))
      .then((next) => {
        if (!stale) setScope(next ?? null)
      })
    return () => {
      stale = true
    }
  }, [url])
  return scope
}

/** Outside Tauri (a browser preview) there is no Rust to ask: the host alone, said without a wider claim. */
function fallbackScope(url: string): WebsiteScope | null {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    return { domain: parsed.hostname, host: parsed.host, related: false, subdomains: true }
  } catch {
    return null
  }
}

export function autofillSentence(
  t: (key: string, options?: Record<string, unknown>) => string,
  mode: UrlMatchType,
  scope: WebsiteScope | null,
): ReactNode {
  if (mode === 'never') return t('fieldRows.fillsNever')
  if (!scope) return t('fieldRows.noAddress')
  if (mode === 'exact' || !scope.subdomains) {
    return withStrong(t('fieldRows.fillsHost', { host: scope.host }), scope.host)
  }
  const key = scope.related ? 'fieldRows.fillsRelated' : 'fieldRows.fillsSubdomains'
  return withStrong(t(key, { domain: scope.domain }), scope.domain)
}

/**
 * The sliders button beside a website and its Autofill Behavior popover (a sheet on phones): three radios,
 * Default on the first, and a tinted box saying where the item will fill under the chosen behaviour.
 */
export function AutofillBehaviorButton({
  label,
  mode,
  onChange,
  url,
}: {
  label: string
  mode: UrlMatchType
  onChange: (mode: UrlMatchType) => void
  url: string
}) {
  const { t } = useTranslation()
  const { layout } = usePlatformState()
  const sheet = layout === 'mobile'
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const name = useId()
  const scope = useWebsiteScope(anchor ? url : '')

  useEffect(() => {
    if (!anchor) return
    panelRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
    const close = (restore: boolean) => {
      setAnchor(null)
      if (restore) buttonRef.current?.focus()
    }
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [anchor])

  const panelWidth = 380
  const panel = anchor ? (
    <div
      aria-labelledby={titleId}
      className={sheet ? 'autofill-panel is-sheet' : 'autofill-panel'}
      ref={panelRef}
      role="dialog"
      style={
        sheet
          ? undefined
          : {
              left: Math.max(8, Math.min(anchor.right - panelWidth + 24, window.innerWidth - panelWidth - 8)),
              position: 'fixed',
              top: anchor.bottom + 6,
              width: panelWidth,
            }
      }
    >
      <p className="autofill-panel-title" id={titleId}>
        {t('fieldRows.autofillTitle')}
      </p>
      <div aria-labelledby={titleId} className="autofill-options" role="radiogroup">
        {autofillModes.map((option) => (
          <label className="autofill-option" key={option}>
            <input
              checked={mode === option}
              name={name}
              onChange={() => onChange(option)}
              type="radio"
              value={option}
            />
            <span className="autofill-option-label">{modeLabel(t, option)}</span>
            {option === 'domain' ? (
              <span className="autofill-default-badge">{t('fieldRows.autofillDefault')}</span>
            ) : null}
          </label>
        ))}
      </div>
      <p aria-live="polite" className="autofill-scope">
        {autofillSentence(t, mode, scope)}
      </p>
    </div>
  ) : null

  return (
    <>
      <button
        aria-expanded={anchor !== null}
        aria-haspopup="dialog"
        aria-label={t('fieldRows.autofillButton', { label })}
        className={mode === 'domain' ? 'field-type-button' : 'field-type-button is-customized'}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())}
        ref={buttonRef}
        title={t('fieldRows.autofillTitle')}
        type="button"
      >
        <SlidersHorizontal aria-hidden="true" size={18} />
      </button>
      {panel
        ? createPortal(
            sheet ? (
              <div className="autofill-sheet-layer">
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

/** The view row's note when a website's behaviour is not the default (1Password shows one too). */
export function autofillViewNote(
  t: (key: string, options?: Record<string, unknown>) => string,
  mode: UrlMatchType,
  url: string,
): string | null {
  if (mode === 'never') return t('fieldRows.viewNever')
  if (mode !== 'exact') return null
  try {
    return t('fieldRows.viewExact', { host: new URL(url.includes('://') ? url : `https://${url}`).host })
  } catch {
    return null
  }
}
