// A highlighted sidebar row is exempt from its section's collapse, so the tags and categories the user
// works with stay on screen while the rest of the list folds away. The choice governs only how the
// sidebar is drawn, so it lives in localStorage beside the theme and the language — never in the
// encrypted vault, where a display preference has no business being.
export type HighlightKind = 'category' | 'tag'

const storageKey = 'passless-sidebar-highlights'

export function highlightKey(kind: HighlightKind, id: string): string {
  return `${kind}:${id}`
}

export function isHighlighted(keys: string[], kind: HighlightKind, id: string): boolean {
  return keys.includes(highlightKey(kind, id))
}

export function toggleHighlightKeys(keys: string[], kind: HighlightKind, id: string): string[] {
  const key = highlightKey(kind, id)
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key]
}

export function clearHighlightKeys(keys: string[], kind: HighlightKind): string[] {
  return keys.filter((candidate) => !candidate.startsWith(`${kind}:`))
}

// A rename changes the handle the row is addressed by, and the highlight has to follow it the same way
// an open filter does — otherwise editing the spelling of a tag quietly unpins it.
export function renameHighlightKeys(keys: string[], kind: HighlightKind, from: string, to: string): string[] {
  return keys.map((candidate) => (candidate === highlightKey(kind, from) ? highlightKey(kind, to) : candidate))
}

export function readHighlightKeys(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Keys from a future or hand-edited file would name a row the sidebar can no longer draw.
    return parsed.filter(
      (candidate): candidate is string =>
        typeof candidate === 'string' && (candidate.startsWith('category:') || candidate.startsWith('tag:')),
    )
  } catch {
    return []
  }
}

export function saveHighlightKeys(keys: string[]) {
  globalThis.localStorage?.setItem(storageKey, JSON.stringify(keys))
}
