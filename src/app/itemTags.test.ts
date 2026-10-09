import { describe, expect, it } from 'vitest'
import {
  addTag,
  countItemTags,
  filterItemsByTag,
  removeTag,
  tagKeyFromNavigation,
  tagList,
  tagNavigationId,
} from './itemTags'

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
