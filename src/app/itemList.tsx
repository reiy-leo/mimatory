import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, Check, ChevronDown, Star, Trash2 } from 'lucide-react'
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { ItemIcon } from './itemIcon'
import { defaultDirectionFor, type ItemSort, type ItemSortKey, itemSortKeys } from './itemSort'
import type { VaultWindowModel } from './useVaultWindow'
import type { LoginItemSummary } from './vaultApi'

// One table for every item type the vault can hold: it is the sidebar's category list *and* the
// new-item picker's list, in the same order, so a type can never be creatable but nowhere to be
// found. Each row carries the accent hue its icon wears; the ramp is decoration only and never
// stands in for a status. `i18n.test.ts` reads this shape to prove every `itemTypes.*` key exists.
export const sortKeyLabel: Record<ItemSortKey, string> = {
  created: 'vault.sortCreated',
  frequent: 'vault.sortFrequent',
  modified: 'vault.sortModified',
  recent: 'vault.sortRecent',
  title: 'vault.sortTitle',
}

/** The second group of the sort menu, worded for what is being sorted: A to Z, newest first, most first. */
export function sortDirections(key: ItemSortKey): Array<[ItemSort['direction'], string]> {
  if (key === 'title')
    return [
      ['asc', 'vault.sortAscTitle'],
      ['desc', 'vault.sortDescTitle'],
    ]
  if (key === 'frequent')
    return [
      ['desc', 'vault.sortDescUse'],
      ['asc', 'vault.sortAscUse'],
    ]
  return [
    ['desc', 'vault.sortDescDate'],
    ['asc', 'vault.sortAscDate'],
  ]
}

export type ItemListRowProps = {
  active: boolean
  index: number
  item: LoginItemSummary
  measureRef: (node: HTMLElement | null) => void
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, item: LoginItemSummary) => void
  onSelect: (id: string, event: ReactMouseEvent<HTMLButtonElement>) => void
  subtitle: string
}

// One list row, memoised: the list can hold thousands of items, and without this every selection,
// keystroke or toast in the window re-rendered all of them. With stable handlers only the rows whose
// item, subtitle or selection changed render again.
export const ItemListRow = memo(function ItemListRow({
  active,
  index,
  item,
  measureRef,
  onContextMenu,
  onSelect,
  subtitle,
}: ItemListRowProps) {
  return (
    <button
      className={active ? 'item-row active' : 'item-row'}
      data-index={index}
      data-item-row={item.id}
      onClick={(event) => onSelect(item.id, event)}
      onContextMenu={(event) => onContextMenu(event, item)}
      ref={measureRef}
      type="button"
    >
      <ItemIcon item={item} />
      <span className="item-row-text">
        <strong>{item.title}</strong>
        <small>
          <span className="row-subtitle">{subtitle}</span>
        </small>
      </span>
      {item.favorite ? <Star className="row-star" fill="currentColor" size={14} /> : null}
    </button>
  )
})

