import { ChevronDown, Plus } from 'lucide-react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { type AddMoreContext, type AddMoreEntry, addMoreEntries } from './addMoreOptions'
import { useAnchoredPanel } from './anchoredPanel'

/** A macOS pop-up menu is as wide as its longest item, within these bounds (menus.md, judgment on the px). */
export const MENU_MIN_WIDTH = 220
export const MENU_MAX_WIDTH = 280

export type AddMoreControlProps = {
  attachments: boolean
  context: AddMoreContext
  /** Drop-zone attributes for the bar (an empty section has no row to drop onto). */
  dropZone?: { container: string; index: number }
  dropIndicator?: 'after' | 'before'
  onPick: (entry: AddMoreEntry) => void
  onToggle: () => void
  open: boolean
  /** Phones get an action sheet from the bottom edge instead of a popover. */
  sheet: boolean
}

/**
 * The item's and every section's "Add More": a full-width bar with a chevron that opens one menu of field types
 * (icons + labels) in a portal layer, so no scroll container or card can clip it. `data-field-menu` keeps the
 * window's outside-click handler (App.tsx) from closing it on its own clicks.
 */
export function AddMoreControl({
  attachments,
  context,
  dropIndicator,
  dropZone,
  onPick,
  onToggle,
  open,
  sheet,
}: AddMoreControlProps) {
  const { t } = useTranslation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { placement, style } = useAnchoredPanel(open && !sheet, triggerRef, menuRef)
  const entries = addMoreEntries(context, { attachments })
  const title = context === 'section' ? t('fieldRows.sectionAddMore') : t('vault.addMore')

  const rows = entries.map((entry) => (
    <button
      className={entry.separated ? 'menu-option with-icon separated' : 'menu-option with-icon'}
      data-add-more-entry={entry.id}
      key={entry.id}
      onClick={() => onPick(entry)}
      role="menuitem"
      type="button"
    >
      <entry.icon aria-hidden="true" size={15} />
      <span className="menu-option-label">
        <span>{t(entry.labelKey)}</span>
        {entry.descriptionKey ? <small>{t(entry.descriptionKey)}</small> : null}
      </span>
    </button>
  ))

  const menu = open
    ? createPortal(
        sheet ? (
          <div className="field-action-sheet-layer">
            <div aria-hidden="true" className="field-action-sheet-backdrop" />
            <div className="field-action-sheet" data-field-menu="" role="menu">
              <div className="field-action-sheet-group">
                <p className="field-action-sheet-title">{title}</p>
                {rows}
              </div>
              <button className="field-action-sheet-cancel" onClick={onToggle} type="button">
                {t('fieldActions.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div
            aria-label={title}
            className="add-more-menu is-floating"
            data-add-more-context={context}
            data-field-menu=""
            ref={menuRef}
            role="menu"
            style={{ ...style, maxWidth: MENU_MAX_WIDTH, minWidth: MENU_MIN_WIDTH }}
          >
            {rows}
          </div>
        ),
        document.body,
      )
    : null

  return (
    <div
      className={['add-more-wrap', dropIndicator ? `is-drop-${dropIndicator}` : ''].filter(Boolean).join(' ')}
      data-field-menu=""
      data-reorder-container={dropZone?.container}
      data-reorder-index={dropZone?.index}
      data-reorder-zone={dropZone ? '' : undefined}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={placement?.placement === 'above' ? 'add-more-button placement-top' : 'add-more-button'}
        onClick={onToggle}
        ref={triggerRef}
        type="button"
      >
        <Plus aria-hidden="true" size={16} />
        {title}
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {menu}
    </div>
  )
}
