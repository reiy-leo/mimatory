import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearHighlightKeys,
  isHighlighted,
  readHighlightKeys,
  renameHighlightKeys,
  saveHighlightKeys,
  toggleHighlightKeys,
} from './sidebarHighlights'

describe('sidebar highlights', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    })
  })

  it('reads nothing when the preference has never been written', () => {
    expect(readHighlightKeys()).toEqual([])
  })

  it('round-trips the keys it is given', () => {
    saveHighlightKeys(['category:login', 'tag:work'])
    expect(readHighlightKeys()).toEqual(['category:login', 'tag:work'])
  })

  it('drops a stored value it cannot read as sidebar rows', () => {
    store.set('mimatory-sidebar-highlights', '{"pinned":true}')
    expect(readHighlightKeys()).toEqual([])
    store.set('mimatory-sidebar-highlights', '[3, "vault:personal", "tag:work"]')
    expect(readHighlightKeys()).toEqual(['tag:work'])
    store.set('mimatory-sidebar-highlights', 'not json')
    expect(readHighlightKeys()).toEqual([])
  })

  it('keeps a row highlighted through a toggle and nothing else', () => {
    const keys = toggleHighlightKeys([], 'tag', 'work')
    expect(isHighlighted(keys, 'tag', 'work')).toBe(true)
    expect(isHighlighted(toggleHighlightKeys(keys, 'tag', 'work'), 'tag', 'work')).toBe(false)
  })

  it('names the kind and the row together, so one name is not both sections', () => {
    const keys = toggleHighlightKeys([], 'tag', 'login')
    expect(isHighlighted(keys, 'category', 'login')).toBe(false)
  })

  it('clears one section without touching the other', () => {
    const keys = ['category:login', 'category:passport', 'tag:work']
    expect(clearHighlightKeys(keys, 'category')).toEqual(['tag:work'])
    expect(clearHighlightKeys(keys, 'tag')).toEqual(['category:login', 'category:passport'])
  })

  it('follows a renamed row instead of leaving it behind', () => {
    expect(renameHighlightKeys(['tag:work', 'category:login'], 'tag', 'work', 'office')).toEqual([
      'tag:office',
      'category:login',
    ])
  })
})
