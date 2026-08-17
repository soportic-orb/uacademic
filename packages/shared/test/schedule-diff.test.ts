import { describe, expect, it } from 'vitest'

import {
  type SessionSnapshot,
  changesForTeacher,
  diffSchedules,
} from '../src/domain/schedule-diff.js'
import {
  canTransition,
  evaluateTransition,
  isEditable,
  nextStatuses,
  notifiesTeachers,
} from '../src/domain/schedule-version.js'

function snapshot(id: string, overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id,
    groupId: 'g1',
    groupCode: 'T1',
    subjectCode: 'MAT101',
    subjectName: 'Matemàtiques I',
    teacherProfileId: 'p1',
    teacherName: 'Marta Puig',
    spaceId: 's1',
    spaceName: 'Aula 1.1',
    weekday: 1,
    startTime: '09:00',
    endTime: '11:00',
    recurrence: 'weekly',
    ...overrides,
  }
}

describe('comparing two versions', () => {
  it('reports nothing when the week did not change, even with new row ids', () => {
    const diff = diffSchedules([snapshot('old')], [snapshot('new')])

    expect(diff.changes).toEqual([])
    expect(diff.summary).toMatchObject({ unchanged: 1, added: 0, removed: 0, changed: 0 })
  })

  it('sees a session that moved to another slot', () => {
    const diff = diffSchedules(
      [snapshot('old')],
      [snapshot('new', { weekday: 3, startTime: '15:00', endTime: '17:00' })],
    )

    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]).toMatchObject({ kind: 'changed', fields: ['slot'] })
    expect(diff.changes[0]?.messageKey).toBe('planner.change.slot')
    expect(diff.changes[0]?.params).toMatchObject({
      group: 'MAT101 T1',
      weekday: 3,
      start: '15:00',
      previousWeekday: 1,
      previousStart: '09:00',
    })
  })

  it('sees a change of teacher and tells both of them', () => {
    const diff = diffSchedules(
      [snapshot('old')],
      [snapshot('new', { teacherProfileId: 'p2', teacherName: 'Sergi Vila' })],
    )

    expect(diff.changes[0]).toMatchObject({ kind: 'changed', fields: ['teacher'] })
    expect(diff.changes[0]?.teacherProfileIds.sort()).toEqual(['p1', 'p2'])
    expect(diff.summary.teachersAffected).toBe(2)
  })

  it('sees a change of room', () => {
    const diff = diffSchedules(
      [snapshot('old')],
      [snapshot('new', { spaceId: 's2', spaceName: 'Aula 2.3' })],
    )

    expect(diff.changes[0]).toMatchObject({ fields: ['space'] })
    expect(diff.changes[0]?.params).toMatchObject({ space: 'Aula 2.3', previousSpace: 'Aula 1.1' })
  })

  it('lists every field when a session moved, changed hands and changed room', () => {
    const diff = diffSchedules(
      [snapshot('old')],
      [
        snapshot('new', {
          weekday: 2,
          teacherProfileId: 'p2',
          teacherName: 'Sergi Vila',
          spaceId: 's2',
          spaceName: 'Aula 2.3',
        }),
      ],
    )

    expect(diff.changes[0]?.fields).toEqual(['slot', 'teacher', 'space'])
  })

  it('separates additions from removals', () => {
    const diff = diffSchedules(
      [snapshot('old', { groupId: 'g1' })],
      [snapshot('new', { groupId: 'g2', groupCode: 'T2' })],
    )

    expect(diff.summary).toMatchObject({ added: 1, removed: 1, changed: 0 })
    expect(diff.changes.map((change) => change.messageKey).sort()).toEqual([
      'planner.change.added',
      'planner.change.removed',
    ])
  })

  it('pairs the untouched session first when a group has several', () => {
    // Two sessions of the same group; only the Wednesday one moves.
    const before = [
      snapshot('a', { weekday: 1, startTime: '09:00', endTime: '10:00' }),
      snapshot('b', { weekday: 3, startTime: '09:00', endTime: '10:00' }),
    ]
    const after = [
      snapshot('c', { weekday: 1, startTime: '09:00', endTime: '10:00' }),
      snapshot('d', { weekday: 4, startTime: '12:00', endTime: '13:00' }),
    ]

    const diff = diffSchedules(before, after)
    expect(diff.summary).toMatchObject({ unchanged: 1, changed: 1, added: 0, removed: 0 })
    expect(diff.changes[0]?.before?.id).toBe('b')
    expect(diff.changes[0]?.after?.id).toBe('d')
  })

  it('orders the changes as a week reads, not as the database returns them', () => {
    const diff = diffSchedules(
      [],
      [
        snapshot('late', { groupId: 'g2', groupCode: 'T2', weekday: 5, startTime: '09:00' }),
        snapshot('early', { weekday: 1, startTime: '08:00' }),
      ],
    )

    expect(diff.changes.map((change) => change.after?.id)).toEqual(['early', 'late'])
  })

  it('groups the changes by teacher, which is what the notification needs', () => {
    const diff = diffSchedules(
      [snapshot('old'), snapshot('keep', { groupId: 'g2', groupCode: 'T2' })],
      [
        snapshot('new', { weekday: 4 }),
        snapshot('keep2', {
          groupId: 'g2',
          groupCode: 'T2',
          teacherProfileId: 'p3',
          teacherName: 'Pau Torres',
        }),
      ],
    )

    expect(changesForTeacher(diff, 'p1')).toHaveLength(2)
    expect(changesForTeacher(diff, 'p3')).toHaveLength(1)
    // Nobody else hears about it.
    expect(changesForTeacher(diff, 'p9')).toEqual([])
  })

  it('handles a session with no teacher without losing it', () => {
    const diff = diffSchedules(
      [snapshot('old', { teacherProfileId: null, teacherName: null })],
      [snapshot('new', { teacherProfileId: null, teacherName: null, weekday: 2 })],
    )

    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]?.teacherProfileIds).toEqual([])
    expect(diff.summary.teachersAffected).toBe(0)
  })

  it('compares an empty version against a full one', () => {
    expect(diffSchedules([], []).changes).toEqual([])
    expect(diffSchedules([], [snapshot('a')]).summary.added).toBe(1)
    expect(diffSchedules([snapshot('a')], []).summary.removed).toBe(1)
  })
})

