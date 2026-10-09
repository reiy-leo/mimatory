export type RelativeTimeUnit = 'day' | 'hour' | 'minute' | 'second'

export type ItemTimestamp =
  | { date: Date; includeYear: boolean; kind: 'absolute' }
  | { kind: 'relative'; unit: RelativeTimeUnit; value: number }

const minuteMs = 60_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
// Past a week the calendar says more than a count does: "3 days ago" and "22 Oct" are both useful,
// "214 days ago" is not.
const relativeDayLimit = 7

export function describeItemTimestamp(updatedAt: string, now: Date = new Date()): ItemTimestamp | null {
  const updated = new Date(updatedAt)
  if (Number.isNaN(updated.getTime())) return null
  // A timestamp ahead of this machine (clock skew, a vault written elsewhere) must not read as a
  // future edit, so the elapsed span is floored at zero.
  const elapsed = Math.max(0, now.getTime() - updated.getTime())
  if (elapsed < minuteMs) return { kind: 'relative', unit: 'second', value: -Math.max(1, Math.floor(elapsed / 1000)) }
  if (elapsed < hourMs) return { kind: 'relative', unit: 'minute', value: -Math.floor(elapsed / minuteMs) }
  if (elapsed < dayMs) return { kind: 'relative', unit: 'hour', value: -Math.floor(elapsed / hourMs) }
  if (elapsed < relativeDayLimit * dayMs) return { kind: 'relative', unit: 'day', value: -Math.floor(elapsed / dayMs) }
  return { date: updated, includeYear: updated.getFullYear() !== now.getFullYear(), kind: 'absolute' }
}

export function formatItemTimestamp(updatedAt: string, locale: string, now: Date = new Date()): string {
  const stamp = describeItemTimestamp(updatedAt, now)
  if (!stamp) return ''
  if (stamp.kind === 'absolute') {
    return stamp.includeYear
      ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(stamp.date)
      : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(stamp.date)
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(stamp.value, stamp.unit)
}
