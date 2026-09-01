import { describe, expect, it } from 'vitest'

import type { AvailabilityEntry } from '../src/domain/availability.js'
import {
  type GroupResource,
  type PlannedSession,
  type ScheduleContext,
  type SpaceResource,
  type TeacherResource,
  HARD_CONSTRAINTS,
  SOFT_CONSTRAINTS,
  candidateSlots,
  evaluateCell,
  evaluatePlacement,
  evaluateSoft,
  scoreSchedule,
  summarizePlan,
  weeklyCapacityFrom,
} from '../src/domain/constraints.js'
import { type CenterSettings, parseCenterSettings } from '../src/domain/settings.js'
import type { Weekday } from '../src/domain/time.js'

const TERM = { dateFrom: new Date('2026-09-14'), dateTo: new Date('2027-01-30') }

const MORNINGS: AvailabilityEntry[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday: weekday as Weekday,
  startTime: '08:00',
  endTime: '14:00',
  level: 'available',
}))

function teacher(
  teacherProfileId: string,
  overrides: Partial<TeacherResource> = {},
): TeacherResource {
  return {
    teacherProfileId,
    availability: MORNINGS,
    // A year's contract: a weekly class over a term is twenty of itself, and
    // that is what the engine weighs.
    capacityHours: 240,
    ...overrides,
  }
}

function space(spaceId: string, overrides: Partial<SpaceResource> = {}): SpaceResource {
  return {
    spaceId,
    name: `Aula ${spaceId}`,
    building: 'A',
    capacity: 60,
    type: 'classroom',
    equipment: ['projector'],
    ...overrides,
  }
}

function group(groupId: string, overrides: Partial<GroupResource> = {}): GroupResource {
  return {
    groupId,
    code: 'T1',
    subjectId: 'subject-1',
    subjectCode: 'MAT101',
    subjectName: 'Matemàtiques I',
    capacity: 40,
    requiredSpaceType: null,
    requiredEquipment: [],
    ...overrides,
  }
}

function context(
  overrides: {
    settings?: CenterSettings
    teachers?: TeacherResource[]
    spaces?: SpaceResource[]
    groups?: GroupResource[]
  } = {},
): ScheduleContext {
  return {
    settings: overrides.settings ?? parseCenterSettings({}),
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
      (overrides.groups ?? [group('g1'), group('g2', { code: 'T2' })]).map((entry) => [
        entry.groupId,
        entry,
      ]),
    ),
  }
}

function session(id: string, overrides: Partial<PlannedSession> = {}): PlannedSession {
  return {
    id,
    groupId: 'g1',
    teacherProfileId: 't1',
    spaceId: 's1',
    weekday: 1,
    startTime: '09:00',
    endTime: '11:00',
    ...TERM,
    recurrence: 'weekly',
    ...overrides,
  }
}

/**
 * A class on one date, which is what the planner writes when a coordinator
 * places one. Its hours are its own length, with nothing repeating them.
 */
const on = (date: string) => ({
  recurrence: 'once' as const,
  dateFrom: new Date(date),
  dateTo: new Date(date),
})

const constraintsOf = (violations: { constraint: string }[]) =>
  violations.map((violation) => violation.constraint)

