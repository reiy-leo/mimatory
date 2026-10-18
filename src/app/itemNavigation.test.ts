import { describe, expect, it } from 'vitest'
import { adjacentItemId } from './itemNavigation'

describe('adjacentItemId', () => {
  const ids = ['a', 'b', 'c']

  it('steps to the previous and next item', () => {
    expect(adjacentItemId(ids, 'b', -1)).toBe('a')
    expect(adjacentItemId(ids, 'b', 1)).toBe('c')
  })

  it('stops at either end instead of wrapping', () => {
    expect(adjacentItemId(ids, 'a', -1)).toBeNull()
    expect(adjacentItemId(ids, 'c', 1)).toBeNull()
  })

  it('does nothing for an empty list, no selection, or a selection outside the list', () => {
    expect(adjacentItemId([], 'a', 1)).toBeNull()
    expect(adjacentItemId(ids, null, 1)).toBeNull()
    expect(adjacentItemId(ids, 'z', -1)).toBeNull()
  })

  it('has no neighbour in a one-item list', () => {
    expect(adjacentItemId(['a'], 'a', -1)).toBeNull()
    expect(adjacentItemId(['a'], 'a', 1)).toBeNull()
  })
})
