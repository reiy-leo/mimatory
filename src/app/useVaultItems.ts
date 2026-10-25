import { type SetStateAction, useCallback, useRef, useState } from 'react'
import { emptySelection, type ListSelection, selectOnly, singleSelected } from './listSelection'
import { type LoginItemSummary, type Tag, type VaultSummary, vaultApi } from './vaultApi'

/**
 * What the window holds of the vault: the open vault's summaries, every open vault's (All), the archive and
 * the trash, the vault rows, the tag rows and the selection, with the reads that refill them. Summaries only
 * (owner 2026-10-23); the selected item's detail is useItemDetail's.
 */
export function useVaultItems() {
  const [items, setItems] = useState<LoginItemSummary[]>([])
  // All (owner 2026-10-18): every open vault's live items. `items` stays the open vault's (the session's), which
  // the vault row lists and every edit acts on; every other sidebar row reads this.
  const [allItems, setAllItems] = useState<LoginItemSummary[] | null>(null)
  // The list's selection (listSelection.ts). `selectedId` — the one item the detail pane opens — is the selection when
  // exactly one row is selected and null for none or several, so every single-item action keeps reading it, and
  // setting it (a click, a save, a re-list) collapses the selection to that row.
  const [selection, setSelection] = useState<ListSelection>(emptySelection)
  const selectedId = singleSelected(selection)
  const setSelectedId = useCallback((action: SetStateAction<string | null>) => {
    setSelection((previous) => {
      // `current => current ?? first` (a re-list) keeps a multi-selection as it is.
      if (typeof action === 'function' && previous.ids.size > 1) return previous
      const current = singleSelected(previous)
      const next = typeof action === 'function' ? action(current) : action
      if (next === current && previous.ids.size === (next ? 1 : 0)) return previous
      return selectOnly(next)
    })
  }, [])
  const [vaults, setVaults] = useState<VaultSummary[]>([])
  const [activeVaultId, setActiveVaultIdState] = useState('personal')
  const activeVaultIdRef = useRef(activeVaultId)
  const setActiveVaultId = useCallback((id: string) => {
    activeVaultIdRef.current = id
    setActiveVaultIdState(id)
  }, [])
  const [archivedItems, setArchivedItems] = useState<LoginItemSummary[]>([])
  const [trashedItems, setTrashedItems] = useState<LoginItemSummary[]>([])
  // A tag's spelling and icon live on the storage row, while which rows the sidebar shows — and how many
  // items each names — is read off the live items, so the two are joined per render. All three panels
  // below address a tag by name, because a name is the only handle an item carries.
  const [tagRecords, setTagRecords] = useState<Tag[]>([])

  // The vault the window reads stays the one it was on while that vault is open; otherwise the first open vault —
  // the rule Rust's `opening_vault_id` uses for an unlock, so after a lock the two agree (2026-10-25 fix).
  async function loadVaults(): Promise<string> {
    const nextVaults = await vaultApi.listVaults()
    setVaults(nextVaults)
    const chosen = openingVaultId(nextVaults, activeVaultIdRef.current)
    activeVaultIdRef.current = chosen
    setActiveVaultId(chosen)
    return chosen
  }

  async function refreshItems() {
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    setSelectedId((current) => current ?? nextItems[0]?.id ?? null)
  }

  async function loadArchivedItems() {
    setArchivedItems(await vaultApi.archived())
  }

  async function loadTrashedItems() {
    setTrashedItems(await vaultApi.trashed())
  }

  return {
    activeVaultId,
    allItems,
    archivedItems,
    items,
    loadArchivedItems,
    loadTrashedItems,
    loadVaults,
    refreshItems,
    selectedId,
    selection,
    setActiveVaultId,
    setAllItems,
    setArchivedItems,
    setItems,
    setSelectedId,
    setSelection,
    setTagRecords,
    setTrashedItems,
    setVaults,
    tagRecords,
    trashedItems,
    vaults,
  }
}

/** `current` while it names an open vault, else the first open vault, else the first vault (or the seeded id). */
export function openingVaultId(vaults: VaultSummary[], current: string): string {
  const open = vaults.filter((vault) => !vault.archived)
  if (open.some((vault) => vault.id === current)) return current
  return open[0]?.id ?? vaults[0]?.id ?? 'personal'
}

/** Owner 2026-10-25: the last open vault can be edited, never archived or dissolved. */
export function isLastOpenVaultIn(vaults: VaultSummary[], vault: VaultSummary): boolean {
  return !vault.archived && !vaults.some((other) => other.id !== vault.id && !other.archived)
}
