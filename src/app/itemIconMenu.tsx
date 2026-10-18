import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPanel } from './anchoredPanel'

export type ItemIconChoice = {
  icon: LucideIcon
  id: string
  label: string
  onSelect: () => void
}

/**
 * The small chevron badge on the edit header's icon (1Password 8, owner 2026-10-18) and the menu it opens: the
 * icon choices the app supports for this item. Renders nothing when there is no choice to offer. It owns its
 * Escape / outside-click listeners and returns focus to the badge, like the generator popover.
 */
export function ItemIconMenuButton({ choices, label }: { choices: ItemIconChoice[]; label: string }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { style } = useAnchoredPanel(open, buttonRef, menuRef, { align: 'start' })

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const rows = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      const index = rows.indexOf(document.activeElement as HTMLButtonElement)
      if (index < 0 || rows.length === 0) return
      event.preventDefault()
      rows[(index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus()
    }
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])

  if (choices.length === 0) return null

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="item-icon-badge"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={12} strokeWidth={2.5} />
      </button>
      {open
        ? createPortal(
            <div
              aria-label={label}
              className="add-more-menu is-floating"
              data-field-menu=""
              ref={menuRef}
              role="menu"
              style={{ ...style, maxWidth: 280, minWidth: 220 }}
            >
              {choices.map((choice) => (
                <button
                  className="menu-option with-icon"
                  key={choice.id}
                  onClick={() => {
                    setOpen(false)
                    buttonRef.current?.focus()
                    choice.onSelect()
                  }}
                  role="menuitem"
                  type="button"
                >
                  <choice.icon aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{choice.label}</span>
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
