import { describe, expect, it } from 'vitest'

import {
  type AvailabilityEntry,
  type AvailabilityGridOptions,
  availabilityHoursByLevel,
  buildAvailabilityGrid,
  cellsInRectangle,
  defaultFallback,
  effectiveAvailability,
  effectiveAvailabilityOnDate,
  gridToEntries,
  isAssignable,
  mostRestrictive,
  paintCells,
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

  it('breaks the declared hours down by level for the legend', () => {
    expect(availabilityHoursByLevel(MONDAY_MORNING)).toEqual({
      preferred: 4,
      available: 6,
      avoid: 2,
      unavailable: 0,
    })
  })
})

describe('the editor grid', () => {
  const options: AvailabilityGridOptions = {
    dayStart: '08:00',
    dayEnd: '10:00',
    slotMinutes: 60,
    weekdays: [1, 2],
  }

  it('renders one cell per weekday and slot, defaulting to unavailable', () => {
    const grid = buildAvailabilityGrid(options, MONDAY_MORNING)

    expect(grid.slots).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '09:00', end: '10:00' },
    ])
    expect(grid.rows.map((row) => row.cells.map((cell) => cell.level))).toEqual([
      ['preferred', 'preferred'],
      ['available', 'available'],
    ])
    expect(
      buildAvailabilityGrid({ ...options, weekdays: [3] }, MONDAY_MORNING).rows[0]?.cells,
    ).toEqual([
      { weekday: 3, start: '08:00', end: '09:00', level: 'unavailable' },
      { weekday: 3, start: '09:00', end: '10:00', level: 'unavailable' },
    ])
  })

  it('shows the most restrictive level of a slot the entries only half cover', () => {
    // 11:00–12:00 is preferred, 12:00–13:00 is avoid: the two-hour slot is avoid.
    const grid = buildAvailabilityGrid(
      { dayStart: '11:00', dayEnd: '13:00', slotMinutes: 120, weekdays: [1] },
      MONDAY_MORNING,
    )
    expect(grid.rows[0]?.cells[0]?.level).toBe('avoid')
  })

  it('paints the rectangle spanned by two corners, in any drag direction', () => {
    const grid = buildAvailabilityGrid(options)
    const forwards = cellsInRectangle(
      grid,
      { weekday: 1, start: '08:00' },
      { weekday: 2, start: '09:00' },
    )
    const backwards = cellsInRectangle(
      grid,
      { weekday: 2, start: '09:00' },
      { weekday: 1, start: '08:00' },
    )

    expect(forwards).toHaveLength(4)
    expect(backwards).toEqual(forwards)
    expect(
      cellsInRectangle(grid, { weekday: 1, start: '08:00' }, { weekday: 7, start: '08:00' }),
    ).toEqual([])
  })

  it('leaves the grid it painted from untouched', () => {
    const grid = buildAvailabilityGrid(options)
    const painted = paintCells(grid, [{ weekday: 1, start: '08:00' }], 'preferred')

    expect(painted.rows[0]?.cells[0]?.level).toBe('preferred')
    // An empty grid starts available: nobody has been asked yet.
    expect(grid.rows[0]?.cells[0]?.level).toBe('available')
    expect(paintCells(grid, [], 'preferred')).toBe(grid)
  })

  it('merges consecutive slots of the same level back into intervals', () => {
    const grid = buildAvailabilityGrid({
      dayStart: '08:00',
      dayEnd: '12:00',
      slotMinutes: 60,
      weekdays: [1],
    })
    const painted = paintCells(
      grid,
      [
        { weekday: 1, start: '08:00' },
        { weekday: 1, start: '09:00' },
        { weekday: 1, start: '11:00' },
      ],
      'preferred',
    )

    // Four painted half-days must not become four rows. The gap at 10:00 is
    // written out rather than dropped: saying nothing at all now means
    // available, so an unstated hour inside a stated week would invert.
    expect(gridToEntries(painted)).toEqual([
      { weekday: 1, startTime: '08:00', endTime: '10:00', level: 'preferred' },
      { weekday: 1, startTime: '10:00', endTime: '11:00', level: 'available' },
      { weekday: 1, startTime: '11:00', endTime: '12:00', level: 'preferred' },
    ])
  })

  it('splits the intervals where the level changes', () => {
    const grid = paintCells(
      paintCells(
        buildAvailabilityGrid({
          dayStart: '08:00',
          dayEnd: '11:00',
          slotMinutes: 60,
          weekdays: [1],
        }),
        [
          { weekday: 1, start: '08:00' },
          { weekday: 1, start: '09:00' },
        ],
        'available',
      ),
      [{ weekday: 1, start: '10:00' }],
      'avoid',
    )

    expect(gridToEntries(grid)).toEqual([
      { weekday: 1, startTime: '08:00', endTime: '10:00', level: 'available' },
      { weekday: 1, startTime: '10:00', endTime: '11:00', level: 'avoid' },
    ])
  })

  it('can still leave one level unstored, when a caller knows it is the default', () => {
    const grid = buildAvailabilityGrid({
      dayStart: '08:00',
      dayEnd: '09:00',
      slotMinutes: 60,
      weekdays: [1],
    })

    expect(gridToEntries(grid)).toEqual([
      { weekday: 1, startTime: '08:00', endTime: '09:00', level: 'available' },
    ])
    expect(gridToEntries(grid, { omitLevel: 'available' })).toEqual([])
  })

  it('survives the round trip: entries → grid → entries', () => {
    const entries: AvailabilityEntry[] = [
      { weekday: 1, startTime: '08:00', endTime: '12:00', level: 'preferred' },
      { weekday: 2, startTime: '15:00', endTime: '18:00', level: 'avoid' },
    ]
    const grid = buildAvailabilityGrid(
      { dayStart: '08:00', dayEnd: '20:00', slotMinutes: 30, weekdays: [1, 2] },
      entries,
    )

    // What was stated comes back, and the hours around it come back as the
    // refusal they are: this teacher has spoken, so the gaps are not consent.
    expect(gridToEntries(grid)).toEqual([
      { weekday: 1, startTime: '08:00', endTime: '12:00', level: 'preferred' },
      { weekday: 1, startTime: '12:00', endTime: '20:00', level: 'unavailable' },
      { weekday: 2, startTime: '08:00', endTime: '15:00', level: 'unavailable' },
      { weekday: 2, startTime: '15:00', endTime: '18:00', level: 'avoid' },
      { weekday: 2, startTime: '18:00', endTime: '20:00', level: 'unavailable' },
    ])
  })
})

