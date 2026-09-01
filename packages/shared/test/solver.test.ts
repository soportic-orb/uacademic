import { describe, expect, it } from 'vitest'

import type { AvailabilityEntry } from '../src/domain/availability.js'
import {
  type GroupResource,
  type ScheduleContext,
  type SpaceResource,
  type TeacherResource,
  scoreSchedule,
} from '../src/domain/constraints.js'
import { parseCenterSettings } from '../src/domain/settings.js'
import {
  type SessionRequirement,
  type SolverProgress,
  createRandom,
  feasiblePlacements,
  generateSchedule,
  summarizeSacrifices,
} from '../src/domain/solver.js'
import type { Weekday } from '../src/domain/time.js'

const TERM = { dateFrom: new Date('2026-09-14'), dateTo: new Date('2027-01-30') }

const SETTINGS = parseCenterSettings({
  schedule: {
    dayStart: '09:00',
    dayEnd: '13:00',
    slotMinutes: 60,
    workingWeekdays: [1, 2, 3],
    teachingWeeks: 30,
  },
})

const ALL_DAY: AvailabilityEntry[] = [1, 2, 3].map((weekday) => ({
  weekday: weekday as Weekday,
  startTime: '09:00',
  endTime: '13:00',
  level: 'available',
}))

function teacher(id: string, overrides: Partial<TeacherResource> = {}): TeacherResource {
  // A year's contract, which is what a term of weekly classes is weighed
  // against.
  return { teacherProfileId: id, availability: ALL_DAY, capacityHours: 600, ...overrides }
}

function space(id: string, overrides: Partial<SpaceResource> = {}): SpaceResource {
  return {
    spaceId: id,
    name: `Aula ${id}`,
    building: 'A',
    capacity: 60,
    type: 'classroom',
    equipment: [],
    ...overrides,
  }
}

function group(id: string, overrides: Partial<GroupResource> = {}): GroupResource {
  return {
    groupId: id,
    code: id.toUpperCase(),
    subjectId: `subject-${id}`,
    subjectCode: `SUB${id}`,
    subjectName: `Assignatura ${id}`,
    capacity: 30,
    requiredEquipment: [],
    ...overrides,
  }
}

function context(
  overrides: Partial<{
    settings: ScheduleContext['settings']
    teachers: TeacherResource[]
    spaces: SpaceResource[]
    groups: GroupResource[]
  }> = {},
): ScheduleContext {
  return {
    settings: overrides.settings ?? SETTINGS,
    teachers: new Map(
      (overrides.teachers ?? [teacher('t1'), teacher('t2')]).map((entry) => [
        entry.teacherProfileId,
        entry,
      ]),
    ),
    spaces: new Map(
      (overrides.spaces ?? [space('s1'), space('s2')]).map((entry) => [entry.spaceId, entry]),
    ),
    groups: new Map(
      (overrides.groups ?? [group('g1'), group('g2'), group('g3')]).map((entry) => [
        entry.groupId,
        entry,
      ]),
    ),
  }
}

function requirement(id: string, overrides: Partial<SessionRequirement> = {}): SessionRequirement {
  return {
    id,
    groupId: 'g1',
    durationMinutes: 60,
    candidateTeacherIds: ['t1'],
    candidateSpaceIds: ['s1'],
    recurrence: 'weekly',
    ...TERM,
    ...overrides,
  }
}

/** A clock the test drives, so nothing depends on how fast the machine is. */
function fakeClock(stepMs = 1) {
  let value = 0
  return () => {
    value += stepMs
    return value
  }
}

describe('the seeded generator', () => {
  it('returns the same sequence for the same seed and a different one otherwise', () => {
    const first = Array.from({ length: 5 }, createRandom(42))
    const again = Array.from({ length: 5 }, createRandom(42))
    const other = Array.from({ length: 5 }, createRandom(43))

    expect(first).toEqual(again)
    expect(first).not.toEqual(other)
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true)
  })
})

