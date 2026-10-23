import { useEffect, useRef, useState } from 'react'
import { type LoginItem, type LoginItemSummary, vaultApi } from './vaultApi'

export type ItemDetail = {
  // The open item in full, once it has been read; null while it loads or when nothing is selected.
  item: LoginItem | null
  // A row is selected and its detail is on the way (the pane shows a quiet loading state).
  loading: boolean
  // Puts a full item the window already holds (a save's answer) in place without another read.
  prime: (item: LoginItem) => void
}

/**
 * The selected item, decrypted on demand (owner 2026-10-23: "列表只返回摘要，选中条目时再解密详情"). The list
 * holds summaries; only the one row the user opens is read in full through `get_login_item`, and only that
 * one is kept. It is read again whenever its row is — every list command answers with fresh objects, so a
 * save, a favourite, a link changed from the other end or the bridge's `vault:changed` re-list all reach it —
 * and an answer for a row that is no longer selected is dropped.
 */
export function useItemDetail(summary: LoginItemSummary | null, enabled: boolean): ItemDetail {
  const [detail, setDetail] = useState<LoginItem | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const requestRef = useRef(0)
  const id = enabled ? (summary?.id ?? null) : null

  useEffect(() => {
    if (!enabled || !summary) return
    const request = ++requestRef.current
    const itemId = summary.id
    vaultApi
      .getItem(itemId, summary.vault_id)
      .then((item) => {
        if (request !== requestRef.current) return
        setDetail(item)
        setFailedId(null)
      })
      .catch(() => {
        // The row went away between the list and this read (trashed from the extension, say): the pane
        // falls back to its empty state, as it did when the selected id stopped matching a list row.
        if (request !== requestRef.current) return
        setDetail((current) => (current?.id === itemId ? null : current))
        setFailedId(itemId)
      })
  }, [enabled, summary])

  // Forget the decrypted item as soon as the window locks.
  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1
      setDetail(null)
      setFailedId(null)
    }
  }, [enabled])

  const item = id && detail?.id === id ? detail : null
  return {
    item,
    loading: Boolean(id) && !item && failedId !== id,
    prime: (next) => {
      requestRef.current += 1
      setDetail(next)
      setFailedId(null)
    },
  }
}
