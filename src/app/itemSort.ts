import type { LoginItemSummary } from './vaultApi'

/** What a sort reads: the list's summaries carry all of it, and so does a full item. */
type Sortable = Pick<LoginItemSummary, 'created_at' | 'last_used_at' | 'title' | 'updated_at' | 'use_count'>

/**
 * The item list's sort (owner 2026-10-18, after 1Password 8's "N items sorted by" menu): what to sort by, then
 * which way. Remembered across launches; one choice for every list.
 */
export type ItemSortKey = 'title' | 'created' | 'modified' | 'frequent' | 'recent'
export type ItemSortDirection = 'desc' | 'asc'
export type ItemSort = { key: ItemSortKey; direction: ItemSortDirection }

export const itemSortKeys: readonly ItemSortKey[] = ['title', 'created', 'modified', 'frequent', 'recent']
export const defaultItemSort: ItemSort = { direction: 'desc', key: 'modified' }
export const itemSortStorageKey = 'passless-item-sort'

/** Title reads A→Z by default; every other key starts at the newest or most used. */
export function defaultDirectionFor(key: ItemSortKey): ItemSortDirection {
  return key === 'title' ? 'asc' : 'desc'
}

export function readItemSort(storage: Pick<Storage, 'getItem'> | undefined): ItemSort {
  try {
    const parsed = JSON.parse(storage?.getItem(itemSortStorageKey) ?? 'null') as Partial<ItemSort> | null
    if (
      parsed &&
      itemSortKeys.includes(parsed.key as ItemSortKey) &&
      (parsed.direction === 'asc' || parsed.direction === 'desc')
    ) {
      return { direction: parsed.direction, key: parsed.key as ItemSortKey }
    }
  } catch {
    // A hand-edited or old value falls back to the default.
  }
  return defaultItemSort
}

function time(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

function compareTitles(a: Sortable, b: Sortable, locale: string): number {
  return a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: 'base' })
}

/**
 * Sorted copy of `items`. Ties (and Title itself as the last resort) fall back to the title A→Z so the order
 * never flickers between two reads of the same list.
 */
export function sortItems<T extends Sortable>(items: readonly T[], sort: ItemSort, locale = 'en'): T[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  const primary = (a: T, b: T): number => {
    switch (sort.key) {
      case 'title':
        return compareTitles(a, b, locale)
      case 'created':
        return time(a.created_at) - time(b.created_at)
      case 'modified':
        return time(a.updated_at) - time(b.updated_at)
      case 'frequent':
        return (a.use_count ?? 0) - (b.use_count ?? 0)
      case 'recent':
        return time(a.last_used_at) - time(b.last_used_at)
    }
  }
  return [...items].sort((a, b) => sign * primary(a, b) || compareTitles(a, b, locale))
}
