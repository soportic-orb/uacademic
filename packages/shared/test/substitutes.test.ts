import { describe, expect, it } from 'vitest'

import type { AvailabilityEntry } from '../src/domain/availability.js'
import type { PlannedSession, ScheduleContext } from '../src/domain/constraints.js'
import { parseCenterSettings } from '../src/domain/settings.js'
import {
  type SubstituteCandidate,
  type SubstituteSearch,
  evaluateCandidate,
  rankSubstitutes,
} from '../src/domain/substitutes.js'

const TERM = { dateFrom: new Date('2026-09-14'), dateTo: new Date('2026-12-18') }

const SESSION: PlannedSession = {
  id: 'session-1',
  groupId: 'g1',
  teacherProfileId: 'absent',
  spaceId: 's1',
  weekday: 1,
  startTime: '09:00',
  endTime: '11:00',
  ...TERM,
  recurrence: 'weekly',
}

const MONDAY = (level: AvailabilityEntry['level']): AvailabilityEntry[] => [
  { weekday: 1, startTime: '08:00', endTime: '14:00', level },
]

const CONTEXT: ScheduleContext = {
  settings: parseCenterSettings({}),
  teachers: new Map(),
  spaces: new Map([
    [
      's1',
      {
        spaceId: 's1',
        name: 'Aula 1.1',
        building: 'A',
        capacity: 60,
        type: 'classroom',
        equipment: [],
      },
    ],
  ]),
  groups: new Map([
    [
      'g1',
      {
        groupId: 'g1',
        code: 'T1',
        subjectId: 'sub1',
        subjectCode: 'MAT101',
        subjectName: 'Matemàtiques I',
        capacity: 40,
        requiredEquipment: [],
      },
    ],
  ]),
}

function candidate(
  teacherProfileId: string,
  overrides: Partial<SubstituteCandidate> = {},
): SubstituteCandidate {
  return {
    teacherProfileId,
    name: teacherProfileId,
    subjectIds: ['sub1'],
    knowledgeAreas: ['Matemàtiques'],
    availability: MONDAY('available'),
    remainingWeeklyHours: 4,
    sessions: [],
    ...overrides,
  }
}

function search(candidates: SubstituteCandidate[]): SubstituteSearch {
  return {
    session: SESSION,
    subjectId: 'sub1',
    knowledgeArea: 'Matemàtiques',
    context: CONTEXT,
    candidates,
  }
}

describe('who can cover a class', () => {
  it('accepts a qualified, free colleague with capacity left', () => {
    const result = evaluateCandidate(candidate('a'), search([candidate('a')]))

    expect(result.eligible).toBe(true)
    expect(result.score).toBeGreaterThan(0)
    expect(result.reasons.map((reason) => reason.messageKey)).toContain(
      'substitutes.reasons.teachesSubject',
    )
  })

  it('refuses somebody who does not teach the subject or its area', () => {
    const outsider = candidate('b', { subjectIds: ['other'], knowledgeAreas: ['Història'] })
    const result = evaluateCandidate(outsider, search([outsider]))

    expect(result.eligible).toBe(false)
    expect(result.blockers).toContain('notQualified')
    expect(result.reasons[0]?.messageKey).toBe('substitutes.blockers.notQualified')
  })

  it('accepts somebody who shares the knowledge area, but ranks them lower', () => {
    const exact = candidate('exact')
    const area = candidate('area', { subjectIds: ['other'] })
    const [first, second] = rankSubstitutes(search([area, exact]))

    expect(first?.teacherProfileId).toBe('exact')
    expect(second?.teacherProfileId).toBe('area')
    expect(second?.eligible).toBe(true)
  })

  it('refuses a slot the colleague declared unavailable', () => {
    const busy = candidate('c', { availability: MONDAY('unavailable') })
    expect(evaluateCandidate(busy, search([busy])).blockers).toContain('unavailable')
  })

  it('refuses a colleague already teaching at that hour', () => {
    const clash: PlannedSession = {
      ...SESSION,
      id: 'other',
      groupId: 'g9',
      teacherProfileId: 'd',
      spaceId: null,
    }
    const busy = candidate('d', { sessions: [clash] })

    expect(evaluateCandidate(busy, search([busy])).blockers).toContain('busy')
  })

  it('refuses a colleague with no contract left for the hours', () => {
    const full = candidate('e', { remainingWeeklyHours: 1 })
    expect(evaluateCandidate(full, search([full])).blockers).toContain('noCapacity')
  })

  it('never proposes the absent teacher as their own substitute', () => {
    const self = candidate('absent')
    expect(evaluateCandidate(self, search([self])).blockers).toContain('sameTeacher')
  })

  it('prefers a slot the colleague marked as preferred over one they avoid', () => {
    const preferred = candidate('preferred', { availability: MONDAY('preferred') })
    const avoided = candidate('avoided', { availability: MONDAY('avoid') })

    const ranking = rankSubstitutes(search([avoided, preferred]))
    expect(ranking.map((entry) => entry.teacherProfileId)).toEqual(['preferred', 'avoided'])
    expect(ranking[1]?.eligible).toBe(true)
    expect(ranking[1]?.reasons.map((reason) => reason.messageKey)).toContain(
      'substitutes.reasons.avoidSlot',
    )
  })

  it('prefers more capacity headroom when everything else is equal', () => {
    const roomy = candidate('roomy', { remainingWeeklyHours: 10 })
    const tight = candidate('tight', { remainingWeeklyHours: 2 })

    expect(rankSubstitutes(search([tight, roomy])).map((entry) => entry.teacherProfileId)).toEqual([
      'roomy',
      'tight',
    ])
  })
})

describe('the ranking a coordinator reads', () => {
  it('puts every eligible colleague above every ineligible one', () => {
    const ranking = rankSubstitutes(
      search([
        candidate('unqualified', { subjectIds: [], knowledgeAreas: [] }),
        candidate('fine'),
        candidate('busy', { availability: MONDAY('unavailable') }),
      ]),
    )

    expect(ranking[0]?.teacherProfileId).toBe('fine')
    expect(ranking.slice(1).every((entry) => !entry.eligible)).toBe(true)
  })

  it('keeps the ineligible ones with their reason, because that is the question', () => {
    const ranking = rankSubstitutes(search([candidate('nope', { remainingWeeklyHours: 0 })]))

    expect(ranking).toHaveLength(1)
    expect(ranking[0]).toMatchObject({ eligible: false, score: 0 })
    expect(ranking[0]?.reasons[0]?.messageKey).toBe('substitutes.blockers.noCapacity')
  })

  it('breaks ties on the name so the list does not shuffle between reloads', () => {
    const ranking = rankSubstitutes(
      search([candidate('zoe', { name: 'Zoe' }), candidate('ana', { name: 'Ana' })]),
    )
    expect(ranking.map((entry) => entry.name)).toEqual(['Ana', 'Zoe'])
  })
})
