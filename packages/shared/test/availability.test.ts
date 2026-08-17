import { describe, expect, it } from 'vitest'

import {
  type AvailabilityEntry,
  effectiveAvailability,
  effectiveAvailabilityOnDate,
  isAssignable,
  mostRestrictive,
  weeklyAvailableHours,
} from '../src/domain/availability.js'

const MONDAY_MORNING: AvailabilityEntry[] = [
  { weekday: 1, startTime: '08:00', endTime: '12:00', level: 'preferred' },
  { weekday: 1, startTime: '12:00', endTime: '14:00', level: 'avoid' },
  { weekday: 2, startTime: '08:00', endTime: '14:00', level: 'available' },
]

describe('effective availability', () => {
  it('returns the level of a fully covered slot', () => {
    expect(
      effectiveAvailability({ weekday: 1, start: '09:00', end: '10:00' }, MONDAY_MORNING),
    ).toBe('preferred')
  })

  it('takes the most restrictive level when a slot spans two windows', () => {
    expect(
      effectiveAvailability({ weekday: 1, start: '11:00', end: '13:00' }, MONDAY_MORNING),
    ).toBe('avoid')
  })

  it('treats uncovered time as unavailable by default', () => {
    expect(
      effectiveAvailability({ weekday: 1, start: '13:00', end: '15:00' }, MONDAY_MORNING),
    ).toBe('unavailable')
    expect(
      effectiveAvailability({ weekday: 3, start: '09:00', end: '10:00' }, MONDAY_MORNING),
    ).toBe('unavailable')
  })

  it('honours an explicit fallback for centers that opt into open availability', () => {
    expect(
      effectiveAvailability({ weekday: 3, start: '09:00', end: '10:00' }, MONDAY_MORNING, {
        fallback: 'available',
      }),
    ).toBe('available')
  })

  it('ranks levels from least to most restrictive', () => {
    expect(mostRestrictive('preferred', 'available')).toBe('available')
    expect(mostRestrictive('avoid', 'unavailable')).toBe('unavailable')
    expect(mostRestrictive('available', undefined)).toBe('available')
    expect(isAssignable('avoid')).toBe(true)
    expect(isAssignable('unavailable')).toBe(false)
  })
})

describe('dated exceptions', () => {
  const entries: AvailabilityEntry[] = [
    { weekday: 1, startTime: '08:00', endTime: '14:00', level: 'available' },
  ]

  it('overrides the weekly pattern when more restrictive', () => {
    const level = effectiveAvailabilityOnDate(
      new Date('2026-09-14'),
      { start: '09:00', end: '10:00' },
      entries,
      [{ dateFrom: new Date('2026-09-14'), dateTo: new Date('2026-09-18'), level: 'unavailable' }],
    )
    expect(level).toBe('unavailable')
  })

  it('leaves dates outside the exception untouched', () => {
    const level = effectiveAvailabilityOnDate(
      new Date('2026-09-21'),
      { start: '09:00', end: '10:00' },
      entries,
      [{ dateFrom: new Date('2026-09-14'), dateTo: new Date('2026-09-18'), level: 'unavailable' }],
    )
    expect(level).toBe('available')
  })

  it('never relaxes the weekly pattern', () => {
    const level = effectiveAvailabilityOnDate(
      new Date('2026-09-14'),
      { start: '15:00', end: '16:00' },
      entries,
      [{ dateFrom: new Date('2026-09-14'), dateTo: new Date('2026-09-14'), level: 'preferred' }],
    )
    expect(level).toBe('unavailable')
  })
})

describe('weekly availability', () => {
  it('counts only the levels that can be planned', () => {
    expect(weeklyAvailableHours(MONDAY_MORNING)).toBe(10)
    expect(weeklyAvailableHours(MONDAY_MORNING, ['preferred'])).toBe(4)
    expect(weeklyAvailableHours(MONDAY_MORNING, ['preferred', 'available', 'avoid'])).toBe(12)
  })
})
