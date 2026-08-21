import { describe, expect, it } from 'vitest'

import {
  type CalendarDayEntry,
  closureOn,
  closuresInRange,
  firstClassDate,
  isoDateOf,
  occursOn,
} from '../src/domain/schedule-calendar.js'

/**
 * The planner is a weekly template: a session on "Monday" repeats over every
 * Monday of the term, including the ones the center is shut. The engine skips
 * those days when it materialises the term; this is what lets the grid say so
 * while somebody is still deciding.
 */
const entries: CalendarDayEntry[] = [
  {
    dateFrom: '2026-12-24',
    dateTo: '2027-01-06',
    type: 'vacation',
    name: 'Nadal',
    isTeachingDay: false,
  },
  {
    dateFrom: '2026-11-01',
    dateTo: '2026-11-01',
    type: 'holiday',
    name: 'Tots Sants',
    isTeachingDay: false,
  },
  {
    dateFrom: '2027-01-12',
    dateTo: '2027-01-23',
    type: 'exam_period',
    name: 'Exàmens',
    // On the calendar, and classes still happen.
    isTeachingDay: true,
  },
]

describe('what the academic calendar says about a day', () => {
  it('closes every day of a period, ends included', () => {
    expect(closureOn('2026-12-24', entries)?.name).toBe('Nadal')
    expect(closureOn('2026-12-31', entries)?.name).toBe('Nadal')
    expect(closureOn('2027-01-06', entries)?.name).toBe('Nadal')
  })

  it('leaves the day after a period alone', () => {
    expect(closureOn('2027-01-07', entries)).toBeNull()
    expect(closureOn('2026-12-23', entries)).toBeNull()
  })

  it('closes a single day, whose ends are the same date', () => {
    expect(closureOn('2026-11-01', entries)?.name).toBe('Tots Sants')
  })

  it('does not close a period that teaches, however much it is on the calendar', () => {
    // An exam fortnight is not a holiday: the planner may place on it.
    expect(closureOn('2027-01-15', entries)).toBeNull()
  })

  it('reports a week in one pass, keyed by date', () => {
    const week = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']
    const found = closuresInRange(week, entries)

    expect(found.size).toBe(5)
    expect(found.get('2027-01-01')?.type).toBe('vacation')
  })

  it('reads a date from its local parts, not from UTC', () => {
    // 00:30 on the 1st is the 1st. `toISOString` would call it the 31st for
    // anybody east of Greenwich, which is the whole of this platform's users.
    expect(isoDateOf(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(isoDateOf(new Date(2026, 11, 25))).toBe('2026-12-25')
  })
})

describe('when a repeating class happens', () => {
  const weekly = {
    weekday: 3,
    dateFrom: '2026-09-14',
    dateTo: '2026-12-18',
    recurrence: 'weekly',
  } as const

  it('starts on the first matching weekday, not on the day the term opens', () => {
    // 14 September 2026 is a Monday; the class is on Wednesdays.
    expect(firstClassDate(weekly)).toBe('2026-09-16')
  })

  it('happens every week of the term and on no other day', () => {
    expect(occursOn(weekly, '2026-09-16')).toBe(true)
    expect(occursOn(weekly, '2026-09-23')).toBe(true)
    expect(occursOn(weekly, '2026-09-24')).toBe(false)
  })

  it('has not started before the term and has finished after it', () => {
    expect(occursOn(weekly, '2026-09-09')).toBe(false)
    expect(occursOn(weekly, '2026-12-23')).toBe(false)
  })

  it('skips alternate weeks when it is fortnightly', () => {
    const biweekly = { ...weekly, recurrence: 'biweekly' } as const

    expect(occursOn(biweekly, '2026-09-16')).toBe(true)
    expect(occursOn(biweekly, '2026-09-23')).toBe(false)
    expect(occursOn(biweekly, '2026-09-30')).toBe(true)
  })

  it('counts a fortnight from its own first class, so two of them alternate', () => {
    const first = { ...weekly, recurrence: 'biweekly' } as const
    const second = { ...first, dateFrom: '2026-09-21' } as const

    expect(occursOn(first, '2026-09-23')).toBe(false)
    expect(occursOn(second, '2026-09-23')).toBe(true)
  })

  it('happens exactly once when it is a one-off', () => {
    const once = { ...weekly, recurrence: 'once' } as const

    expect(occursOn(once, '2026-09-16')).toBe(true)
    expect(occursOn(once, '2026-09-23')).toBe(false)
  })

  it('reads the date in UTC, so a Sunday class is not a Saturday one', () => {
    const sunday = {
      weekday: 7,
      dateFrom: '2026-03-02',
      dateTo: '2026-06-30',
      recurrence: 'weekly',
    } as const

    expect(firstClassDate(sunday)).toBe('2026-03-08')
    expect(occursOn(sunday, '2026-03-08')).toBe(true)
    expect(occursOn(sunday, '2026-03-07')).toBe(false)
  })
})