describe('hard constraints', () => {
  it('accepts a placement that breaks nothing', () => {
    expect(evaluatePlacement(session('a'), [], context())).toEqual([])
  })

  /*
    Three groups can share a Wednesday at eleven, and the same lecturer can be
    on two of them — they open both practicals and move between them. It is
    reported every time and refused never: a planner that says "impossible" to
    something a department does every term is one people work around.
  */
  it('allows the same teacher in two places at once, and says so', () => {
    const existing = session('b', { groupId: 'g2', spaceId: 's2' })

    expect(evaluatePlacement(session('a'), [existing], context())).toEqual([])

    const cell = evaluateCell(session('a'), [existing], context())
    expect(cell.status).toBe('warning')
    expect(cell.penalties.map((penalty) => penalty.constraint)).toContain('teacherOverlap')
  })

  it('blocks two groups in the same room at once', () => {
    const existing = session('b', { groupId: 'g2', teacherProfileId: 't2' })
    expect(constraintsOf(evaluatePlacement(session('a'), [existing], context()))).toContain(
      'spaceOverlap',
    )
  })

  it('blocks a group being taught two things at once', () => {
    const existing = session('b', { teacherProfileId: 't2', spaceId: 's2' })
    expect(constraintsOf(evaluatePlacement(session('a'), [existing], context()))).toContain(
      'groupOverlap',
    )
  })

  it('lets back-to-back sessions touch without colliding', () => {
    const existing = session('b', { startTime: '11:00', endTime: '12:00', groupId: 'g2' })
    expect(evaluatePlacement(session('a'), [existing], context())).toEqual([])
  })

  it('lets alternating biweekly sessions share a slot', () => {
    const existing = session('b', {
      groupId: 'g2',
      spaceId: 's2',
      recurrence: 'biweekly',
      dateFrom: new Date('2026-09-21'),
    })
    const candidate = session('a', { recurrence: 'biweekly' })

    expect(evaluatePlacement(candidate, [existing], context())).toEqual([])
  })

  it('blocks a slot the teacher marked unavailable', () => {
    const violations = evaluatePlacement(
      session('a', { startTime: '16:00', endTime: '18:00' }),
      [],
      context(),
    )

    expect(constraintsOf(violations)).toEqual(['teacherUnavailable'])
    expect(violations[0]?.params).toMatchObject({ start: '16:00', end: '18:00' })
  })

  it('blocks hours beyond the contracted ceiling, using the center’s own limit', () => {
    // A contract of 8 h, ceiling 120 % → 9.6 h. Six hours already placed on
    // their own dates, plus a four-hour class, is 10.
    const short = context({ teachers: [teacher('t1', { capacityHours: 8 })] })
    const existing = [
      session('b', {
        weekday: 2,
        groupId: 'g2',
        startTime: '08:00',
        endTime: '11:00',
        ...on('2026-09-15'),
      }),
      session('c', {
        weekday: 3,
        groupId: 'g2',
        startTime: '08:00',
        endTime: '11:00',
        ...on('2026-09-16'),
      }),
    ]
    const candidate = session('a', {
      weekday: 4,
      startTime: '09:00',
      endTime: '13:00',
      ...on('2026-09-17'),
    })

    const violations = evaluatePlacement(candidate, existing, short)
    expect(constraintsOf(violations)).toContain('teacherCapacity')
    expect(violations[0]?.params).toMatchObject({ scheduled: 10, ceiling: 9.6 })

    // The same placement is legal for a center that tolerates more overload.
    const tolerant = context({
      settings: parseCenterSettings({ load: { maxOverloadPercent: 200 } }),
      teachers: [teacher('t1', { capacityHours: 8 })],
    })
    expect(evaluatePlacement(candidate, existing, tolerant)).toEqual([])
  })

  it('costs a repeating class every week it repeats', () => {
    /*
      The generator lays a timetable out as one row per class per term, so a
      Monday class is twenty Mondays. Counting the row once read a full
      timetable as a twentieth of itself and nobody was ever near their
      contract.

      Two hours every Monday from mid-September to the end of January is 40 h
      against a contract of 30, whose ceiling is 36.
    */
    const short = context({ teachers: [teacher('t1', { capacityHours: 30 })] })
    const violations = evaluatePlacement(session('a'), [], short)

    expect(constraintsOf(violations)).toContain('teacherCapacity')
    expect(violations[0]?.params).toMatchObject({ scheduled: 40, ceiling: 36 })
  })

  it('weighs a year of classes against the year’s contract, not against a week of it', () => {
    /*
      The version holds every class of the year, one date at a time. Judging
      that pile against a weekly ceiling read a normally contracted teacher as
      three hundred per cent full by October: the planner refused to publish
      for "conflicts" while the teacher's own card called them under-loaded.

      240 contracted hours, ceiling 120 % → 288. A hundred and ten two-hour
      classes is 220 hours: inside the contract, and nothing to report.
    */
    const contracted = context({ teachers: [teacher('t1', { capacityHours: 240 })] })
    const year = Array.from({ length: 109 }, (_, index) => {
      // A date each, because these classes happen one day at a time rather
      // than repeating: two of them on one date would be the same class twice.
      const date = new Date(Date.UTC(2026, 8, 15 + index))
      return session(`d${index}`, {
        weekday: (((date.getUTCDay() + 6) % 7) + 1) as Weekday,
        recurrence: 'once',
        dateFrom: date,
        dateTo: date,
      })
    })

    expect(constraintsOf(evaluatePlacement(session('a'), year, contracted))).not.toContain(
      'teacherCapacity',
    )
    expect(summarizePlan([session('a'), ...year], 0, contracted).teachersOutOfRange).toBe(0)
  })

  it('does not judge the capacity of a teacher with no contract recorded', () => {
    const noContract = context({ teachers: [teacher('t1', { capacityHours: null })] })
    const many = [1, 2, 3, 4, 5].map((weekday) =>
      session(`x${weekday}`, { weekday: weekday as Weekday, groupId: 'g2' }),
    )

    expect(
      evaluatePlacement(session('a'), many, noContract).map((v) => v.constraint),
    ).not.toContain('teacherCapacity')
  })

  it('blocks a room that cannot seat the group', () => {
    const tight = context({ spaces: [space('s1', { capacity: 20 })], groups: [group('g1')] })
    const violations = evaluatePlacement(session('a'), [], tight)

    expect(constraintsOf(violations)).toEqual(['spaceCapacity'])
    expect(violations[0]?.params).toMatchObject({ capacity: 20, students: 40 })
  })

  it('does not judge capacity when nobody recorded the group size', () => {
    const unknown = context({
      spaces: [space('s1', { capacity: 5 })],
      groups: [group('g1', { capacity: null })],
    })
    expect(evaluatePlacement(session('a'), [], unknown)).toEqual([])
  })

  it('blocks a room missing the equipment the group needs', () => {
    const lab = context({
      spaces: [space('s1', { equipment: ['projector'] })],
      groups: [group('g1', { requiredEquipment: ['workstations', 'linux'] })],
    })
    const violations = evaluatePlacement(session('a'), [], lab)

    expect(constraintsOf(violations)).toEqual(['spaceEquipment'])
    expect(violations[0]?.params.equipment).toBe('workstations, linux')
  })

  it('accepts a room that has more equipment than required', () => {
    const fine = context({
      spaces: [space('s1', { equipment: ['projector', 'workstations', 'linux'] })],
      groups: [group('g1', { requiredEquipment: ['workstations'] })],
    })
    expect(evaluatePlacement(session('a'), [], fine)).toEqual([])
  })

  it('reports several problems at once rather than only the first', () => {
    const hostile = context({
      spaces: [space('s1', { capacity: 10, equipment: [] })],
      groups: [group('g1', { requiredEquipment: ['linux'] })],
    })
    const violations = evaluatePlacement(
      session('a', { startTime: '18:00', endTime: '20:00' }),
      [],
      hostile,
    )

    expect(new Set(constraintsOf(violations))).toEqual(
      new Set(['teacherUnavailable', 'spaceCapacity', 'spaceEquipment']),
    )
  })

  it('says nothing about resources it does not know', () => {
    const empty = context({ teachers: [], spaces: [], groups: [] })
    expect(evaluatePlacement(session('a'), [], empty)).toEqual([])
    expect(
      evaluatePlacement(session('a', { teacherProfileId: null, spaceId: null }), [], context()),
    ).toEqual([])
  })

  it('covers every declared hard constraint', () => {
    // A guard against adding a constraint to the type and forgetting to fire it.
    const fired = new Set<string>()
    const hostile = context({
      spaces: [space('s1', { capacity: 1, equipment: [] })],
      groups: [group('g1', { requiredEquipment: ['linux'] }), group('g2', { code: 'T2' })],
      teachers: [teacher('t1', { capacityHours: 0.5 })],
    })

    const clash = [
      // Same teacher and same room as the candidate…
      session('b', {
        groupId: 'g2',
        spaceId: 's1',
        teacherProfileId: 't1',
        startTime: '17:00',
        endTime: '19:00',
      }),
      // …and the same group, taught by somebody else, in the same slot.
      session('c', {
        groupId: 'g1',
        spaceId: 's2',
        teacherProfileId: 't2',
        startTime: '17:00',
        endTime: '19:00',
      }),
    ]
    for (const violation of evaluatePlacement(
      session('a', { startTime: '17:00', endTime: '19:00' }),
      clash,
      hostile,
    )) {
      fired.add(violation.constraint)
    }

    expect([...fired].sort()).toEqual([...HARD_CONSTRAINTS].sort())
  })
})

