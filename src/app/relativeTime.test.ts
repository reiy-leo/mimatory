import { describe, expect, it } from 'vitest'
import { describeItemTimestamp, formatItemTimestamp } from './relativeTime'

const now = new Date('2026-10-09T12:00:00Z')

function atSeconds(secondsAgo: number): string {
  return new Date(now.getTime() - secondsAgo * 1000).toISOString()
}

describe('item timestamps', () => {
  it('keeps an edit from the last minute inside seconds', () => {
    expect(describeItemTimestamp(atSeconds(40), now)).toEqual({ kind: 'relative', unit: 'second', value: -40 })
  })

  it('steps through minutes, hours and days on whole units', () => {
    expect(describeItemTimestamp(atSeconds(150), now)).toEqual({ kind: 'relative', unit: 'minute', value: -2 })
    expect(describeItemTimestamp(atSeconds(7_200), now)).toEqual({ kind: 'relative', unit: 'hour', value: -2 })
    expect(describeItemTimestamp(atSeconds(3 * 86_400), now)).toEqual({ kind: 'relative', unit: 'day', value: -3 })
  })

  it('switches to a calendar date past a week', () => {
    const stamp = describeItemTimestamp(atSeconds(8 * 86_400), now)
    expect(stamp?.kind).toBe('absolute')
  })

  it('never reads a timestamp ahead of this clock as a future edit', () => {
    expect(describeItemTimestamp(atSeconds(-600), now)).toEqual({ kind: 'relative', unit: 'second', value: -1 })
  })

  it('drops an unparseable timestamp instead of rendering Invalid Date', () => {
    expect(describeItemTimestamp('', now)).toBeNull()
    expect(formatItemTimestamp('', 'en', now)).toBe('')
  })

  it('formats relative units in the interface language', () => {
    expect(formatItemTimestamp(atSeconds(120), 'en', now)).toBe('2 minutes ago')
    expect(formatItemTimestamp(atSeconds(86_400 * 2), 'en', now)).toBe('2 days ago')
  })

  it('says yesterday for the day before rather than a count', () => {
    expect(formatItemTimestamp(atSeconds(86_400), 'en', now)).toBe('yesterday')
  })

  it('adds the year only once the date has left the current year', () => {
    const sameYear = atSeconds(30 * 86_400)
    const otherYear = atSeconds(500 * 86_400)
    expect(formatItemTimestamp(sameYear, 'en', now)).toBe(
      new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(sameYear)),
    )
    expect(formatItemTimestamp(otherYear, 'en', now)).toContain('2025')
  })
})
