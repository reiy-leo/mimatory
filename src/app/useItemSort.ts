import { useEffect, useState } from 'react'
import { type ItemSort, itemSortStorageKey, readItemSort } from './itemSort'

/** The item list's sort and its menu (owner 2026-10-18, after 1Password 8), remembered across launches. */
export function useItemSort() {
  const [itemSort, setItemSort] = useState<ItemSort>(() => readItemSort(globalThis.localStorage))
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  function chooseSort(next: ItemSort) {
    setItemSort(next)
    setSortMenuOpen(false)
    try {
      globalThis.localStorage?.setItem(itemSortStorageKey, JSON.stringify(next))
    } catch {
      // Private mode or a full store: the choice still holds for this session.
    }
  }

  useEffect(() => {
    if (!sortMenuOpen) return
    const close = (event: Event) => {
      if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-sort-menu'))) return
      setSortMenuOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSortMenuOpen(false)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEscape)
    }
  }, [sortMenuOpen])

  return { chooseSort, itemSort, setItemSort, setSortMenuOpen, sortMenuOpen }
}
