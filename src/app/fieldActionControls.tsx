import {
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link,
  LogIn,
  Mail,
  Maximize2,
  Phone,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { usePlatformState } from '../skin/runtime'
import type { FieldActionId } from './fieldActions'
import { largeTypeCells } from './largeType'
import { getMenuAnchorStyle } from './menuPlacement'

/**
 * The pieces every read-only field shares with the one-time password card: the field's action menu (a popover
 * under the chevron on desktop, an action sheet from a long press on phones) and Show in Large Type.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Written out in full so the i18n guard can see every key (a runtime-built key would hide from it). */
export function fieldActionLabel(t: Translate, id: FieldActionId): string {
  switch (id) {
    case 'call':
      return t('fieldActions.call')
    case 'conceal':
      return t('fieldActions.conceal')
    case 'copy':
      return t('fieldActions.copy')
    case 'copySecret':
      return t('fieldActions.copySecret')
    case 'copySetupLink':
      return t('fieldActions.copySetupLink')
    case 'largeType':
      return t('fieldActions.largeType')
    case 'open':
      return t('fieldActions.open')
    case 'openAndFill':
      return t('fieldActions.openAndFill')
    case 'reveal':
      return t('fieldActions.reveal')
    case 'sendEmail':
      return t('fieldActions.sendEmail')
  }
}

const actionIcons: Record<FieldActionId, ReactNode> = {
  call: <Phone size={16} />,
  conceal: <EyeOff size={16} />,
  copy: <Copy size={16} />,
  copySecret: <KeyRound size={16} />,
  copySetupLink: <Link size={16} />,
  largeType: <Maximize2 size={16} />,
  open: <ExternalLink size={16} />,
  openAndFill: <LogIn size={16} />,
  reveal: <Eye size={16} />,
  sendEmail: <Mail size={16} />,
}

/** The menu's width; matches the item menu's measure so the two read as one family. */
const fieldMenuWidth = 220
const fieldMenuRowHeight = 30

export type FieldMenuAnchor = { bottom: number; left: number; right: number; top: number }

export function anchorOf(element: Element): FieldMenuAnchor {
  const rect = element.getBoundingClientRect()
  return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }
}

/**
 * One field's actions. On desktop a popover anchored right-aligned under its trigger (or at the pointer for a
 * right-click); in the phone layout an action sheet from the bottom edge with the field's name and a Cancel row,
 * the way a long press on a field behaves in 1Password for iOS and Android.
 */
export function FieldActionMenu({
  actions,
  anchor,
  label,
  onClose,
  onSelect,
}: {
  actions: FieldActionId[]
  anchor: FieldMenuAnchor
  label: string
  onClose: (restoreFocus: boolean) => void
  onSelect: (id: FieldActionId) => void
}) {
  const { t } = useTranslation()
  const { layout } = usePlatformState()
  const sheet = layout === 'mobile'
  const menuRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const handlePointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onCloseRef.current(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current(true)
    }
    const handleScroll = (event: Event) => {
      if (!sheet && !menuRef.current?.contains(event.target as Node)) onCloseRef.current(false)
    }
    // Capture, so a pointer that lands on another field's trigger closes this menu before that one opens.
    window.addEventListener('pointerdown', handlePointer, true)
    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('pointerdown', handlePointer, true)
      window.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [sheet])

  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Tab') {
      event.preventDefault()
      onClose(true)
      return
    }
    if (next === null) return
    event.preventDefault()
    items[next]?.focus()
  }

  const rows = actions.map((id) => (
    <button
      className="menu-option with-icon"
      key={id}
      onClick={() => {
        onClose(true)
        onSelect(id)
      }}
      role="menuitem"
      type="button"
    >
      {actionIcons[id]}
      <span>{fieldActionLabel(t, id)}</span>
    </button>
  ))

  if (sheet) {
    return createPortal(
      <div className="field-action-sheet-layer">
        <div aria-hidden="true" className="field-action-sheet-backdrop" />
        <div aria-labelledby={titleId} className="field-action-sheet" onKeyDown={moveFocus} ref={menuRef} role="menu">
          <div className="field-action-sheet-group">
            <p className="field-action-sheet-title" id={titleId}>
              {label}
            </p>
            {rows}
          </div>
          <button className="field-action-sheet-cancel" onClick={() => onClose(true)} role="menuitem" type="button">
            {t('fieldActions.cancel')}
          </button>
        </div>
      </div>,
      document.body,
    )
  }

  const { style } = getMenuAnchorStyle({
    menuHeight: actions.length * fieldMenuRowHeight + 16,
    rect: {
      bottom: anchor.bottom,
      left: Math.max(8, Math.min(anchor.right - fieldMenuWidth, window.innerWidth - fieldMenuWidth - 8)),
      top: anchor.top,
      width: fieldMenuWidth,
    },
    viewportHeight: window.innerHeight,
  })
  return createPortal(
    <div
      aria-label={t('fieldActions.menuFor', { label })}
      className="add-more-menu field-action-menu"
      onKeyDown={moveFocus}
      ref={menuRef}
      role="menu"
      style={style}
    >
      {rows}
    </div>,
    document.body,
  )
}

