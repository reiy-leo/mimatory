import { describe, expect, it } from 'vitest'
import {
  addTag,
  countItemTags,
  defaultTagIcon,
  filterItemsByTag,
  removeTag,
  tagKeyFromNavigation,
  tagList,
  tagNavigationId,
  tagRows,
} from './itemTags'
import type { Tag } from './vaultApi'

function item(id: string, tags: string[]) {
  return { id, tags }
}

describe('tag list editing', () => {
  it('keeps one spelling per tag the way the save path does', () => {
    expect(tagList('Work, work, personal')).toEqual(['Work', 'personal'])
  })

  it('adds a tag without duplicating one that only differs in case', () => {
    expect(addTag('Work', ' work ')).toBe('Work')
  })

  it('accepts a pasted list of tags in one go', () => {
    expect(addTag('Work', 'finance, ops, work')).toBe('Work, finance, ops')
  })

  it('removes a tag by its case-insensitive key', () => {
    expect(removeTag('Work, finance', 'work')).toBe('finance')
  })

  it('leaves nothing behind when the last tag is removed', () => {
    expect(removeTag('Work', 'work')).toBe('')
  })
})

describe('tag filtering', () => {
  it('counts each tag once per item and names it by the first spelling seen', () => {
    const counts = countItemTags([item('a', ['Work', 'finance']), item('b', ['work']), item('c', [])], 'en')
    expect(counts).toEqual([
      { count: 1, key: 'finance', name: 'finance' },
      { count: 2, key: 'work', name: 'Work' },
    ])
  })

  it('filters on the tag key rather than the spelling', () => {
    const items = [item('a', ['Work']), item('b', ['work']), item('c', ['home'])]
    expect(filterItemsByTag(items, 'work').map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('round-trips a sidebar selection through the navigation id', () => {
    expect(tagNavigationId('work')).toBe('tag:work')
    expect(tagKeyFromNavigation('tag:work')).toBe('work')
    expect(tagKeyFromNavigation('favorites')).toBeNull()
  })
})

describe('tag row styling', () => {
  const counts = countItemTags([item('a', ['Work']), item('b', ['home'])], 'en')

  it('puts the stored icon on the row that names it, whatever spelling either side used', () => {
    // In the vault an item's tags are decrypted from the row it links to, so the two spellings can only
    // differ here — the join is on the key, not on the text.
    const tags: Tag[] = [
      { icon: 'briefcase', name: 'work' },
      { icon: 'home', name: 'Home' },
    ]
    expect(tagRows(counts, tags)).toEqual([
      { count: 1, icon: 'home', key: 'home', name: 'home' },
      { count: 1, icon: 'briefcase', key: 'work', name: 'Work' },
    ])
  })

  it('falls back to the default icon rather than dropping the row', () => {
    // A tag a save path created has a row, and a row the picker never styled reads as the default.
    expect(tagRows(counts, [{ icon: defaultTagIcon, name: 'Work' }])[1]).toEqual({
      count: 1,
      icon: 'tag',
      key: 'work',
      name: 'Work',
    })
    expect(tagRows(counts, [])[1]?.icon).toBe(defaultTagIcon)
  })

  it('shows only the tags a live item still names', () => {
    // The row outlives the last live item that used it, so the count list decides what the sidebar offers.
    expect(tagRows(counts, []).map((row) => row.key)).toEqual(['home', 'work'])
  })
})
