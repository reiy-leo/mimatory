import { describe, expect, it } from 'vitest'
import {
  ancestorIds,
  descendantIds,
  emptyRelationDraft,
  filterByTitle,
  hasRelations,
  relationCandidates,
  relationChanges,
  relationDraftKey,
  relationDraftOf,
  relationRef,
} from './itemRelations'
import type { ItemRelations, LoginItem, RelatedItemRef } from './vaultApi'

function ref(id: string, archived = false): RelatedItemRef {
  return { archived, id, item_type: 'login', title: id.toUpperCase() }
}

function item(id: string, relations?: Partial<ItemRelations>): LoginItem {
  return {
    custom_fields: [],
    favorite: false,
    id,
    item_type: 'login',
    notes: '',
    password: '',
    relations: relations ? { children: [], parent: null, related: [], ...relations } : undefined,
    tags: [],
    title: id.toUpperCase(),
    updated_at: '',
    urls: [],
    username: '',
    website: '',
  }
}

// bank ─┬─ card ── pin
//       └─ app        server ↔ db (related)
const items = [
  item('bank', { children: [ref('app'), ref('card')] }),
  item('card', { children: [ref('pin')], parent: ref('bank') }),
  item('pin', { parent: ref('card') }),
  item('app', { parent: ref('bank') }),
  item('server', { related: [ref('db')] }),
  item('db', { related: [ref('server')] }),
  item('loose'),
]

const ids = (list: LoginItem[]) => list.map((entry) => entry.id)

describe('item relations', () => {
  it('reads a draft from stored relations and knows when there are none', () => {
    expect(relationDraftOf(undefined)).toEqual(emptyRelationDraft)
    expect(relationDraftOf(items[1].relations)).toEqual({
      childIds: ['pin'],
      parentId: 'bank',
      relatedIds: [],
      signInId: null,
    })
    expect(hasRelations(items[1].relations)).toBe(true)
    expect(hasRelations(items[6].relations)).toBe(false)
    expect(hasRelations({ children: [], parent: null, related: [] })).toBe(false)
  })

  it('compares drafts regardless of order', () => {
    expect(relationDraftKey({ childIds: ['a', 'b'], parentId: null, relatedIds: [], signInId: null })).toBe(
      relationDraftKey({ childIds: ['b', 'a'], parentId: null, relatedIds: [], signInId: null }),
    )
    expect(relationDraftKey(undefined)).toBe(relationDraftKey(emptyRelationDraft))
  })

  it('walks ancestors and descendants through stored parents', () => {
    expect([...ancestorIds(items, 'pin')]).toEqual(['pin', 'card', 'bank'])
    expect([...descendantIds(items, ['bank'])].sort()).toEqual(['app', 'card', 'pin'])
    expect(ancestorIds(items, null).size).toBe(0)
  })

  it('never offers itself, a linked item or a choice that would close a loop', () => {
    const cardDraft = relationDraftOf(items[1].relations)
    expect(ids(relationCandidates(items, 'card', 'parent', cardDraft))).toEqual(['app', 'server', 'db', 'loose'])
    // A child cannot come from above, and must not already belong to someone else.
    expect(ids(relationCandidates(items, 'card', 'child', cardDraft))).toEqual(['server', 'db', 'loose'])
    expect(ids(relationCandidates(items, 'server', 'related', relationDraftOf(items[4].relations)))).toEqual([
      'bank',
      'card',
      'pin',
      'app',
      'loose',
    ])
    // A new item (no id yet) still respects what its own draft has picked.
    const draft = { childIds: ['loose'], parentId: null, relatedIds: [], signInId: null }
    expect(ids(relationCandidates(items, null, 'parent', draft))).not.toContain('loose')
  })

  it('orders a save so removals go first', () => {
    const baseline = { childIds: ['pin'], parentId: 'bank', relatedIds: ['db'], signInId: null }
    const draft = { childIds: ['loose'], parentId: 'app', relatedIds: ['server'], signInId: null }
    expect(relationChanges('card', baseline, draft)).toEqual([
      { kind: 'unlink', otherId: 'db' },
      { itemId: 'pin', kind: 'setParent', parentId: null },
      { itemId: 'card', kind: 'setParent', parentId: null },
      { itemId: 'card', kind: 'setParent', parentId: 'app' },
      { itemId: 'loose', kind: 'setParent', parentId: 'card' },
      { kind: 'link', otherId: 'server' },
    ])
    expect(relationChanges('card', baseline, baseline)).toEqual([])
  })

  it('draws a draft id from the live list, falling back to the stored ref', () => {
    expect(relationRef('loose', items)?.title).toBe('LOOSE')
    const stored = { children: [ref('gone', true)], parent: null, related: [] }
    expect(relationRef('gone', items, stored)).toEqual(ref('gone', true))
    expect(relationRef('nowhere', items, stored)).toBeNull()
    expect(ids(filterByTitle(items, ' ba '))).toEqual(['bank'])
  })
})

describe('sign-in links', () => {
  it('reads the stored account into the draft and counts it as a link on both ends', () => {
    const relations = { children: [], parent: null, related: [], sign_in_with: ref('google') }
    expect(relationDraftOf(relations).signInId).toBe('google')
    expect(hasRelations(relations)).toBe(true)
    expect(hasRelations({ children: [], parent: null, related: [], signs_in_to: [ref('figma')] })).toBe(true)
    expect(hasRelations({ children: [], parent: null, related: [], signs_in_to: [] })).toBe(false)
  })

  it('writes a changed account last and leaves an unchanged one alone', () => {
    const baseline = { ...emptyRelationDraft, signInId: 'google' }
    expect(relationChanges('figma', baseline, baseline)).toEqual([])
    expect(relationChanges('figma', baseline, { ...baseline, relatedIds: ['x'], signInId: 'apple' })).toEqual([
      { kind: 'link', otherId: 'x' },
      { accountId: 'apple', kind: 'setSignIn' },
    ])
    expect(relationChanges('figma', baseline, { ...baseline, signInId: null })).toEqual([
      { accountId: null, kind: 'setSignIn' },
    ])
    expect(relationDraftKey(baseline)).not.toBe(relationDraftKey(emptyRelationDraft))
  })

  it('resolves an archived account from the stored ref', () => {
    const stored = { children: [], parent: null, related: [], sign_in_with: ref('gone', true) }
    expect(relationRef('gone', items, stored)).toEqual(ref('gone', true))
  })
})
