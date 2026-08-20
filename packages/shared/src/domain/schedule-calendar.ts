/**
 * What the academic calendar says about a given day.
 *
 * The planner works on a weekly template, so a session placed on "Monday"
 * repeats over every Monday of the term — including the ones the center is
 * shut. The engine already skips those days when it materialises the term;
 * what was missing was saying so on the grid, where somebody is deciding.
 */
export interface CalendarDayEntry {
  /** Inclusive, `YYYY-MM-DD`. */
  dateFrom: string
  /** Inclusive. Equal to `dateFrom` for a single day. */
  dateTo: string
  type: string
  name: string
  /**
   * Whether classes happen. An exam period is on the calendar and is a
   * teaching day; a holiday is not.
   */
  isTeachingDay: boolean
}

/**
 * The entry that closes a date, or null when classes run.
 *
 * The first match wins rather than the most specific: a date covered by two
 * closures is closed once, and which of the two named it does not change what
 * a coordinator does about it.
 */
export function closureOn(
  date: string,
  entries: readonly CalendarDayEntry[],
): CalendarDayEntry | null {
  return (
    entries.find(
      (entry) => !entry.isTeachingDay && entry.dateFrom <= date && date <= entry.dateTo,
    ) ?? null
  )
}

/** Every closure across a week, keyed by ISO date. */
export function closuresInRange(
  dates: readonly string[],
  entries: readonly CalendarDayEntry[],
): Map<string, CalendarDayEntry> {
  const found = new Map<string, CalendarDayEntry>()
  for (const date of dates) {
    const closure = closureOn(date, entries)
    if (closure) found.set(date, closure)
  }
  return found
}

/** `YYYY-MM-DD` from the local parts, not from `toISOString`, which is UTC. */
export function isoDateOf(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
