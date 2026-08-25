/**
 * The days a center types once and expects to see in every calendar after
 * that. The failures here are quiet ones: a holiday on the wrong date, or a
 * leap day invented in a year that has none.
 */
import { describe, expect, it } from 'vitest'

import { carryYearly, shiftYears } from '../src/domain/yearly-calendar.js'

describe('the same day, a year later', () => {
  it('keeps the day and the month', () => {
    expect(shiftYears('2026-12-25', 1)).toBe('2027-12-25')
    expect(shiftYears('2026-04-23', 2)).toBe('2028-04-23')
  })

  it('has no answer for a leap day in a year without one', () => {
    expect(shiftYears('2028-02-29', 1)).toBeNull()
    // And it does survive to the next leap year.
    expect(shiftYears('2028-02-29', 4)).toBe('2032-02-29')
  })

  it('says nothing rather than guessing at a date it cannot read', () => {
    expect(shiftYears('not a date', 1)).toBeNull()
  })
})

describe('carrying a calendar into the next year', () => {
  const year = { from: '2027-09-01', to: '2028-07-31' }

  const entry = (dateFrom: string, dateTo = dateFrom) => ({ dateFrom, dateTo, name: dateFrom })

  it('moves each day onto its date in the new year', () => {
    const carried = carryYearly([entry('2026-12-25'), entry('2027-04-23')], 1, year)

    expect(carried.map((item) => item.dateFrom)).toEqual(['2027-12-25', '2028-04-23'])
    // Everything else about the entry travels with it.
    expect(carried[0]?.name).toBe('2026-12-25')
  })

  it('carries a closure of several days as the period it is', () => {
    const carried = carryYearly([entry('2026-12-24', '2027-01-06')], 1, year)

    expect(carried[0]).toMatchObject({ dateFrom: '2027-12-24', dateTo: '2028-01-06' })
  })

  it('leaves behind what would land outside the year being opened', () => {
    // August falls in the gap between one academic year and the next.
    expect(carryYearly([entry('2026-08-15')], 1, year)).toEqual([])
  })

  it('leaves behind a leap day the new year does not have', () => {
    expect(carryYearly([entry('2028-02-29')], 1, { from: '2028-09-01', to: '2029-07-31' })).toEqual(
      [],
    )
  })
})
