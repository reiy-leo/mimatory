import { describe, expect, it } from 'vitest'
import { canShowLargeType, largeTypeCells, largeTypeKind } from './largeType'

describe('Show in Large Type', () => {
  it('numbers every character from one and classifies it', () => {
    expect(largeTypeCells('aB3$ x')).toEqual([
      { glyph: 'a', index: 1, kind: 'letter', value: 'a' },
      { glyph: 'B', index: 2, kind: 'letter', value: 'B' },
      { glyph: '3', index: 3, kind: 'digit', value: '3' },
      { glyph: '$', index: 4, kind: 'symbol', value: '$' },
      { glyph: '␣', index: 5, kind: 'space', value: ' ' },
      { glyph: 'x', index: 6, kind: 'letter', value: 'x' },
    ])
  })

  it('keeps a user-perceived character on one tile', () => {
    expect(largeTypeCells('👍🏽a')).toHaveLength(2)
    expect(largeTypeCells('密码9').map((cell) => cell.kind)).toEqual(['letter', 'letter', 'digit'])
  })

  it('treats punctuation and emoji as symbols', () => {
    expect(largeTypeKind('-')).toBe('symbol')
    expect(largeTypeKind('🙂')).toBe('symbol')
    expect(largeTypeKind('é')).toBe('letter')
  })

  it('offers itself only for one non-empty line of reasonable length', () => {
    expect(canShowLargeType('Tr0ub4dor&3')).toBe(true)
    expect(canShowLargeType('')).toBe(false)
    expect(canShowLargeType('line one\nline two')).toBe(false)
    expect(canShowLargeType('x'.repeat(257))).toBe(false)
  })
})
