import { AlertCircle, Check, ChevronDown, Star } from 'lucide-react'
import { memo, type MouseEvent as ReactMouseEvent } from 'react'
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
  item: LoginItemSummary
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, item: LoginItemSummary) => void
  onSelect: (id: string) => void
  subtitle: string
}

// One list row, memoised: the list can hold thousands of items, and without this every selection,
// keystroke or toast in the window re-rendered all of them. With stable handlers only the rows whose
// item, subtitle or selection changed render again.
export const ItemListRow = memo(function ItemListRow({
  active,
  item,
  onContextMenu,
  onSelect,
  subtitle,
}: ItemListRowProps) {
  return (
    <button
      className={active ? 'item-row active' : 'item-row'}
      data-item-row={item.id}
      onClick={() => onSelect(item.id)}
      onContextMenu={(event) => onContextMenu(event, item)}
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
    activeNavigation,
    beginItemListResize,
    chooseSort,
    error,
    handleItemRowContextMenu,
    handleItemRowSelect,
    itemSort,
    itemSubtitle,
    listTitle,
    lockedRegion,
    restoreStateItem,
    selectedId,
    setPurgeTarget,
    setSortMenuOpen,
    sortMenuOpen,
    stateRows,
    t,
    visibleItems,
  } = vw

  return (
    <>
      <section {...lockedRegion} aria-label={t('landmarks.vaultItems')} className="item-list">
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

        <div className="rows">
          {stateRows
            ? stateRows.map((item) => (
                // A state row is not selectable: the detail pane only ever edits live items, so the
                // row carries its own way back, and the trash carries the way out as well.
                <div className="item-row state-row" key={item.id}>
                  <ItemIcon item={item} />
                  <span className="item-row-text">
                    <strong>{item.title}</strong>
                    <small>
                      <span className="row-subtitle">{itemSubtitle(item)}</span>
                    </small>
                    <span className="state-row-actions">
                      <button
                        aria-label={t('vault.restore', { title: item.title })}
                        className="state-row-button"
                        onClick={() => restoreStateItem(item.id)}
                        title={t('vault.restore', { title: item.title })}
                        type="button"
                      >
                        {t('vault.restoreAction')}
                      </button>
                      {activeNavigation === 'trash' ? (
                        <button
                          aria-label={t('vault.purgeItem', { title: item.title })}
                          className="state-row-button danger"
                          onClick={() => setPurgeTarget(item)}
                          title={t('vault.purgeItem', { title: item.title })}
                          type="button"
                        >
                          {t('vault.purge')}
                        </button>
                      ) : null}
                    </span>
                  </span>
                </div>
              ))
            : visibleItems.map((item) => (
                <ItemListRow
                  active={item.id === selectedId}
                  item={item}
                  key={item.id}
                  onContextMenu={handleItemRowContextMenu}
                  onSelect={handleItemRowSelect}
                  subtitle={itemSubtitle(item)}
                />
              ))}
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