/**
 * What silence means, and when.
 *
 * A teacher who has never opened the screen has not withheld anything — they
 * have not been asked. Treating that as a refusal painted every new teacher's
 * week red and made them unplannable, which is not what "no availability
 * recorded" ought to mean.
 */
describe('a teacher who has said nothing', () => {
  it('is available, rather than refused', () => {
    expect(defaultFallback([])).toBe('available')
    expect(effectiveAvailability({ weekday: 1, start: '09:00', end: '11:00' }, [])).toBe(
      'available',
    )
  })

  it('is not, once they have said something about their week', () => {
    const entries: AvailabilityEntry[] = [
      { weekday: 1, startTime: '09:00', endTime: '11:00', level: 'available' },
    ]

    expect(defaultFallback(entries)).toBe('unavailable')
    // The hour they left out of what they said is not consent.
    expect(effectiveAvailability({ weekday: 2, start: '09:00', end: '11:00' }, entries)).toBe(
      'unavailable',
    )
  })

  it('keeps a week painted entirely red, instead of reading it back as free', () => {
    const grid = buildAvailabilityGrid(
      { dayStart: '09:00', dayEnd: '11:00', slotMinutes: 60, weekdays: [1] },
      [],
    )
    const allRed = {
      ...grid,
      rows: grid.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({ ...cell, level: 'unavailable' as const })),
      })),
    }

    const entries = gridToEntries(allRed)

    // Dropping these rows as "the same as saying nothing" would invert them:
    // saying nothing now means available.
    expect(entries.length).toBeGreaterThan(0)
    expect(effectiveAvailability({ weekday: 1, start: '09:00', end: '10:00' }, entries)).toBe(
      'unavailable',
    )
  })
})
