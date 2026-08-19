import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_TIMEZONE,
  displayTimezoneName,
  formatBytes,
  formatDate,
  formatHours,
  formatPercent,
  formatTime,
  formatTimeRange,
  formatWeekday,
  setDisplayTimezone,
  weekdayNames,
} from '../src/domain/format.js'

describe('hour and percentage formatting', () => {
  it('always shows two decimals, with the locale separator', () => {
    expect(formatHours('es', 18)).toBe('18,00')
    expect(formatHours('ca', 18.5)).toBe('18,50')
    expect(formatHours('en', 1234.5)).toBe('1,234.50')
  })

  it('renders an undefined ratio as a dash instead of NaN', () => {
    expect(formatPercent('en', null)).toBe('—')
    expect(formatPercent('en', 91.67)).toBe('92%')
    expect(formatPercent('en', 91.67, 1)).toBe('91.7%')
  })
})

describe('storage figures', () => {
  it('speaks in megabytes, because that is how a quota is discussed', () => {
    expect(formatBytes('en', 2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatBytes('en', 512 * 1024 * 1024)).toBe('512 MB')
  })
})

describe('weekdays', () => {
  it('starts the week on Monday in every language', () => {
    expect(weekdayNames('en').map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(formatWeekday('en', 1)).toBe('Monday')
    expect(formatWeekday('en', 7)).toBe('Sunday')
    expect(formatWeekday('es', 1).toLowerCase()).toContain('lunes')
    expect(formatWeekday('ca', 1).toLowerCase()).toContain('dilluns')
  })
})

describe('clock times', () => {
  it('formats stored times without timezone conversion', () => {
    expect(formatTime('ca', '09:30')).toBe('09:30')
    expect(formatTime('en', '17:00')).toBe('17:00')
    expect(formatTimeRange('es', '09:00', '10:30')).toBe('09:00–10:30')
  })
})

describe('the zone instants are read in', () => {
  afterEach(() => {
    setDisplayTimezone(DEFAULT_TIMEZONE)
  })

  /**
   * A timestamp is an instant, and printing it in UTC showed every Spanish
   * user a time one or two hours before the one they lived through.
   */
  it('shows a timestamp on peninsular time by default', () => {
    const instant = new Date('2026-08-19T21:30:00Z')

    expect(formatDate('ca', instant, { hour: '2-digit', minute: '2-digit' })).toBe('23:30')
  })

  it('leaves a calendar date on its own day', () => {
    expect(formatDate('en', new Date('2026-09-01'), { dateStyle: 'short' })).toBe('01/09/2026')
  })

  it('follows a center that keeps its own zone', () => {
    setDisplayTimezone('Atlantic/Canary')
    const instant = new Date('2026-08-19T21:30:00Z')

    expect(formatDate('ca', instant, { hour: '2-digit', minute: '2-digit' })).toBe('22:30')
  })

  it('falls back to the platform zone when a center names none', () => {
    setDisplayTimezone('')

    expect(displayTimezoneName()).toBe(DEFAULT_TIMEZONE)
  })
})
