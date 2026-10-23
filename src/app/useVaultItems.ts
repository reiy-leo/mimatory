import { useState } from 'react'
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vaults, setVaults] = useState<VaultSummary[]>([])
  const [activeVaultId, setActiveVaultId] = useState('personal')
  const [archivedItems, setArchivedItems] = useState<LoginItemSummary[]>([])
  const [trashedItems, setTrashedItems] = useState<LoginItemSummary[]>([])
  // A tag's spelling and icon live on the storage row, while which rows the sidebar shows — and how many
  // items each names — is read off the live items, so the two are joined per render. All three panels
  // below address a tag by name, because a name is the only handle an item carries.
  const [tagRecords, setTagRecords] = useState<Tag[]>([])

  async function loadVaults() {
    const nextVaults = await vaultApi.listVaults()
    setVaults(nextVaults)
    setActiveVaultId(
      (current) => nextVaults.find((vault) => vault.id === current)?.id ?? nextVaults[0]?.id ?? 'personal',
    )
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
    setActiveVaultId,
    setAllItems,
    setArchivedItems,
    setItems,
    setSelectedId,
    setTagRecords,
    setTrashedItems,
    setVaults,
    tagRecords,
    trashedItems,
    vaults,
  }
}