describe('feasible placements', () => {
  it('offers every legal combination of slot, teacher and room', () => {
    // 3 days × 4 hourly starts × 2 teachers × 2 rooms.
    const options = feasiblePlacements(
      requirement('r1', { candidateTeacherIds: ['t1', 't2'], candidateSpaceIds: ['s1', 's2'] }),
      [],
      context(),
    )
    expect(options).toHaveLength(3 * 4 * 2 * 2)
  })

  it('drops the options the hard constraints forbid', () => {
    const mornings = teacher('t1', {
      availability: [{ weekday: 1, startTime: '09:00', endTime: '11:00', level: 'available' }],
    })
    const options = feasiblePlacements(requirement('r1'), [], context({ teachers: [mornings] }))

    expect(options).toEqual([
      { weekday: 1, startTime: '09:00', endTime: '10:00', teacherProfileId: 't1', spaceId: 's1' },
      { weekday: 1, startTime: '10:00', endTime: '11:00', teacherProfileId: 't1', spaceId: 's1' },
    ])
  })

  it('stops counting once the caller has seen enough', () => {
    expect(feasiblePlacements(requirement('r1'), [], context(), 3)).toHaveLength(3)
  })

  it('returns nothing when the week is already full', () => {
    const single = context({
      teachers: [
        teacher('t1', {
          availability: [{ weekday: 1, startTime: '09:00', endTime: '10:00', level: 'available' }],
        }),
      ],
      spaces: [space('s1')],
    })
    const taken = [
      {
        id: 'busy',
        groupId: 'g2',
        teacherProfileId: 't1',
        spaceId: 's1',
        weekday: 1 as Weekday,
        startTime: '09:00',
        endTime: '10:00',
        ...TERM,
        recurrence: 'weekly' as const,
      },
    ]

    expect(feasiblePlacements(requirement('r1'), taken, single)).toEqual([])
  })
})