describe('soft constraints', () => {
  const avoidTeacher = teacher('t1', {
    availability: [
      { weekday: 1, startTime: '08:00', endTime: '12:00', level: 'available' },
      { weekday: 1, startTime: '12:00', endTime: '20:00', level: 'avoid' },
      { weekday: 2, startTime: '08:00', endTime: '20:00', level: 'available' },
      { weekday: 3, startTime: '08:00', endTime: '20:00', level: 'available' },
      { weekday: 4, startTime: '08:00', endTime: '20:00', level: 'available' },
    ],
  })

  it('penalises teaching in a slot marked "better avoided"', () => {
    const penalties = evaluateSoft(
      [session('a', { startTime: '13:00', endTime: '15:00' })],
      context({ teachers: [avoidTeacher] }),
    )

    const avoid = penalties.find((entry) => entry.constraint === 'avoidSlot')
    expect(avoid).toMatchObject({ amount: 2, weight: 5, cost: 10 })
    expect(avoid?.messageKey).toBe('planner.soft.avoidSlot')
  })

  it('penalises the gap between two classes on the same day', () => {
    const penalties = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '09:00' }),
        session('b', { groupId: 'g2', startTime: '12:00', endTime: '13:00' }),
      ],
      context(),
    )

    expect(penalties.find((entry) => entry.constraint === 'teacherGaps')).toMatchObject({
      amount: 3,
      weight: 4,
      cost: 12,
    })
  })

  it('does not invent a gap between back-to-back classes', () => {
    const penalties = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '09:00' }),
        session('b', { groupId: 'g2', startTime: '09:00', endTime: '10:00' }),
      ],
      context(),
    )
    expect(penalties.map((entry) => entry.constraint)).not.toContain('teacherGaps')
  })

  it('penalises a day with a single session', () => {
    const alone = evaluateSoft([session('a')], context())
    expect(alone.find((entry) => entry.constraint === 'singleSessionDay')).toMatchObject({
      amount: 1,
      cost: 3,
    })

    const paired = evaluateSoft(
      [session('a'), session('b', { groupId: 'g2', startTime: '11:00', endTime: '12:00' })],
      context(),
    )
    expect(paired.map((entry) => entry.constraint)).not.toContain('singleSessionDay')
  })

  it('penalises moving building between consecutive sessions', () => {
    const twoBuildings = context({
      spaces: [space('s1', { building: 'A' }), space('s2', { building: 'B' })],
    })
    const penalties = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '09:00' }),
        session('b', { groupId: 'g2', spaceId: 's2', startTime: '09:00', endTime: '10:00' }),
      ],
      twoBuildings,
    )

    expect(penalties.find((entry) => entry.constraint === 'buildingChange')).toMatchObject({
      amount: 1,
      weight: 2,
      cost: 2,
    })
  })

  it('penalises only the hours beyond the consecutive limit, counting short breaks as continuous', () => {
    // 08:00–11:00 and 11:15–13:00 with a 15-minute break, against a 30-minute
    // minimum break and a four-hour limit: one continuous run of 5 h, so 1 h over.
    const penalties = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '11:00' }),
        session('b', { groupId: 'g2', startTime: '11:15', endTime: '13:00' }),
      ],
      context(),
    )

    expect(penalties.find((entry) => entry.constraint === 'consecutiveHours')).toMatchObject({
      amount: 1,
      weight: 4,
    })
  })

  it('treats a proper break as the end of a run', () => {
    const penalties = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '11:00' }),
        session('b', { groupId: 'g2', startTime: '12:00', endTime: '14:00' }),
      ],
      context(),
    )
    expect(penalties.map((entry) => entry.constraint)).not.toContain('consecutiveHours')
  })

  it('penalises a group whose sessions are bunched into one day', () => {
    const bunched = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '09:00' }),
        session('b', { startTime: '09:00', endTime: '10:00' }),
      ],
      context(),
    )
    expect(bunched.find((entry) => entry.constraint === 'weeklySpread')).toMatchObject({
      amount: 1,
      weight: 2,
      groupId: 'g1',
    })

    const spread = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '09:00' }),
        session('b', { weekday: 3, startTime: '09:00', endTime: '10:00' }),
      ],
      context(),
    )
    expect(spread.map((entry) => entry.constraint)).not.toContain('weeklySpread')
  })

  it('honours the center’s weights, and a weight of zero switches a rule off', () => {
    const settings = parseCenterSettings({
      engine: { weights: { teacherGaps: 10, singleSessionDay: 0 } },
    })
    const penalties = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '09:00' }),
        session('b', { groupId: 'g2', startTime: '12:00', endTime: '13:00' }),
      ],
      context({ settings }),
    )

    expect(penalties.find((entry) => entry.constraint === 'teacherGaps')?.cost).toBe(30)
    expect(penalties.map((entry) => entry.constraint)).not.toContain('singleSessionDay')
  })

  it('fires every declared soft constraint on a deliberately bad week', () => {
    const twoBuildings = context({
      teachers: [avoidTeacher],
      spaces: [space('s1', { building: 'A' }), space('s2', { building: 'B' })],
    })
    const penalties = evaluateSoft(
      [
        session('a', { startTime: '08:00', endTime: '12:00' }),
        session('b', { groupId: 'g1', spaceId: 's2', startTime: '12:15', endTime: '14:00' }),
        session('c', { groupId: 'g2', weekday: 2, startTime: '08:00', endTime: '09:00' }),
        // The same person on two groups at once, on a day of its own so it
        // says nothing about the rest of the week: allowed, and costed rather
        // than refused.
        session('d', { groupId: 'g1', weekday: 3, startTime: '10:00', endTime: '11:00' }),
        session('e', {
          groupId: 'g2',
          spaceId: 's2',
          weekday: 3,
          startTime: '10:00',
          endTime: '11:00',
        }),
      ],
      twoBuildings,
    )

    expect(new Set(penalties.map((entry) => entry.constraint))).toEqual(new Set(SOFT_CONSTRAINTS))
  })
})

