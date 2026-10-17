/**
 * Show in Large Type, the 1Password way: every character on its own tile with its 1-based position under it,
 * so a value can be read aloud or typed on another device ("the 4th, 10th and 12th character"). Digits and
 * symbols are told apart from letters by colour *and* by the tile's position label being read out, never by
 * colour alone; spaces get a visible glyph because an empty tile reads as nothing.
 */

export type LargeTypeKind = 'digit' | 'letter' | 'space' | 'symbol'

export type LargeTypeCell = {
  /** What the tile draws: the character itself, or `␣` for whitespace. */
  glyph: string
  /** 1-based, as people count characters. */
  index: number
  kind: LargeTypeKind
  /** The character as stored. */
  value: string
}

/** Values longer than this are not worth a tile each (a private key, a long note); the menu leaves the action out. */
export const largeTypeMaxLength = 256

type GraphemeSegmenter = new (
  locale: undefined,
  options: { granularity: 'grapheme' },
) => { segment: (input: string) => Iterable<{ segment: string }> }

/** User-perceived characters (an emoji with a modifier is one tile); `Intl.Segmenter` is in every target webview. */
function graphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter
  if (Segmenter)
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (s) => s.segment)
  return Array.from(value)
}

export function largeTypeKind(character: string): LargeTypeKind {
  if (/^\s+$/u.test(character)) return 'space'
  if (/^\p{Nd}$/u.test(character)) return 'digit'
  if (/^\p{L}/u.test(character)) return 'letter'
  return 'symbol'
}

export function largeTypeCells(value: string): LargeTypeCell[] {
  return graphemes(value).map((character, position) => {
    const kind = largeTypeKind(character)
    return { glyph: kind === 'space' ? '␣' : character, index: position + 1, kind, value: character }
  })
}

/** A single line of text short enough for tiles; multi-line values (keys, notes, addresses) are left out. */
export function canShowLargeType(value: string): boolean {
  const length = graphemes(value).length
  return length > 0 && length <= largeTypeMaxLength && !value.includes('\n')
}