/** The trailing chevron that opens a field's menu. */
export function FieldMenuButton({
  expanded,
  label,
  onOpen,
}: {
  expanded: boolean
  label: string
  onOpen: (anchor: FieldMenuAnchor) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      aria-expanded={expanded}
      aria-haspopup="menu"
      aria-label={t('fieldActions.menuFor', { label })}
      className="icon-button field-menu-button"
      onClick={(event) => onOpen(anchorOf(event.currentTarget))}
      title={t('fieldActions.more')}
      type="button"
    >
      <ChevronDown size={15} />
    </button>
  )
}

const longPressMs = 500
const longPressSlop = 10

/**
 * Touch and hold opens the menu (phones have no hover and no right-click). The click that follows the release
 * is swallowed, so a long press never also copies.
 */
export function useLongPress(onLongPress: (anchor: FieldMenuAnchor) => void) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])

  return {
    consumeClick: () => {
      const wasLongPress = fired.current
      fired.current = false
      return wasLongPress
    },
    handlers: {
      onPointerCancel: cancel,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        fired.current = false
        if (event.pointerType === 'mouse') return
        origin.current = { x: event.clientX, y: event.clientY }
        const target = event.currentTarget
        cancel()
        timer.current = window.setTimeout(() => {
          fired.current = true
          timer.current = null
          onLongPress(anchorOf(target))
        }, longPressMs)
      },
      onPointerLeave: cancel,
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const start = origin.current
        if (!start || timer.current === null) return
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > longPressSlop) cancel()
      },
      onPointerUp: cancel,
    },
  }
}

/**
 * Show in Large Type: each character on its own tile with its position under it, digits and symbols in their
 * own colours (and named per tile for VoiceOver), over a dimmed window. Escape, the close button or a click
 * outside dismisses it; focus returns to whatever opened it.
 */
export function LargeTypeOverlay({ label, onClose, value }: { label: string; onClose: () => void; value: string }) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const cells = largeTypeCells(value)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      } else if (event.key === 'Tab') {
        // The close button is the only stop; focus never leaves the overlay while it is up.
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      opener?.focus?.()
    }
  }, [])

  const spoken = (cell: (typeof cells)[number]) => {
    if (cell.kind === 'space') return t('fieldActions.largeTypeSpace')
    if (cell.kind === 'digit') return t('fieldActions.largeTypeDigit', { character: cell.value })
    if (cell.kind === 'symbol') return t('fieldActions.largeTypeSymbol', { character: cell.value })
    return cell.value === cell.value.toUpperCase() && cell.value !== cell.value.toLowerCase()
      ? t('fieldActions.largeTypeUpper', { character: cell.value })
      : cell.value
  }

  return createPortal(
    <div className="large-type-layer">
      <button
        aria-label={t('fieldActions.closeLargeType')}
        className="confirm-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div aria-labelledby={titleId} aria-modal="true" className="large-type-card" role="dialog">
        <div className="large-type-header">
          <h2 id={titleId}>{label}</h2>
          <button
            aria-label={t('fieldActions.closeLargeType')}
            className="icon-button"
            onClick={onClose}
            ref={closeRef}
            title={t('fieldActions.closeLargeType')}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <ol className="large-type-grid">
          {cells.map((cell) => (
            <li
              aria-label={t('fieldActions.largeTypeCell', { character: spoken(cell), index: cell.index })}
              className={`large-type-cell is-${cell.kind}`}
              key={cell.index}
            >
              <span aria-hidden="true" className="large-type-glyph">
                {cell.glyph}
              </span>
              <span aria-hidden="true" className="large-type-index">
                {cell.index}
              </span>
            </li>
          ))}
        </ol>
        <p className="large-type-legend">
          <span className="is-digit">{t('fieldActions.legendDigits')}</span>
          <span className="is-symbol">{t('fieldActions.legendSymbols')}</span>
        </p>
      </div>
    </div>,
    document.body,
  )
}