describe('whole-week scoring', () => {
  it('counts a collision once, not once per session involved', () => {
    // Two groups in the same room: that one cannot happen at all.
    const score = scoreSchedule(
      [session('a'), session('b', { groupId: 'g2', teacherProfileId: 't2' })],
      context(),
    )

    expect(score.violations).toHaveLength(1)
    expect(score.feasible).toBe(false)
  })

  it('costs a teacher’s own clash once, and keeps the week publishable', () => {
    const score = scoreSchedule(
      [session('a'), session('b', { groupId: 'g2', spaceId: 's2' })],
      context(),
    )

    expect(score.violations).toEqual([])
    expect(score.feasible).toBe(true)
    expect(
      score.penalties.filter((penalty) => penalty.constraint === 'teacherOverlap'),
    ).toHaveLength(1)
  })

  it('adds up the soft cost of a legal week', () => {
    const score = scoreSchedule([session('a')], context())

    expect(score.feasible).toBe(true)
    expect(score.softCost).toBe(score.penalties.reduce((total, entry) => total + entry.cost, 0))
  })
})

describe('planner cells', () => {
  it('paints green when a placement costs nothing extra', () => {
    const existing = [
      session('b', { groupId: 'g2', weekday: 2, startTime: '08:00', endTime: '10:00' }),
    ]
    const cell = evaluateCell(
      session('a', { weekday: 2, startTime: '10:00', endTime: '12:00', spaceId: 's2' }),
      existing,
      context(),
    )

    expect(cell.status).toBe('valid')
  })

  it('paints amber with the reason when a placement is legal but costs something', () => {
    const avoidAfternoons = teacher('t1', {
      availability: [
        { weekday: 1, startTime: '08:00', endTime: '12:00', level: 'available' },
        { weekday: 1, startTime: '12:00', endTime: '20:00', level: 'avoid' },
      ],
    })
    const cell = evaluateCell(
      session('a', { startTime: '13:00', endTime: '15:00' }),
      [],
      context({ teachers: [avoidAfternoons] }),
    )

    expect(cell.status).toBe('warning')
    expect(cell.penalties.map((entry) => entry.messageKey)).toContain('planner.soft.avoidSlot')
  })

  it('paints red with the blocking reason, and never a warning as well', () => {
    // Two groups in one room at one hour: nothing to weigh up.
    const cell = evaluateCell(
      session('a'),
      [session('b', { groupId: 'g2', teacherProfileId: 't2' })],
      context(),
    )

    expect(cell.status).toBe('blocked')
    expect(cell.violations[0]?.messageKey).toBe('planner.hard.spaceOverlap')
    expect(cell.penalties).toEqual([])
  })

  it('only reports the penalties the candidate itself adds', () => {
    // The existing pair already changes building; adding a third session in
    // the same building must not be blamed for it.
    const twoBuildings = context({
      spaces: [space('s1', { building: 'A' }), space('s2', { building: 'B' })],
    })
    const existing = [
      session('a', { startTime: '08:00', endTime: '09:00' }),
      session('b', { groupId: 'g2', spaceId: 's2', startTime: '09:00', endTime: '10:00' }),
    ]
    const cell = evaluateCell(
      session('c', {
        groupId: 'g2',
        spaceId: 's2',
        weekday: 3,
        startTime: '08:00',
        endTime: '10:00',
      }),
      existing,
      twoBuildings,
    )

    expect(cell.penalties.map((entry) => entry.constraint)).not.toContain('buildingChange')
  })
})