/** The item list column (sort menu, live rows or the archive / trash rows) and its resize gutter. */
export function ItemList({ vw }: { vw: VaultWindowModel }) {
  const {
    beginItemListResize,
    chooseSort,
    error,
    handleItemRowContextMenu,
    handleItemRowSelect,
    itemSort,
    itemSubtitle,
    listTitle,
    listScrollToItemRef,
    lockedRegion,
    requestEmptyTrash,
    selection,
    setSortMenuOpen,
    sortMenuOpen,
    stateRows,
    stateView,
    t,
    visibleItems,
  } = vw

  // Only the rows near the viewport are in the DOM (2026-10-23), so a vault of thousands lays out a screenful. The rows stay in
  // the normal flow of `.rows` — its grid gap and every skin's row rules apply unchanged — and the rows above
  // and below the window are stood in for by the container's own padding, which a grid does not add a gap to.
  const listRef = useRef<HTMLElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const rows: LoginItemSummary[] = stateRows ?? visibleItems
  const [rowsLayout, setRowsLayout] = useState({ gap: 0, offset: 0 })
  // The gap comes from the skin's CSS and the offset from whatever sits above the rows (title, error, sort
  // trigger), so both are read off the DOM after each commit and only stored when they moved.
  useLayoutEffect(() => {
    const list = listRef.current
    const rowsElement = rowsRef.current
    if (!list || !rowsElement) return
    const gap = Number.parseFloat(getComputedStyle(rowsElement).rowGap) || 0
    const offset = rowsElement.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    setRowsLayout((current) =>
      current.gap === gap && Math.abs(current.offset - offset) < 0.5 ? current : { gap, offset },
    )
  })
  // Every row has the same shape, so the last measured height is the estimate for the rows not yet rendered:
  // the scroll height (and the scrollbar) then match the full list instead of a guess.
  const measuredRowHeight = useRef(52)
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => measuredRowHeight.current,
    gap: rowsLayout.gap,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
    getScrollElement: () => listRef.current,
    // Rows are fractional pixels tall (rem type on a 14px or 17px root); the default measurement rounds, and the
    // rounding adds up into a visible drift a few rows down. The exact border box keeps every row where it was.
    measureElement: (element) => {
      const height = element.getBoundingClientRect().height
      if (height > 0) measuredRowHeight.current = height
      return height
    },
    overscan: 8,
    scrollMargin: rowsLayout.offset,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const firstRow = virtualRows[0]
  const lastRow = virtualRows[virtualRows.length - 1]
  const paddingTop = firstRow ? firstRow.start - rowsLayout.offset : 0
  const paddingBottom = lastRow ? Math.max(0, virtualizer.getTotalSize() - (lastRow.end - rowsLayout.offset)) : 0

  // ⌘↑ / ⌘↓ and the toolbar's arrows select a row that may not be rendered yet; they scroll through here.
  useEffect(() => {
    listScrollToItemRef.current = (id: string) => {
      const index = rows.findIndex((item) => item.id === id)
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
    }
  })
  useEffect(
    () => () => {
      listScrollToItemRef.current = null
    },
    [listScrollToItemRef],
  )

  return (
    <>
      <section {...lockedRegion} aria-label={t('landmarks.vaultItems')} className="item-list" ref={listRef}>
        {/* The phone layout's large title (iOS) / top app bar title (Material); the desktop shows none. */}
        <h2 className="mobile-list-title">{listTitle}</h2>
        {/* No standing "database ready" line (owner 2026-10-18); the slot only speaks up for an error. */}
        {error ? (
          <div className="sync-state">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Sort (owner 2026-10-18, after 1Password 8's "N items sorted by" menu): what to sort by, then which way.
            One choice for every list, remembered across launches. */}
        {/* The trash's own command, where Finder keeps it: at the top of the list, beside nothing else. */}
        {stateView === 'trash' && stateRows?.length ? (
          <div className="list-sort">
            <button className="list-sort-trigger" onClick={requestEmptyTrash} type="button">
              <Trash2 aria-hidden="true" size={13} />
              <span>{t('selection.emptyTrash')}</span>
            </button>
          </div>
        ) : null}
        {stateRows ? null : (
          <div className="list-sort" data-sort-menu="">
            <button
              aria-expanded={sortMenuOpen}
              aria-haspopup="menu"
              className="list-sort-trigger"
              onClick={() => setSortMenuOpen((open) => !open)}
              type="button"
            >
              <span>{t(sortKeyLabel[itemSort.key])}</span>
              <ChevronDown aria-hidden="true" size={13} />
            </button>
            {sortMenuOpen ? (
              <div className="add-more-menu list-sort-menu" role="menu">
                <p className="list-sort-heading">{t('vault.sortHeading', { count: visibleItems.length })}</p>
                {itemSortKeys.map((key) => (
                  <button
                    aria-checked={itemSort.key === key}
                    className="menu-option list-sort-option"
                    key={key}
                    onClick={() => chooseSort({ direction: defaultDirectionFor(key), key })}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{t(sortKeyLabel[key])}</span>
                    {itemSort.key === key ? <Check aria-hidden="true" size={15} /> : null}
                  </button>
                ))}
                {sortDirections(itemSort.key).map(([direction, label], index) => (
                  <button
                    aria-checked={itemSort.direction === direction}
                    className={index === 0 ? 'menu-option list-sort-option separated' : 'menu-option list-sort-option'}
                    key={direction}
                    onClick={() => chooseSort({ ...itemSort, direction })}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{t(label)}</span>
                    {itemSort.direction === direction ? <Check aria-hidden="true" size={15} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <div className="rows" ref={rowsRef} style={{ paddingBottom, paddingTop }}>
          {virtualRows.map((virtualRow) => {
            const item = rows[virtualRow.index]
            if (!item) return null
            // Trash and archive rows are selectable too (2026-10-25): their way back and their way out moved to the
            // detail pane and the right-click menu, which act on the whole selection.
            return (
              <ItemListRow
                active={selection.ids.has(item.id)}
                index={virtualRow.index}
                item={item}
                key={item.id}
                measureRef={virtualizer.measureElement}
                onContextMenu={handleItemRowContextMenu}
                onSelect={handleItemRowSelect}
                subtitle={itemSubtitle(item)}
              />
            )
          })}
          {(stateRows ? stateRows.length === 0 : visibleItems.length === 0) ? (
            <p className="empty-state">{t('vault.noItems', { target: listTitle })}</p>
          ) : null}
        </div>
      </section>

      <button
        aria-label={t('vault.resizeColumns')}
        className="column-resize-handle"
        onMouseDown={beginItemListResize}
        type="button"
      />
    </>
  )
}
