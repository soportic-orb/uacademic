/**
 * A month as a grid of weeks, for printing a timetable one month per page.
 *
 * The arithmetic is here rather than in the PDF writer because it is the part
 * that can be wrong in ways nobody notices until a teacher is standing in an
 * empty room: a month that starts on a Sunday, a fortnight that spans a year
 * boundary, a week beginning on the wrong day. Weeks start on Monday
 * (CLAUDE.md §5).
 */

export interface MonthKey {
  year: number
  /** 1–12, as people say it, not as `Date` counts it. */
  month: number
}

/** Every month touched by the range, in order, ends included. */
export function monthsBetween(from: string, to: string): MonthKey[] {
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number]
  const [toYear, toMonth] = to.split('-').map(Number) as [number, number]

  const months: MonthKey[] = []
  let year = fromYear
  let month = fromMonth

  // Guarded rather than `while (true)`: a reversed range would otherwise spin
  // for as long as the process lives.
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push({ year, month })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return months
}

/**
 * The weeks of a month, each seven ISO dates from Monday.
 *
 * Days from the neighbouring months fill the first and last rows, so a page is
 * always a rectangle — a calendar with a ragged edge is one somebody has to
 * count along to read.
 */
export function weeksOfMonth(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  // `getUTCDay` is 0 on Sunday; Monday-first means Sunday is the seventh day.
  const offset = (first.getUTCDay() + 6) % 7

  const cursor = new Date(first.getTime())
  cursor.setUTCDate(cursor.getUTCDate() - offset)

  const weeks: string[][] = []
  while (true) {
    const week: string[] = []
    for (let day = 0; day < 7; day += 1) {
      week.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)

    // Stop once the row just written has carried us past the month.
    const next = new Date(cursor.getTime())
    if (next.getUTCMonth() !== month - 1 || next.getUTCFullYear() !== year) break
  }

  return weeks
}

/**
 * The weeks a range covers, each seven ISO dates from Monday.
 *
 * For printing what is on screen when that is a week rather than a month: the
 * page is the same rectangle, one row of it.
 */
export function weeksBetween(from: string, to: string): string[][] {
  const first = new Date(`${from}T00:00:00Z`)
  const last = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || last < first) return []

  const cursor = new Date(first.getTime())
  cursor.setUTCDate(cursor.getUTCDate() - ((first.getUTCDay() + 6) % 7))

  const weeks: string[][] = []
  // A year of weeks is more than any view prints; the guard is against a range
  // somebody typed wrong, not against a real one.
  while (cursor.getTime() <= last.getTime() && weeks.length < 60) {
    const week: string[] = []
    for (let day = 0; day < 7; day += 1) {
      week.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }

  return weeks
}

/** Whether an ISO date belongs to the month being drawn, or is filler. */
export function isInMonth(date: string, year: number, month: number): boolean {
  return date.startsWith(`${year}-${String(month).padStart(2, '0')}`)
}
