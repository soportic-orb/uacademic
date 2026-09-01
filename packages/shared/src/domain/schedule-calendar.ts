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

/**
 * A class slot as the planner stores it: a weekday and a time, repeated
 * between two dates rather than written out one occurrence at a time.
 */
export interface RecurringSlot {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number
  /** Inclusive, `YYYY-MM-DD`. */
  dateFrom: string
  /** Inclusive. */
  dateTo: string
  recurrence: 'weekly' | 'biweekly' | 'once'
}

/** Whole days since the epoch, from an ISO date, with no timezone in it. */
function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000)
}

/** 1 January 1970 — day zero — was a Thursday, which is ISO weekday 4. */
function weekdayOfDay(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1
}

/**
 * The first day the slot actually happens: `dateFrom` is the day the term
 * starts, which is rarely the weekday the class is on.
 */
export function firstClassDate(slot: RecurringSlot): string {
  const start = dayNumber(slot.dateFrom)
  const shift = (slot.weekday - weekdayOfDay(start) + 7) % 7
  // Read back in UTC: these day numbers are UTC midnights, and `isoDateOf`
  // reads local parts, which is a day out for anybody west of Greenwich.
  return new Date((start + shift) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Whether the slot falls on this date.
 *
 * A fortnightly class is counted from its own first occurrence rather than
 * from any calendar-wide notion of an odd week: two fortnightly classes that
 * started in different weeks alternate against each other, which is exactly
 * what the conflict rules already assume.
 */
export function occursOn(slot: RecurringSlot, date: string): boolean {
  const target = dayNumber(date)
  const first = dayNumber(firstClassDate(slot))

  if (target < first) return false
  if (slot.recurrence === 'once') return target === first
  if (target > dayNumber(slot.dateTo)) return false

  const weeks = (target - first) / 7
  if (!Number.isInteger(weeks)) return false
  return slot.recurrence === 'weekly' || weeks % 2 === 0
}

/**
 * How many times the slot happens between its own two dates.
 *
 * What a class costs a teacher's contract is the hours it takes over the
 * year, and the planner stores classes two ways: one row per date for the
 * ones a coordinator places by hand, and one repeating row per term for the
 * ones the generator lays out. Counting rows instead of occurrences reads a
 * generated timetable as a fourteenth of itself.
 *
 * Closures are not deducted: this is the shape of the term, and a holiday
 * removed from every teacher's contract equally is not what decides whether
 * one of them is over it.
 */
export function slotOccurrences(slot: RecurringSlot): number {
  if (slot.recurrence === 'once') return 1

  const first = dayNumber(firstClassDate(slot))
  const last = dayNumber(slot.dateTo)
  if (last < first) return 0

  const weeks = Math.floor((last - first) / 7)
  return slot.recurrence === 'weekly' ? weeks + 1 : Math.floor(weeks / 2) + 1
}