describe('the planner summary', () => {
  it('reports what the bottom bar shows', () => {
    const summary = summarizePlan(
      // Two groups in one room: one thing that cannot happen.
      [session('a'), session('b', { groupId: 'g2', teacherProfileId: 't2' })],
      3,
      context(),
    )

    expect(summary).toMatchObject({ placed: 2, pending: 3, blocked: 1 })
  })

  it('counts teachers whose hours fall outside the contracted range', () => {
    const settings = parseCenterSettings({})
    const teachers = [teacher('t1', { capacityHours: 8 }), teacher('t2', { capacityHours: 8 })]
    // t1 gets 2 h of 8 (under), t2 gets nothing at all and is not counted.
    const summary = summarizePlan([session('a')], 0, context({ settings, teachers }))

    expect(summary.teachersOutOfRange).toBe(1)
  })
})

describe('weekly geometry', () => {
  it('turns an annual contract into a weekly ceiling with the center’s teaching weeks', () => {
    expect(weeklyCapacityFrom(240, parseCenterSettings({}))).toBe(8)
    expect(weeklyCapacityFrom(240, parseCenterSettings({ schedule: { teachingWeeks: 40 } }))).toBe(
      6,
    )
  })

  it('offers slots only inside the center’s working days and hours', () => {
    const slots = candidateSlots(
      parseCenterSettings({
        schedule: { dayStart: '09:00', dayEnd: '12:00', slotMinutes: 60, workingWeekdays: [1, 2] },
      }),
      120,
    )

    expect(slots).toEqual([
      { weekday: 1, startTime: '09:00', endTime: '11:00' },
      { weekday: 1, startTime: '10:00', endTime: '12:00' },
      { weekday: 2, startTime: '09:00', endTime: '11:00' },
      { weekday: 2, startTime: '10:00', endTime: '12:00' },
    ])
  })
})

