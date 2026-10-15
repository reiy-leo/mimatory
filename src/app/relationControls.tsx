import { ChevronRight, CircleMinus, type LucideIcon } from 'lucide-react'
import type { RelatedItemRef } from './vaultApi'

export type RelationIcon = { colorClass: string; icon: LucideIcon }

type RelationSectionProps = {
  archivedLabel: string
  heading: string
  iconFor: (itemType: string) => RelationIcon
  // Read-only: a live row navigates to its item. An archived one has no detail pane to open (the pane
  // only ever shows live items), so it stays a plain row that says it is archived.
  onOpen?: (ref: RelatedItemRef) => void
  // Editing: every row carries the same remove control a user-added field does.
  onRemove?: (ref: RelatedItemRef) => void
  openLabel?: (title: string) => string
  refs: RelatedItemRef[]
  removeLabel?: (title: string) => string
  typeLabel: (itemType: string) => string
}

// One kind of link (Parent Item, Child Items, Related Items) as an inset group of rows: glyph, title,
// and the type as a caption. Hidden entirely when there is nothing to list.
export function RelationSection({
  archivedLabel,
  heading,
  iconFor,
  onOpen,
  onRemove,
  openLabel,
  refs,
  removeLabel,
  typeLabel,
}: RelationSectionProps) {
  if (!refs.length) return null
  return (
    <section aria-label={heading} className="field-section">
      <h3 className="field-group-title">{heading}</h3>
      <div className="field-group">
        {refs.map((ref) => {
          const { colorClass, icon: Icon } = iconFor(ref.item_type)
          const caption = ref.archived ? `${typeLabel(ref.item_type)} · ${archivedLabel}` : typeLabel(ref.item_type)
          const body = (
            <>
              <Icon aria-hidden="true" className={`relation-row-icon ${colorClass}`} size={16} />
              <span className="relation-row-text">
                <span className="relation-row-title">{ref.title}</span>
                <span className="relation-row-caption">{caption}</span>
              </span>
            </>
          )
          if (onRemove) {
            return (
              <div className="field-row relation-row" key={ref.id}>
                {body}
                <button
                  aria-label={removeLabel?.(ref.title)}
                  className="round-remove-button"
                  onClick={() => onRemove(ref)}
                  title={removeLabel?.(ref.title)}
                  type="button"
                >
                  <CircleMinus size={16} />
                </button>
              </div>
            )
          }
          if (onOpen && !ref.archived) {
            return (
              <button
                aria-label={openLabel?.(ref.title)}
                className="field-row relation-row is-link"
                key={ref.id}
                onClick={() => onOpen(ref)}
                type="button"
              >
                {body}
                <ChevronRight aria-hidden="true" className="relation-row-chevron" size={16} />
              </button>
            )
          }
          return (
            <div className="field-row relation-row" key={ref.id}>
              {body}
            </div>
          )
        })}
      </div>
    </section>
  )
}
