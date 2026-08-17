import { describe, expect, it } from 'vitest'

import {
  formatHours,
  formatPercent,
  formatTime,
  formatTimeRange,
  formatWeekday,
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