describe('a class given by two people', () => {
  it('will not place it when the second of them is not available then', () => {
    const afternoon = session('a', {
      teacherProfileId: 't1',
      coTeacherIds: ['t2'],
      startTime: '15:00',
      endTime: '16:00',
    })

    const violations = evaluatePlacement(
      afternoon,
      [],
      context({
        // t1 works afternoons too; t2 does not.
        teachers: [
          teacher('t1', {
            availability: [
              { weekday: 1, startTime: '08:00', endTime: '20:00', level: 'available' },
            ],
          }),
          teacher('t2'),
        ],
      }),
    )

    expect(constraintsOf(violations)).toEqual(['teacherUnavailable'])
  })

  it('spends the hour out of both contracts, not just the first one’s', () => {
    const shared = session('a', {
      teacherProfileId: 't1',
      coTeacherIds: ['t2'],
      ...on('2026-09-14'),
    })
    // t2's contract of eight hours is already spent on their own classes.
    const theirOwn = [
      session('b', {
        teacherProfileId: 't2',
        groupId: 'g2',
        weekday: 2,
        startTime: '09:00',
        endTime: '13:00',
        ...on('2026-09-15'),
      }),
      session('c', {
        teacherProfileId: 't2',
        groupId: 'g2',
        weekday: 3,
        startTime: '09:00',
        endTime: '13:00',
        ...on('2026-09-16'),
      }),
    ]

    const violations = evaluatePlacement(
      shared,
      theirOwn,
      context({ teachers: [teacher('t1'), teacher('t2', { capacityHours: 8 })] }),
    )

    expect(constraintsOf(violations)).toEqual(['teacherCapacity'])
  })

  it('counts the class in the hours of everyone giving it', () => {
    const summary = summarizePlan(
      [session('a', { teacherProfileId: 't1', coTeacherIds: ['t2'], ...on('2026-09-14') })],
      0,
      context({
        teachers: [teacher('t1', { capacityHours: 2 }), teacher('t2', { capacityHours: 20 })],
      }),
    )

    // t1 is at their two hours; t2 has two of twenty, and is under-loaded.
    expect(summary.teachersOutOfRange).toBe(1)
  })
})
