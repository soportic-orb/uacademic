import { describe, expect, it } from 'vitest'

import {
  InvalidClockTimeError,
  contains,
  dateRangesOverlap,
  durationHours,
  durationMinutes,
  fromMinutes,
  isClockTime,
  isValidInterval,
  isWeekday,
  isoWeekday,
  mergeIntervals,
  overlapMinutes,
  overlaps,
  slotsBetween,
  sumHours,
  toMinutes,
} from '../src/domain/time.js'

describe('clock times', () => {
  it('accepts 24-hour HH:MM and rejects everything else', () => {
    expect(isClockTime('00:00')).toBe(true)
    expect(isClockTime('23:59')).toBe(true)
    expect(isClockTime('9:30')).toBe(false)
    expect(isClockTime('24:00')).toBe(false)
    expect(isClockTime('12:60')).toBe(false)
    expect(isClockTime(930)).toBe(false)
  })

  it('converts to and from minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('08:30')).toBe(510)
    expect(toMinutes('23:59')).toBe(1439)
    expect(fromMinutes(510)).toBe('08:30')
    expect(fromMinutes(0)).toBe('00:00')
    expect(fromMinutes(1440)).toBe('24:00')
  })

  it('throws on malformed input instead of silently coercing', () => {
    expect(() => toMinutes('8:30')).toThrow(InvalidClockTimeError)
    expect(() => fromMinutes(-1)).toThrow(RangeError)
    expect(() => fromMinutes(1441)).toThrow(RangeError)
  })
})

describe('intervals', () => {
  it('measures duration in minutes and decimal hours', () => {
    expect(durationMinutes({ start: '09:00', end: '10:30' })).toBe(90)
    expect(durationHours({ start: '09:00', end: '10:30' })).toBe(1.5)
    expect(durationHours({ start: '09:00', end: '09:50' })).toBe(0.83)
  })

  it('rejects zero-length and inverted intervals', () => {
    expect(isValidInterval({ start: '09:00', end: '10:00' })).toBe(true)
    expect(isValidInterval({ start: '09:00', end: '09:00' })).toBe(false)
    expect(isValidInterval({ start: '10:00', end: '09:00' })).toBe(false)
    expect(isValidInterval({ start: '10:00', end: 'noon' })).toBe(false)
  })

  it('treats touching endpoints as no overlap', () => {
    const morning = { start: '09:00', end: '10:00' }
    const next = { start: '10:00', end: '11:00' }
    expect(overlaps(morning, next)).toBe(false)
    expect(overlapMinutes(morning, next)).toBe(0)
  })

  it('measures partial and nested overlaps', () => {
    expect(overlapMinutes({ start: '09:00', end: '10:00' }, { start: '09:30', end: '11:00' })).toBe(
      30,
    )
    expect(overlapMinutes({ start: '09:00', end: '12:00' }, { start: '10:00', end: '11:00' })).toBe(
      60,
    )
    expect(contains({ start: '09:00', end: '12:00' }, { start: '10:00', end: '11:00' })).toBe(true)
    expect(contains({ start: '10:00', end: '11:00' }, { start: '09:00', end: '12:00' })).toBe(false)
  })

  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { start: '09:00', end: '10:00' },
        { start: '10:00', end: '11:00' },
        { start: '13:00', end: '14:00' },
        { start: '13:30', end: '15:00' },
      ]),
    ).toEqual([
      { start: '09:00', end: '11:00' },
      { start: '13:00', end: '15:00' },
    ])
    expect(mergeIntervals([])).toEqual([])
  })

  it('splits a day into slots, dropping the trailing partial one', () => {
    expect(slotsBetween('09:00', '10:30', 30)).toHaveLength(3)
    expect(slotsBetween('09:00', '10:20', 30)).toEqual([
      { start: '09:00', end: '09:30' },
      { start: '09:30', end: '10:00' },
    ])
    expect(() => slotsBetween('09:00', '10:00', 0)).toThrow(RangeError)
  })
})

describe('dates', () => {
  it('overlaps date ranges inclusively on both ends', () => {
    const first = { from: new Date('2026-09-01'), to: new Date('2026-12-20') }
    const touching = { from: new Date('2026-12-20'), to: new Date('2027-01-31') }
    const after = { from: new Date('2026-12-21'), to: new Date('2027-01-31') }
    expect(dateRangesOverlap(first, touching)).toBe(true)
    expect(dateRangesOverlap(first, after)).toBe(false)
  })

  it('reports ISO weekdays with Monday as 1', () => {
    expect(isoWeekday(new Date('2026-08-17'))).toBe(1)
    expect(isoWeekday(new Date('2026-08-23'))).toBe(7)
    expect(isWeekday(1)).toBe(true)
    expect(isWeekday(0)).toBe(false)
    expect(isWeekday(8)).toBe(false)
  })
})

describe('hour arithmetic', () => {
  it('sums without floating-point drift', () => {
    expect(sumHours([0.1, 0.2])).toBe(0.3)
    expect(sumHours([1.005, 2.005])).toBe(3.01)
    expect(sumHours([])).toBe(0)
  })
})
