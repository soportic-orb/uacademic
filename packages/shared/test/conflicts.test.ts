import { describe, expect, it } from 'vitest'

import {
  type SessionLike,
  detectSessionConflicts,
  findConflictsFor,
  occurrencesCanCollide,
} from '../src/domain/conflicts.js'

const TERM = { dateFrom: new Date('2026-09-14'), dateTo: new Date('2026-12-18') }

function session(overrides: Partial<SessionLike> & { id: string }): SessionLike {
  return {
    weekday: 1,
    startTime: '09:00',
    endTime: '11:00',
    teacherProfileId: null,
    spaceId: null,
    groupId: null,
    ...TERM,
    ...overrides,
  }
}

describe('resource conflicts', () => {
  it('detects a teacher booked twice at the same time', () => {
    const conflicts = detectSessionConflicts([
      session({ id: 'a', teacherProfileId: 't1' }),
      session({ id: 'b', teacherProfileId: 't1', startTime: '10:00', endTime: '12:00' }),
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'teacher',
      resourceId: 't1',
      sessionIds: ['a', 'b'],
      overlapMinutes: 60,
    })
  })

  it('detects space and group conflicts independently', () => {
    const conflicts = detectSessionConflicts([
      session({ id: 'a', spaceId: 's1', groupId: 'g1' }),
      session({ id: 'b', spaceId: 's1', groupId: 'g1', startTime: '10:00', endTime: '12:00' }),
    ])
    expect(conflicts.map((conflict) => conflict.kind).sort()).toEqual(['group', 'space'])
  })

  it('ignores back-to-back sessions', () => {
    expect(
      detectSessionConflicts([
        session({ id: 'a', teacherProfileId: 't1', startTime: '09:00', endTime: '11:00' }),
        session({ id: 'b', teacherProfileId: 't1', startTime: '11:00', endTime: '13:00' }),
      ]),
    ).toEqual([])
  })

  it('ignores different weekdays and different resources', () => {
    expect(
      detectSessionConflicts([
        session({ id: 'a', teacherProfileId: 't1', weekday: 1 }),
        session({ id: 'b', teacherProfileId: 't1', weekday: 2 }),
        session({ id: 'c', teacherProfileId: 't2', weekday: 1 }),
      ]),
    ).toEqual([])
  })

  it('ignores sessions whose date ranges do not meet', () => {
    expect(
      detectSessionConflicts([
        session({
          id: 'a',
          teacherProfileId: 't1',
          dateFrom: new Date('2026-09-14'),
          dateTo: new Date('2026-10-31'),
        }),
        session({
          id: 'b',
          teacherProfileId: 't1',
          dateFrom: new Date('2026-11-01'),
          dateTo: new Date('2026-12-18'),
        }),
      ]),
    ).toEqual([])
  })

  it('does not report a session against itself', () => {
    expect(detectSessionConflicts([session({ id: 'a', teacherProfileId: 't1' })])).toEqual([])
  })
})

describe('recurrence', () => {
  it('lets biweekly sessions on alternate weeks coexist', () => {
    const even = session({
      id: 'even',
      teacherProfileId: 't1',
      recurrence: 'biweekly',
      dateFrom: new Date('2026-09-14'),
    })
    const odd = session({
      id: 'odd',
      teacherProfileId: 't1',
      recurrence: 'biweekly',
      dateFrom: new Date('2026-09-21'),
    })
    const alsoEven = session({
      id: 'also-even',
      teacherProfileId: 't1',
      recurrence: 'biweekly',
      dateFrom: new Date('2026-09-28'),
    })

    expect(occurrencesCanCollide(even, odd)).toBe(false)
    expect(occurrencesCanCollide(even, alsoEven)).toBe(true)
    expect(detectSessionConflicts([even, odd])).toEqual([])
    expect(detectSessionConflicts([even, alsoEven])).toHaveLength(1)
  })

  it('collides a weekly session with any biweekly one', () => {
    const weekly = session({ id: 'weekly', teacherProfileId: 't1' })
    const biweekly = session({
      id: 'biweekly',
      teacherProfileId: 't1',
      recurrence: 'biweekly',
      dateFrom: new Date('2026-09-21'),
    })
    expect(detectSessionConflicts([weekly, biweekly])).toHaveLength(1)
  })

  it('compares one-off sessions by date', () => {
    const first = session({
      id: 'first',
      teacherProfileId: 't1',
      recurrence: 'once',
      dateFrom: new Date('2026-10-05'),
      dateTo: new Date('2026-10-05'),
    })
    const sameDay = session({
      id: 'same-day',
      teacherProfileId: 't1',
      recurrence: 'once',
      dateFrom: new Date('2026-10-05'),
      dateTo: new Date('2026-10-05'),
    })
    const otherDay = session({
      id: 'other-day',
      teacherProfileId: 't1',
      recurrence: 'once',
      dateFrom: new Date('2026-10-12'),
      dateTo: new Date('2026-10-12'),
    })

    expect(detectSessionConflicts([first, sameDay])).toHaveLength(1)
    expect(detectSessionConflicts([first, otherDay])).toEqual([])
  })
})

describe('candidate placement', () => {
  it('returns what a proposed session would break', () => {
    const existing = [
      session({ id: 'a', teacherProfileId: 't1', spaceId: 's1' }),
      session({ id: 'b', teacherProfileId: 't2', spaceId: 's2', weekday: 3 }),
    ]
    const candidate = session({
      id: 'new',
      teacherProfileId: 't1',
      spaceId: 's1',
      startTime: '10:00',
      endTime: '12:00',
    })

    const conflicts = findConflictsFor(candidate, existing)
    expect(conflicts.map((conflict) => conflict.kind).sort()).toEqual(['space', 'teacher'])
    expect(findConflictsFor(candidate, existing, { kinds: ['group'] })).toEqual([])
  })
})
