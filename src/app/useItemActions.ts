import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { useTranslation as useTranslationType } from 'react-i18next'
import { copyText } from './clipboard'
import { describeError } from './errors'
import { openAndFillUrl } from './fieldActions'
import { openUrlExternally } from './fieldControls'
import type { SecurityPreferences } from './securityPreferences'
import { refreshSiteIcon, siteIconDomain } from './siteIcons'
import type { LoginItem } from './vaultApi'
import { type LoginItemSummary, vaultApi } from './vaultApi'
import type { LoginFormState } from './vaultModel'

/**
 * What can be done to the open, stored item from its menu, header or fields: favourite, archive, trash, move,
 * duplicate, share, copy, open, icon (moved out of App.tsx 2026-10-23). Each acts on saved state, then re-lists.
 */
export function useItemActions({
  baselineRef,
  closeFieldMenus,
  form,
  loadArchivedItems,
  loadTrashedItems,
  securityPreferences,
  selectedItem,
  setComposing,
  setError,
  setForm,
  setItems,
  setOperationMessage,
  setSelectedId,
  t,
}: {
  baselineRef: MutableRefObject<LoginFormState>
  closeFieldMenus: () => void
  form: LoginFormState
  loadArchivedItems: () => Promise<void>
  loadTrashedItems: () => Promise<void>
  securityPreferences: SecurityPreferences
  selectedItem: LoginItem | null
  setComposing: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setForm: Dispatch<SetStateAction<LoginFormState>>
  setItems: Dispatch<SetStateAction<LoginItemSummary[]>>
  setOperationMessage: Dispatch<SetStateAction<string | null>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  t: ReturnType<typeof useTranslationType>['t']
}) {
  async function handleRefreshIcon() {
    if (!selectedItem) return
    closeFieldMenus()
    const domain = siteIconDomain(selectedItem)
    if (!domain) return
    try {
      if (selectedItem.icon_mode === 'letter') await vaultApi.setIconMode(selectedItem.id, 'auto')
      const icon = await refreshSiteIcon(domain)
      setItems(await vaultApi.list())
      setOperationMessage(t(icon ? 'messages.iconRefreshed' : 'messages.iconNotFound'))
    } catch (nextError) {
      setError(describeError(nextError))
    }
  }

  async function handleIconMode(mode: 'auto' | 'letter') {
    if (!selectedItem) return
    closeFieldMenus()
    try {
      await vaultApi.setIconMode(selectedItem.id, mode)
      setItems(await vaultApi.list())
    } catch (nextError) {
      setError(describeError(nextError))
    }
  }

  async function handleArchive() {
    if (!selectedItem) return
    await vaultApi.archive(selectedItem.id)
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    setSelectedId(nextItems[0]?.id ?? null)
    await loadArchivedItems()
  }

  async function handleTrash() {
    if (!selectedItem) return
    try {
      await vaultApi.trash(selectedItem.id)
    } catch (nextError) {
      // Rust refuses an item that still has links; the menu row is disabled for that, so this is
      // only reached when the list in hand was stale.
      setError(describeError(nextError))
      return
    }
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    // Nothing takes the place of the item that just left — the pane goes to its empty state rather
    // than opening a create form nobody asked for.
    setSelectedId(null)
    setComposing(false)
    await loadTrashedItems()
  }

  async function handleFavorite() {
    if (!selectedItem) {
      setForm((current) => ({ ...current, favorite: !current.favorite }))
      return
    }
    const next = !selectedItem.favorite
    await vaultApi.favorite(selectedItem.id, next)
    // The star reads the form, which is only reloaded when the selection changes: carry the new state into it
    // (and its baseline, so favouriting never counts as an unsaved edit or gets undone by a later save).
    baselineRef.current = { ...baselineRef.current, favorite: next }
    setForm((current) => ({ ...current, favorite: next }))
    const nextItems = await vaultApi.list()
    setItems(nextItems)
  }

  async function handleMoveToVault(vaultId: string, vaultName: string) {
    if (!selectedItem) return
    closeFieldMenus()
    try {
      await vaultApi.move(selectedItem.id, vaultId)
      // The item leaves the vault this session reads, so the pane goes back to its empty state —
      // reading the target vault stays the picker's job, not a side effect of a move.
      setItems(await vaultApi.list())
      setSelectedId(null)
      setComposing(false)
      setOperationMessage(t('messages.movedItem', { vault: vaultName }))
    } catch (nextError) {
      setError(describeError(nextError))
    }
  }

  async function handleDuplicate() {
    if (!selectedItem) return
    closeFieldMenus()
    try {
      const copy = await vaultApi.duplicate(selectedItem.id, t('vault.duplicateTitle', { title: selectedItem.title }))
      setItems(await vaultApi.list())
      setSelectedId(copy.id)
      setOperationMessage(t('messages.duplicatedItem', { title: copy.title }))
    } catch (nextError) {
      setError(describeError(nextError))
    }
  }

  // There is no transport to hand an item to, so sharing means the clipboard the password field
  // already uses — same value, same 90-second clear preference, nothing written anywhere else.
  async function handleShare() {
    closeFieldMenus()
    await copyPassword()
    setOperationMessage(t('messages.sharedPassword'))
  }

  async function copyPassword() {
    await copySecretText(form.password)
  }

  // A secret honours the 90-second clipboard clear; a plain value (a username, a hostname) does not.
  async function copySecretText(value: string, sensitive = true) {
    await copyText(value, { clearAfter90Seconds: securityPreferences.clearClipboardAfter90Seconds, sensitive })
  }

  async function copyFieldValue(value: string, label: string, sensitive: boolean) {
    setError(null)
    try {
      await copySecretText(value, sensitive)
      setOperationMessage(t('messages.copiedField', { label }))
      if (selectedItem) void vaultApi.recordUse(selectedItem.id).catch(() => {})
    } catch (nextError) {
      setError(describeError(nextError))
    }
  }

  // Open & Fill: the address opens in the default browser carrying this item's id in its fragment, which the
  // extension's content script turns into a fill of this one item (fieldActions.ts `openAndFillUrl`).
  function openItemWebsite(url: string, fill: boolean) {
    const target = fill && selectedItem ? openAndFillUrl(url, selectedItem.id) : url
    if (!target) return
    openUrlExternally(target)
    if (selectedItem) void vaultApi.recordUse(selectedItem.id).catch(() => {})
    if (fill) setOperationMessage(t('messages.openedToFill', { host: new URL(target).hostname }))
  }

  return {
    copyFieldValue,
    copyPassword,
    copySecretText,
    handleArchive,
    handleDuplicate,
    handleFavorite,
    handleIconMode,
    handleMoveToVault,
    handleRefreshIcon,
    handleShare,
    handleTrash,
    openItemWebsite,
  }
}
