/**
 * The days that come round every year.
 *
 * A patron saint, Sant Jordi, the closure between Christmas and Epiphany: a
 * center types them once and expects them in every calendar after that. This
 * is the arithmetic of carrying them over — which year a date moves to, and
 * which entries belong to the year being opened — kept here with tests (R7)
 * because a holiday quietly landing on the wrong date is the kind of mistake
 * nobody notices until somebody is standing in front of a locked building.
 */

export interface YearlyEntry {
  /** `YYYY-MM-DD`. */
  dateFrom: string
  dateTo: string
}

/**
 * The same day, so many years later.
 *
 * Null for a 29th of February moving to a year that has no 29th of February:
 * a leap day does not happen that year, and inventing the 28th or the 1st
 * would be putting a holiday on a day nobody declared one.
 */
export function shiftYears(date: string, years: number): string | null {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return null

  const moved = new Date(Date.UTC(year + years, month - 1, day))
  // `Date` rolls a 29th of February into the 1st of March rather than
  // refusing, so the check is that the day survived the move.
  if (moved.getUTCDate() !== day || moved.getUTCMonth() !== month - 1) return null

  return moved.toISOString().slice(0, 10)
}

/**
 * The entries to copy into a year, already moved onto their new dates.
 *
 * Anything that lands outside the year being opened is left behind: an
 * academic year runs from one September to the next July, and a day that falls
 * in the gap belongs to no calendar at all.
 */
export function carryYearly<T extends YearlyEntry>(
  entries: readonly T[],
  years: number,
  within: { from: string; to: string },
): T[] {
  const carried: T[] = []

  for (const entry of entries) {
    const dateFrom = shiftYears(entry.dateFrom, years)
    const dateTo = shiftYears(entry.dateTo, years)
    if (!dateFrom || !dateTo) continue
    if (dateTo < within.from || dateFrom > within.to) continue

    carried.push({ ...entry, dateFrom, dateTo })
  }

  return carried
}
