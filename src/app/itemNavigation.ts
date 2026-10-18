/**
 * The item one step before (`-1`) or after (`+1`) the selected one in the list on screen, or `null` at either
 * end, in an empty list, or when the selection is not in the list (the toolbar's previous / next buttons and
 * ⌘↑ / ⌘↓ then do nothing rather than jumping somewhere unexpected).
 */
export function adjacentItemId(ids: readonly string[], selectedId: string | null, step: -1 | 1): string | null {
  if (!selectedId) return null
  const index = ids.indexOf(selectedId)
  if (index === -1) return null
  return ids[index + step] ?? null
}
