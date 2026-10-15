import type { ItemRelations, LoginItem, RelatedItemRef } from './vaultApi'

// The links an open form is editing. Ids only: titles come from the live list (or the stored ref,
// for an archived counterpart), so a rename elsewhere shows up without touching the draft.
export type RelationDraft = {
  childIds: string[]
  parentId: string | null
  relatedIds: string[]
}

export type RelationKind = 'child' | 'parent' | 'related'

// What a save sends, in the order it must go: every link that is going away first, so a swap (a child
// promoted to parent, say) never trips the cycle check halfway through.
export type RelationChange =
  | { kind: 'link'; otherId: string }
  | { kind: 'setParent'; itemId: string; parentId: string | null }
  | { kind: 'unlink'; otherId: string }

export const emptyRelationDraft: RelationDraft = { childIds: [], parentId: null, relatedIds: [] }

export function relationDraftOf(relations?: ItemRelations | null): RelationDraft {
  if (!relations) return emptyRelationDraft
  return {
    childIds: relations.children.map((child) => child.id),
    parentId: relations.parent?.id ?? null,
    relatedIds: relations.related.map((related) => related.id),
  }
}

// Whether the item has any link at all — the rule that keeps Delete (and Move) unavailable.
export function hasRelations(relations?: ItemRelations | null): boolean {
  return Boolean(relations && (relations.parent || relations.children.length || relations.related.length))
}

export function relationDraftKey(draft?: RelationDraft): string {
  const value = draft ?? emptyRelationDraft
  return JSON.stringify([value.parentId, [...value.childIds].sort(), [...value.relatedIds].sort()])
}

export function relationChanges(itemId: string, baseline: RelationDraft, draft: RelationDraft): RelationChange[] {
  const removed = (from: string[], to: string[]) => from.filter((id) => !to.includes(id))
  const changes: RelationChange[] = []
  for (const otherId of removed(baseline.relatedIds, draft.relatedIds)) changes.push({ kind: 'unlink', otherId })
  for (const childId of removed(baseline.childIds, draft.childIds)) {
    changes.push({ itemId: childId, kind: 'setParent', parentId: null })
  }
  if (baseline.parentId && baseline.parentId !== draft.parentId) {
    changes.push({ itemId, kind: 'setParent', parentId: null })
  }
  if (draft.parentId && draft.parentId !== baseline.parentId) {
    changes.push({ itemId, kind: 'setParent', parentId: draft.parentId })
  }
  for (const childId of removed(draft.childIds, baseline.childIds)) {
    changes.push({ itemId: childId, kind: 'setParent', parentId: itemId })
  }
  for (const otherId of removed(draft.relatedIds, baseline.relatedIds)) changes.push({ kind: 'link', otherId })
  return changes
}

function storedParentId(items: LoginItem[], id: string): string | null {
  return items.find((item) => item.id === id)?.relations?.parent?.id ?? null
}

// Every item above `startId`, `startId` included, following the stored parents.
export function ancestorIds(items: LoginItem[], startId: string | null): Set<string> {
  const seen = new Set<string>()
  let cursor = startId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    cursor = storedParentId(items, cursor)
  }
  return seen
}

// Every item below the roots, the roots excluded, following the stored parents downward.
export function descendantIds(items: LoginItem[], rootIds: string[]): Set<string> {
  const found = new Set<string>()
  const queue = [...rootIds]
  while (queue.length) {
    const current = queue.shift() as string
    for (const item of items) {
      if (item.relations?.parent?.id === current && !found.has(item.id)) {
        found.add(item.id)
        queue.push(item.id)
      }
    }
  }
  return found
}

// What the picker offers for one kind of link. Never the item itself, never something it is already
// linked to, and never a choice that would close a loop: a parent cannot come from below the item, a
// child cannot come from above it. A child also has to be free — it already belonging to another
// parent is changed from that item's own "Parent Item…", not stolen from here.
export function relationCandidates(
  items: LoginItem[],
  selfId: string | null,
  kind: RelationKind,
  draft: RelationDraft,
): LoginItem[] {
  const linked = new Set([...(draft.parentId ? [draft.parentId] : []), ...draft.childIds, ...draft.relatedIds])
  const excluded = new Set(linked)
  if (selfId) excluded.add(selfId)
  if (kind === 'parent') {
    for (const id of descendantIds(items, [...(selfId ? [selfId] : []), ...draft.childIds])) excluded.add(id)
  }
  if (kind === 'child') {
    for (const id of ancestorIds(items, draft.parentId)) excluded.add(id)
  }
  return items.filter((item) => {
    if (excluded.has(item.id)) return false
    if (kind !== 'child') return true
    const parentId = item.relations?.parent?.id
    return !parentId || parentId === selfId
  })
}

// A draft id drawn as a row: the live item when there is one, else the ref the vault returned (an
// archived counterpart is not in the live list).
export function relationRef(id: string, items: LoginItem[], stored?: ItemRelations | null): RelatedItemRef | null {
  const live = items.find((item) => item.id === id)
  if (live) return { archived: false, id, item_type: live.item_type, title: live.title }
  const refs = stored ? [...(stored.parent ? [stored.parent] : []), ...stored.children, ...stored.related] : []
  return refs.find((ref) => ref.id === id) ?? null
}

export function filterByTitle(items: LoginItem[], query: string): LoginItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => item.title.toLowerCase().includes(needle))
}