describe('the version lifecycle', () => {
  it('follows draft → review → published, and never backwards from published', () => {
    expect(canTransition('draft', 'in_review')).toBe(true)
    expect(canTransition('in_review', 'published')).toBe(true)
    expect(canTransition('in_review', 'draft')).toBe(true)
    expect(canTransition('published', 'draft')).toBe(false)
    expect(canTransition('archived', 'published')).toBe(false)
    expect(nextStatuses('published')).toEqual(['archived'])
  })

  it('knows which states are still editable and which one notifies', () => {
    expect(isEditable('draft')).toBe(true)
    expect(isEditable('in_review')).toBe(true)
    expect(isEditable('published')).toBe(false)
    // Working in a draft must never reach a teacher.
    expect(notifiesTeachers('draft')).toBe(false)
    expect(notifiesTeachers('in_review')).toBe(false)
    expect(notifiesTeachers('published')).toBe(true)
  })

  it('refuses to publish a week that still has blocking conflicts', () => {
    expect(
      evaluateTransition({
        from: 'in_review',
        to: 'published',
        requiresReview: true,
        blockingViolations: 2,
      }),
    ).toEqual({ allowed: false, messageKey: 'planner.version.errors.blockingViolations' })
  })

  it('honours a center that demands the review step', () => {
    expect(
      evaluateTransition({
        from: 'draft',
        to: 'published',
        requiresReview: true,
        blockingViolations: 0,
      }),
    ).toEqual({ allowed: false, messageKey: 'planner.version.errors.reviewRequired' })

    expect(
      evaluateTransition({
        from: 'draft',
        to: 'published',
        requiresReview: false,
        blockingViolations: 0,
      }),
    ).toEqual({ allowed: true })
  })

  it('refuses a transition the graph does not have', () => {
    expect(
      evaluateTransition({
        from: 'published',
        to: 'in_review',
        requiresReview: false,
        blockingViolations: 0,
      }),
    ).toEqual({ allowed: false, messageKey: 'planner.version.errors.invalidTransition' })
  })
})
