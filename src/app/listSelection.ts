/**
 * The item list's selection (2026-10-25, owner: "⌘A 不能全选 … 没有办法批量删除"), Finder's rules: a click selects one row,
 * ⌘-click toggles a row, ⇧-click selects the range from the anchor, ⇧↑/⇧↓ extend from the anchor, ⌘A selects every
 * row of the list on screen and Escape clears. Pure functions over a Set, so a list of 10,000 rows costs one pass at
 * most and a click on one row costs nothing per row.
 *
 * `anchor` is where a range starts (the last plain or ⌘ click); `lead` is the row the keyboard moves from (the last
 * row added). A single selection is `{ ids: {id}, anchor: id, lead: id }`.
 */
export type ListSelection = {
  readonly anchor: string | null
  readonly ids: ReadonlySet<string>
  readonly lead: string | null
}

export const emptySelection: ListSelection = { anchor: null, ids: new Set(), lead: null }

export function selectOnly(id: string | null): ListSelection {
  return id ? { anchor: id, ids: new Set([id]), lead: id } : emptySelection
}

/** ⌘-click: add or remove one row; an added row becomes the anchor for a following ⇧-click. */
export function toggleInSelection(selection: ListSelection, id: string): ListSelection {
  const ids = new Set(selection.ids)
  if (ids.has(id)) {
    ids.delete(id)
    const lead = selection.lead === id ? (ids.values().next().value ?? null) : selection.lead
    // A removed row cannot anchor a range: it stays with the anchor while that is still selected, else the lead.
    const anchor = selection.anchor && ids.has(selection.anchor) ? selection.anchor : lead
    return { anchor: ids.size ? anchor : null, ids, lead: ids.size ? lead : null }
  }
  ids.add(id)
  return { anchor: id, ids, lead: id }
}

/** The rows between `from` and `to` in list order, both included; `[to]` when `from` is not in the list. */
function rangeIds(order: readonly string[], from: string | null, to: string): string[] {
  const end = order.indexOf(to)
  if (end < 0) return []
  const start = from ? order.indexOf(from) : -1
  if (start < 0) return [to]
  const [low, high] = start <= end ? [start, end] : [end, start]
  return order.slice(low, high + 1)
}

/**
 * ⇧-click: the range from the anchor to the clicked row replaces the selection (Finder keeps ⌘-added rows only with
 * ⇧⌘; this list does what a plain ⇧ does). The anchor stays put, so a second ⇧-click re-draws the range from it.
 */
export function extendSelectionTo(selection: ListSelection, order: readonly string[], id: string): ListSelection {
  const anchor = selection.anchor && order.includes(selection.anchor) ? selection.anchor : null
  const ids = new Set(rangeIds(order, anchor, id))
  if (!ids.size) return selection
  return { anchor: anchor ?? id, ids, lead: id }
}

/** ⇧↑ / ⇧↓: move the lead one row and select the range from the anchor to it. */
export function extendSelectionBy(selection: ListSelection, order: readonly string[], step: -1 | 1): ListSelection {
  if (!order.length) return selection
  const leadIndex = selection.lead ? order.indexOf(selection.lead) : -1
  if (leadIndex < 0) return selectOnly(order[step === 1 ? 0 : order.length - 1] ?? null)
  const next = order[Math.min(order.length - 1, Math.max(0, leadIndex + step))]
  if (!next) return selection
  return extendSelectionTo(selection.anchor ? selection : { ...selection, anchor: selection.lead }, order, next)
}

/** ⌘A / Edit ▸ Select All: every row of the list as it is filtered and sorted now. */
export function selectAllOf(order: readonly string[]): ListSelection {
  if (!order.length) return emptySelection
  return { anchor: order[0] ?? null, ids: new Set(order), lead: order[order.length - 1] ?? null }
}

/** Drops rows that left the list (trashed, moved, filtered out). Returns the same object when nothing changed. */
export function pruneSelection(selection: ListSelection, present: ReadonlySet<string>): ListSelection {
  let missing = false
  for (const id of selection.ids) {
    if (!present.has(id)) {
      missing = true
      break
    }
  }
  if (!missing) return selection
  const ids = new Set([...selection.ids].filter((id) => present.has(id)))
  const keep = (id: string | null) => (id && ids.has(id) ? id : (ids.values().next().value ?? null))
  return { anchor: keep(selection.anchor), ids, lead: keep(selection.lead) }
}

/** The selected ids in list order — what a bulk command is given, and what its confirmation counts. */
export function selectedInOrder(selection: ListSelection, order: readonly string[]): string[] {
  if (!selection.ids.size) return []
  return order.filter((id) => selection.ids.has(id))
}

/** The one selected row, when exactly one is selected. */
export function singleSelected(selection: ListSelection): string | null {
  if (selection.ids.size !== 1) return null
  return selection.ids.values().next().value ?? null
}

/** Whether a keyboard event is in a place where ⌘A must keep its text meaning (a field, an editable). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  const element = target as HTMLElement
  if (element.isContentEditable) return true
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}
