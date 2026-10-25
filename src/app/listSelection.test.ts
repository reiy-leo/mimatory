import { describe, expect, it } from 'vitest'
import {
  emptySelection,
  extendSelectionBy,
  extendSelectionTo,
  isTextEntryTarget,
  pruneSelection,
  selectAllOf,
  selectedInOrder,
  selectOnly,
  singleSelected,
  toggleInSelection,
} from './listSelection'

const order = ['a', 'b', 'c', 'd', 'e']
const ids = (selection: { ids: ReadonlySet<string> }) => [...selection.ids].sort()

describe('list selection (Finder rules)', () => {
  it('a plain click selects one row, which is the detail pane’s item', () => {
    const selection = selectOnly('c')
    expect(ids(selection)).toEqual(['c'])
    expect(singleSelected(selection)).toBe('c')
    expect(singleSelected(emptySelection)).toBeNull()
    expect(selectOnly(null)).toBe(emptySelection)
  })

  it('⌘-click toggles rows and moves the anchor', () => {
    let selection = toggleInSelection(selectOnly('a'), 'c')
    expect(ids(selection)).toEqual(['a', 'c'])
    expect(singleSelected(selection)).toBeNull()
    expect(selection.anchor).toBe('c')
    selection = toggleInSelection(selection, 'a')
    expect(ids(selection)).toEqual(['c'])
    expect(singleSelected(selection)).toBe('c')
    expect(ids(toggleInSelection(selection, 'c'))).toEqual([])
  })

  it('⇧-click selects the range from the anchor, in either direction, and re-draws it from the same anchor', () => {
    let selection = extendSelectionTo(selectOnly('b'), order, 'd')
    expect(selectedInOrder(selection, order)).toEqual(['b', 'c', 'd'])
    selection = extendSelectionTo(selection, order, 'a')
    expect(selectedInOrder(selection, order)).toEqual(['a', 'b'])
    expect(selection.anchor).toBe('b')
    // No anchor in this list (nothing selected yet, or the anchor was filtered away): the click selects just that row.
    expect(selectedInOrder(extendSelectionTo(selectOnly('zz'), order, 'c'), order)).toEqual(['c'])
  })

  it('⇧↑ / ⇧↓ extend from the anchor and stop at the ends', () => {
    let selection = selectOnly('c')
    selection = extendSelectionBy(selection, order, 1)
    selection = extendSelectionBy(selection, order, 1)
    expect(selectedInOrder(selection, order)).toEqual(['c', 'd', 'e'])
    selection = extendSelectionBy(selection, order, 1)
    expect(selectedInOrder(selection, order)).toEqual(['c', 'd', 'e'])
    // Back past the anchor flips the range to the other side.
    for (let step = 0; step < 3; step += 1) selection = extendSelectionBy(selection, order, -1)
    expect(selectedInOrder(selection, order)).toEqual(['b', 'c'])
    expect(selection.lead).toBe('b')
    // With nothing selected the first step selects an end row.
    expect(ids(extendSelectionBy(emptySelection, order, 1))).toEqual(['a'])
    expect(ids(extendSelectionBy(emptySelection, order, -1))).toEqual(['e'])
  })

  it('⌘A selects every row of the list on screen; an empty list selects nothing', () => {
    expect(selectedInOrder(selectAllOf(order), order)).toEqual(order)
    expect(selectAllOf([])).toBe(emptySelection)
  })

  it('pruning drops rows that left the list and keeps the same object when none did', () => {
    const all = selectAllOf(order)
    expect(pruneSelection(all, new Set(order))).toBe(all)
    const pruned = pruneSelection(all, new Set(['b', 'd']))
    expect(ids(pruned)).toEqual(['b', 'd'])
    expect(pruned.ids.has(pruned.anchor ?? '')).toBe(true)
    expect(pruned.ids.has(pruned.lead ?? '')).toBe(true)
  })

  it('stays linear at 10,000 rows', () => {
    const big = Array.from({ length: 10_000 }, (_, index) => `item-${index}`)
    const started = performance.now()
    let selection = selectAllOf(big)
    selection = toggleInSelection(selection, 'item-5000')
    selection = extendSelectionTo(selectOnly('item-10'), big, 'item-9990')
    const ordered = selectedInOrder(selection, big)
    pruneSelection(selection, new Set(big.slice(0, 5000)))
    expect(ordered.length).toBe(9981)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('treats fields and editables as text entry, so ⌘A keeps selecting text there', () => {
    const fake = (selector: string | null, editable = false) =>
      ({
        closest: (query: string) => (selector && query.includes(selector) ? {} : null),
        isContentEditable: editable,
      }) as unknown as EventTarget
    expect(isTextEntryTarget(fake('input'))).toBe(true)
    expect(isTextEntryTarget(fake('textarea'))).toBe(true)
    expect(isTextEntryTarget(fake(null, true))).toBe(true)
    expect(isTextEntryTarget(fake(null))).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