describe('automatic generation', () => {
  const requirements = [
    requirement('r1', { groupId: 'g1' }),
    requirement('r2', { groupId: 'g2', candidateTeacherIds: ['t2'], candidateSpaceIds: ['s2'] }),
    requirement('r3', {
      groupId: 'g3',
      candidateTeacherIds: ['t1', 't2'],
      candidateSpaceIds: ['s1', 's2'],
    }),
  ]

  it('places everything it can and never breaks a hard constraint', () => {
    const result = generateSchedule(
      { context: context(), requirements },
      { seed: 7, now: fakeClock(), maxIterations: 400 },
    )

    const best = result.proposals[0]!
    expect(best.sessions).toHaveLength(3)
    expect(best.unplaced).toEqual([])
    expect(best.score.feasible).toBe(true)
    expect(scoreSchedule(best.sessions, context()).violations).toEqual([])
  })

  it('is deterministic: the same seed produces the same timetable', () => {
    const run = () =>
      generateSchedule(
        { context: context(), requirements },
        { seed: 99, now: fakeClock(), maxIterations: 300 },
      ).proposals.map((proposal) =>
        proposal.sessions.map((session) => `${session.id}@${session.weekday}#${session.startTime}`),
      )

    expect(run()).toEqual(run())
  })

  it('returns several ranked proposals, best first', () => {
    const result = generateSchedule(
      { context: context(), requirements },
      { seed: 3, now: fakeClock(), maxIterations: 600, proposals: 3 },
    )

    expect(result.proposals.length).toBeGreaterThan(1)
    expect(result.proposals.length).toBeLessThanOrEqual(3)
    const costs = result.proposals.map((proposal) => proposal.cost)
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(new Set(result.proposals.map((proposal) => proposal.id)).size).toBe(
      result.proposals.length,
    )
  })

  it('explains what each proposal gave up, as keys the UI translates (R1)', () => {
    const result = generateSchedule(
      { context: context(), requirements },
      { seed: 5, now: fakeClock(), maxIterations: 400 },
    )

    for (const proposal of result.proposals) {
      for (const sacrifice of proposal.sacrifices) {
        expect(sacrifice.messageKey).toMatch(/^planner\.sacrifice\./)
        expect(sacrifice.cost).toBeGreaterThan(0)
      }
      // The explanation adds up to the score it is explaining.
      const explained = proposal.sacrifices.reduce((total, entry) => total + entry.cost, 0)
      expect(Math.round(explained * 100) / 100).toBe(proposal.score.softCost)
    }
  })

  it('improves on the greedy construction rather than just reproducing it', () => {
    // Two teachers who can only be free at different ends of the week: the
    // greedy pass fills the first holes it finds, annealing spreads them out.
    const crowded = Array.from({ length: 6 }, (_, index) =>
      requirement(`r${index}`, {
        groupId: ['g1', 'g2', 'g3'][index % 3]!,
        candidateTeacherIds: ['t1', 't2'],
        candidateSpaceIds: ['s1', 's2'],
      }),
    )

    const greedyOnly = generateSchedule(
      { context: context(), requirements: crowded },
      { seed: 11, now: fakeClock(), maxIterations: 0 },
    )
    const annealed = generateSchedule(
      { context: context(), requirements: crowded },
      { seed: 11, now: fakeClock(), maxIterations: 3000 },
    )

    expect(annealed.proposals[0]!.cost).toBeLessThanOrEqual(greedyOnly.proposals[0]!.cost)
    expect(annealed.iterations).toBeGreaterThan(0)
  })

  it('reports what it could not place instead of inventing a slot', () => {
    const oneHole = context({
      teachers: [
        teacher('t1', {
          availability: [{ weekday: 1, startTime: '09:00', endTime: '10:00', level: 'available' }],
        }),
      ],
      spaces: [space('s1')],
    })

    const result = generateSchedule(
      {
        context: oneHole,
        requirements: [requirement('r1', { groupId: 'g1' }), requirement('r2', { groupId: 'g2' })],
      },
      { seed: 2, now: fakeClock(), maxIterations: 200 },
    )

    const best = result.proposals[0]!
    expect(best.sessions).toHaveLength(1)
    expect(best.unplaced).toHaveLength(1)
    // An unplaced session costs far more than any comfort penalty, so a
    // proposal that places more always ranks first.
    expect(best.cost).toBeGreaterThanOrEqual(1000)
  })

  it('leaves fixed sessions exactly where the coordinator put them', () => {
    const pinned = {
      id: 'pinned',
      groupId: 'g2',
      teacherProfileId: 't2',
      spaceId: 's2',
      weekday: 1 as Weekday,
      startTime: '09:00',
      endTime: '10:00',
      ...TERM,
      recurrence: 'weekly' as const,
    }

    const result = generateSchedule(
      {
        context: context(),
        requirements: [requirement('r1'), requirement('r3', { groupId: 'g3' })],
        fixed: [pinned],
      },
      { seed: 4, now: fakeClock(), maxIterations: 800 },
    )

    for (const proposal of result.proposals) {
      expect(proposal.sessions.find((session) => session.id === 'pinned')).toMatchObject({
        weekday: 1,
        startTime: '09:00',
        spaceId: 's2',
      })
    }
  })

  it('stops when the time budget runs out and says so', () => {
    const result = generateSchedule(
      { context: context(), requirements },
      // A clock that jumps 10 s per reading against a 60 s budget.
      { seed: 1, now: fakeClock(10_000), timeBudgetMs: 60_000, maxIterations: 1_000_000 },
    )

    expect(result.stoppedEarly).toBe(true)
    expect(result.iterations).toBeLessThan(1_000_000)
    expect(result.proposals.length).toBeGreaterThan(0)
  })

  it('stops when the caller cancels', () => {
    let calls = 0
    const result = generateSchedule(
      { context: context(), requirements },
      {
        seed: 1,
        now: fakeClock(),
        maxIterations: 1_000_000,
        shouldStop: () => {
          calls += 1
          return calls > 50
        },
      },
    )

    expect(result.stoppedEarly).toBe(true)
    expect(result.iterations).toBeLessThan(1000)
  })

  it('reports progress that a progress bar can actually show', () => {
    const progress: SolverProgress[] = []
    generateSchedule(
      { context: context(), requirements },
      {
        seed: 8,
        now: fakeClock(),
        maxIterations: 1000,
        onProgress: (entry) => progress.push(entry),
      },
    )

    expect(progress[0]?.phase).toBe('construct')
    expect(progress.at(-1)).toMatchObject({ phase: 'improve', percent: 100 })
    const percents = progress.map((entry) => entry.percent)
    expect(percents).toEqual([...percents].sort((a, b) => a - b))
    expect(percents.every((percent) => percent >= 0 && percent <= 100)).toBe(true)
  })

  it('survives being asked for nothing', () => {
    const result = generateSchedule(
      { context: context(), requirements: [] },
      { seed: 1, now: fakeClock(), maxIterations: 10 },
    )

    expect(result.proposals[0]?.sessions).toEqual([])
    expect(result.proposals[0]?.score.feasible).toBe(true)
  })
})

describe('sacrifice summaries', () => {
  it('groups the penalties by constraint, worst first', () => {
    const sacrifices = summarizeSacrifices([
      {
        constraint: 'teacherGaps',
        amount: 1,
        weight: 4,
        cost: 4,
        messageKey: 'planner.soft.teacherGaps',
        params: {},
      },
      {
        constraint: 'teacherGaps',
        amount: 2,
        weight: 4,
        cost: 8,
        messageKey: 'planner.soft.teacherGaps',
        params: {},
      },
      {
        constraint: 'avoidSlot',
        amount: 1,
        weight: 5,
        cost: 5,
        messageKey: 'planner.soft.avoidSlot',
        params: {},
      },
    ])

    expect(sacrifices).toHaveLength(2)
    expect(sacrifices[0]).toMatchObject({
      constraint: 'teacherGaps',
      amount: 3,
      cost: 12,
      occurrences: 2,
      messageKey: 'planner.sacrifice.teacherGaps',
    })
    expect(sacrifices[1]?.constraint).toBe('avoidSlot')
  })

  it('says nothing when nothing was sacrificed', () => {
    expect(summarizeSacrifices([])).toEqual([])
  })
})
