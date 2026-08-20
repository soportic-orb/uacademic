import { describe, expect, it } from 'vitest'

import { isInMonth, monthsBetween, weeksOfMonth } from '../src/domain/month-grid.js'

/**
 * A month per page, printed and handed to somebody who will stand in a room at
 * the time it says. The failures here are the quiet kind: a month that starts
 * on a Sunday, a range that crosses a year, a week that begins on the wrong
 * day — none of which looks wrong until the day itself.
 */
describe('the months a range covers', () => {
  it('includes both ends', () => {
    expect(monthsBetween('2026-09-14', '2026-11-02')).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
    ])
  })

  it('crosses the turn of the year', () => {
    expect(monthsBetween('2026-11-20', '2027-02-03')).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ])
  })

  it('is one page for a range inside a single month', () => {
    expect(monthsBetween('2026-09-07', '2026-09-11')).toEqual([{ year: 2026, month: 9 }])
  })

  it('gives nothing back for a range that runs backwards', () => {
    expect(monthsBetween('2026-11-01', '2026-09-01')).toEqual([])
  })
})

describe('the weeks of a month', () => {
  it('starts every row on a Monday', () => {
    for (const week of weeksOfMonth(2026, 11)) {
      const first = new Date(`${week[0]}T00:00:00Z`)
      expect(first.getUTCDay()).toBe(1)
      expect(week).toHaveLength(7)
    }
  })

  it('fills the edges from the neighbouring months, so the page is a rectangle', () => {
    // November 2026 starts on a Sunday: the first row is almost all October.
    const weeks = weeksOfMonth(2026, 11)

    expect(weeks[0]?.[0]).toBe('2026-10-26')
    expect(weeks[0]?.[6]).toBe('2026-11-01')
    expect(isInMonth('2026-10-26', 2026, 11)).toBe(false)
    expect(isInMonth('2026-11-01', 2026, 11)).toBe(true)
  })

  it('covers the whole month and stops', () => {
    const weeks = weeksOfMonth(2027, 2)
    const days = weeks.flat()

    expect(days).toContain('2027-02-01')
    expect(days).toContain('2027-02-28')
    // February 2027 ends on a Sunday, so it needs no trailing March row.
    expect(weeks.at(-1)?.at(-1)).toBe('2027-02-28')
  })

  it('handles a month that begins on a Monday without an empty first row', () => {
    // June 2026 starts on a Monday.
    expect(weeksOfMonth(2026, 6)[0]?.[0]).toBe('2026-06-01')
  })

  it('handles a leap February', () => {
    expect(weeksOfMonth(2028, 2).flat()).toContain('2028-02-29')
  })
})
