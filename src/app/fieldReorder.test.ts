import { describe, expect, it } from 'vitest'
import { type ContainerLists, keyboardTarget, moveFieldEntry } from './fieldReorder'
import { parseSectionChildren, stringifySectionChildren } from './itemFields'
import type { CustomField } from './vaultApi'

const field = (label: string, field_type = 'text'): CustomField => ({ field_type, label, value: label.toLowerCase() })
const section = (label: string, children: string[]): CustomField => ({
  field_type: 'section',
  label,
  value: stringifySectionChildren(
    children.map((child) => ({ field_type: 'text', id: `${label}-${child}`, label: child, value: child })),
  ),
})

// custom_fields: 0 OTP (login), 1 A, 2 Section S [x, y], 3 B, 4 Section T []
const fields: CustomField[] = [field('OTP', 'otp'), field('A'), section('S', ['x', 'y']), field('B'), section('T', [])]
const lists: ContainerLists = { login: [0], top: [1, 2, 3, 4] }
const labels = (next: CustomField[] | null) => next?.map((entry) => entry.label)
const childLabels = (next: CustomField[] | null, index: number) =>
  parseSectionChildren(next?.[index]?.value ?? '').map((child) => child.label)

describe('moving fields between lists and sections', () => {
  it('reorders top-level entries, sections included', () => {
    expect(
      labels(moveFieldEntry(fields, lists, { container: 'top', index: 0 }, { container: 'top', index: 2 })),
    ).toEqual(['OTP', 'S', 'B', 'A', 'T'])
    expect(
      labels(moveFieldEntry(fields, lists, { container: 'top', index: 1 }, { container: 'top', index: 3 })),
    ).toEqual(['OTP', 'A', 'B', 'T', 'S'])
  })

  it('moves a loose field into a section and back out', () => {
    const into = moveFieldEntry(fields, lists, { container: 'top', index: 0 }, { container: 'section:2', index: 1 })
    expect(labels(into)).toEqual(['OTP', 'S', 'B', 'T'])
    expect(childLabels(into, 1)).toEqual(['x', 'A', 'y'])

    const out = moveFieldEntry(fields, lists, { container: 'section:2', index: 0 }, { container: 'top', index: 3 })
    expect(labels(out)).toEqual(['OTP', 'A', 'S', 'B', 'x', 'T'])
    expect(childLabels(out, 2)).toEqual(['y'])
    expect(out?.[4]).toEqual({ field_type: 'text', label: 'x', value: 'x' })
  })

  it('moves a child between sections and within one', () => {
    const across = moveFieldEntry(
      fields,
      lists,
      { container: 'section:2', index: 1 },
      { container: 'section:4', index: 0 },
    )
    expect(childLabels(across, 2)).toEqual(['x'])
    expect(childLabels(across, 4)).toEqual(['y'])
    const within = moveFieldEntry(
      fields,
      lists,
      { container: 'section:2', index: 0 },
      { container: 'section:2', index: 1 },
    )
    expect(childLabels(within, 2)).toEqual(['y', 'x'])
  })

  it('refuses moves that would break the model', () => {
    // A section cannot nest, an OTP seed cannot enter a section or the loose list, nothing enters the login card.
    expect(
      moveFieldEntry(fields, lists, { container: 'top', index: 1 }, { container: 'section:4', index: 0 }),
    ).toBeNull()
    expect(moveFieldEntry(fields, lists, { container: 'login', index: 0 }, { container: 'top', index: 0 })).toBeNull()
    expect(moveFieldEntry(fields, lists, { container: 'top', index: 0 }, { container: 'login', index: 0 })).toBeNull()
    expect(moveFieldEntry(fields, lists, { container: 'top', index: 0 }, { container: 'top', index: 0 })).toBeNull()
    const file = [field('F', 'file'), section('S', [])]
    expect(
      moveFieldEntry(
        file,
        { login: [], top: [0, 1] },
        { container: 'top', index: 0 },
        { container: 'section:1', index: 0 },
      ),
    ).toBeNull()
  })
})

describe('keyboard reordering', () => {
  it('steps within a list', () => {
    expect(keyboardTarget(fields, lists, { container: 'section:2', index: 0 }, 1)).toEqual({
      container: 'section:2',
      index: 1,
    })
    expect(keyboardTarget(fields, lists, { container: 'top', index: 1 }, 1)).toEqual({ container: 'top', index: 2 })
  })

  it('crosses section edges', () => {
    // Out of the top / bottom of a section, beside it.
    expect(keyboardTarget(fields, lists, { container: 'section:2', index: 0 }, -1)).toEqual({
      container: 'top',
      index: 1,
    })
    expect(keyboardTarget(fields, lists, { container: 'section:2', index: 1 }, 1)).toEqual({
      container: 'top',
      index: 2,
    })
    // A loose field steps into the neighbouring section, at the near end.
    expect(keyboardTarget(fields, lists, { container: 'top', index: 0 }, 1)).toEqual({
      container: 'section:2',
      index: 0,
    })
    expect(keyboardTarget(fields, lists, { container: 'top', index: 2 }, -1)).toEqual({
      container: 'section:2',
      index: 2,
    })
  })

  it('stops at the ends', () => {
    expect(keyboardTarget(fields, lists, { container: 'top', index: 0 }, -1)).toBeNull()
    expect(keyboardTarget(fields, lists, { container: 'login', index: 0 }, 1)).toBeNull()
  })
})
