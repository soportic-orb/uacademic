import { describe, expect, it } from 'vitest'

import { addDays, dateOfWeekday, isoDate, mondayOf } from '../src/features/planner/week-dates'

/**
 * The week starts on Monday everywhere in this product (CLAUDE.md §5), and the
 * planner's columns are ISO weekdays — 1 is Monday, 7 is Sunday — while
 * JavaScript numbers Sunday as 0. Getting that wrong shifts a whole timetable
 * by a day for one seventh of the year, which is the kind of bug that is only
 * ever found on a Sunday.
 */
describe('the week a date belongs to', () => {
  it('walks back to Monday from any day of that week', () => {
    // 2026-08-20 is a Thursday.
    expect(isoDate(mondayOf(new Date(2026, 7, 20)))).toBe('2026-08-17')
    expect(isoDate(mondayOf(new Date(2026, 7, 17)))).toBe('2026-08-17')
  })

  it('treats Sunday as the end of the week that began six days earlier', () => {
    // 2026-08-23 is a Sunday: its week started on the 17th, not the 24th.
    expect(isoDate(mondayOf(new Date(2026, 7, 23)))).toBe('2026-08-17')
  })

  it('crosses a month boundary without losing a day', () => {
    // 2026-09-01 is a Tuesday; its Monday is in August.
    expect(isoDate(mondayOf(new Date(2026, 8, 1)))).toBe('2026-08-31')
  })

  it('maps each ISO weekday onto its date in that week', () => {
    const monday = mondayOf(new Date(2026, 7, 20))

    expect(isoDate(dateOfWeekday(monday, 1))).toBe('2026-08-17')
    expect(isoDate(dateOfWeekday(monday, 5))).toBe('2026-08-21')
    expect(isoDate(dateOfWeekday(monday, 7))).toBe('2026-08-23')
  })

  it('steps into the next month, and back out of it', () => {
    const week = mondayOf(new Date(2026, 7, 31))

    expect(isoDate(addDays(week, 7))).toBe('2026-09-07')
    expect(isoDate(addDays(week, -7))).toBe('2026-08-24')
  })

  it('formats the date without letting a timezone move it', () => {
    // Built from local parts and read back as local parts: going through
    // toISOString() here would shift the day for anybody west of Greenwich.
    expect(isoDate(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})
