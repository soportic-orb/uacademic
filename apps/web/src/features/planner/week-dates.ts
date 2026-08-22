/**
 * Dates for a weekly grid.
 *
 * A timetable repeats weekly, so the planner's columns are ISO weekdays rather
 * than dates — but which week is on screen still matters, and turning one into
 * the other is arithmetic that belongs somewhere testable rather than inside a
 * component.
 */
/**
 * The Monday of the week containing a date.
 *
 * The week starts on Monday everywhere in this product (CLAUDE.md §5), and the
 * planner's columns are ISO weekdays, so every date it works with is anchored
 * to one.
 */
export function mondayOf(date: Date): Date {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  // getDay() is 0 on Sunday; ISO counts it as the seventh day of the week that
  // started six days earlier, not the first of the one about to start.
  const isoWeekday = monday.getDay() === 0 ? 7 : monday.getDay()
  monday.setDate(monday.getDate() - (isoWeekday - 1))
  return monday
}

export function addDays(date: Date, days: number): Date {
  const moved = new Date(date)
  moved.setDate(moved.getDate() + days)
  return moved
}

/** The date an ISO weekday falls on, in the week starting at `weekStart`. */
export function dateOfWeekday(weekStart: Date, weekday: number): Date {
  return addDays(weekStart, weekday - 1)
}

export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function parseIsoDate(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

/**
 * The week the planner opens on.
 *
 * Today's, when today is inside the year being planned. Otherwise the first
 * week of it — because a coordinator planning next September in June would be
 * handed a week in which none of the classes they place exist, and would watch
 * each one vanish as it landed. The grid draws only what happens in the week
 * on screen, which makes "which week" a correctness question rather than a
 * convenience.
 */
export function openingWeek(range: { from: string; to: string } | undefined): Date {
  const today = mondayOf(new Date())
  if (!range) return today

  const start = parseIsoDate(range.from)
  const end = parseIsoDate(range.to)
  if (!start || !end) return today

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now >= start && now <= end ? today : mondayOf(start)
}
