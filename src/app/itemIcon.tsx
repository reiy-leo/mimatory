import type { ReactNode } from 'react'
import { type IconSource, itemIconDomain, useSiteIcon, useSiteIconsEnabled } from './siteIcons'

type ItemIconProps = {
  // `item-icon` (list rows, search results, Quick Access), `large-icon` (the detail header) or
  // `picker-icon` (picker rows).
  className?: string
  // Drawn instead of the letter when there is no website icon (a picker row keeps its type glyph).
  fallback?: ReactNode
  item: IconSource & { title: string }
  // The letter for an untitled item: `+` while composing a new one.
  placeholder?: string
}

// An item's tile: the website's icon when the item has a site, the setting is on and an icon was
// found; otherwise the first letter of the title, exactly as before. Decorative either way — the
// title is always written next to it — so the image carries an empty alt.
export function ItemIcon({ className = 'item-icon', fallback, item, placeholder = 'L' }: ItemIconProps) {
  const enabled = useSiteIconsEnabled()
  const src = useSiteIcon(enabled ? itemIconDomain(item) : null)
  if (src) {
    return (
      <span className={`${className} has-site-icon`}>
        <img alt="" draggable={false} src={src} />
      </span>
    )
  }
  if (fallback) return <>{fallback}</>
  return <span className={className}>{item.title.slice(0, 1).toUpperCase() || placeholder}</span>
}
