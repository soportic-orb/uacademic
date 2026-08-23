import { describe, expect, it } from 'vitest'

import { parseCenterSettings } from '../src/domain/settings.js'
import {
  type AssignmentDetail,
  type CenterLoadRow,
  computeWorkload,
  conceptTotals,
  filterLoadRows,
  groupBySubject,
  sortLoadRows,
  withTimetabledTeaching,
} from '../src/domain/workload.js'

function assignment(overrides: Partial<AssignmentDetail> = {}): AssignmentDetail {
  return {
    subjectId: 'subject-1',
    subjectCode: 'MAT101',
    subjectName: 'Matemàtiques I',
    groupId: 'group-1',
    groupCode: 'T1',
    concept: 'lecture',
    hours: 30,
    ...overrides,
  }
}

describe('concept totals', () => {
  it('returns every concept in the canonical order, zeros included', () => {
    const totals = conceptTotals([
      assignment({ concept: 'lecture', hours: 60 }),
      assignment({ concept: 'tutoring', hours: 20 }),
    ])

    expect(totals.map((total) => total.concept)).toEqual([
      'lecture',
      'tutoring',
      'coordination',
      'tfg',
      'other',
    ])
    expect(totals.map((total) => total.hours)).toEqual([60, 20, 0, 0, 0])
    expect(totals[0]?.percent).toBe(75)
    expect(totals[3]?.percent).toBe(0)
  })

  it('takes the total from the caller so shares match the load computation', () => {
    // The chart must add up to the teacher's assigned hours, not to the hours
    // of the subset it was handed.
    const totals = conceptTotals([assignment({ concept: 'tfg', hours: 25 })], 100)
    expect(totals.find((total) => total.concept === 'tfg')?.percent).toBe(25)
  })

  it('does not divide by zero when nothing is assigned', () => {
    expect(conceptTotals([]).every((total) => total.hours === 0 && total.percent === 0)).toBe(true)
  })
})

describe('breakdown by subject', () => {
  const assignments = [
    assignment({ subjectId: 's1', subjectCode: 'MAT101', concept: 'lecture', hours: 40 }),
    assignment({
      subjectId: 's1',
      subjectCode: 'MAT101',
      groupId: 'g2',
      groupCode: 'P1',
      concept: 'lecture',
      hours: 20,
    }),
    assignment({ subjectId: 's1', subjectCode: 'MAT101', concept: 'tutoring', hours: 10 }),
    assignment({
      subjectId: 's2',
      subjectCode: 'FIS201',
      subjectName: 'Física',
      concept: 'lecture',
      hours: 30,
    }),
    assignment({
      subjectId: 's3',
      subjectCode: 'TFG',
      subjectName: 'Treball final',
      groupId: null,
      groupCode: null,
      concept: 'tfg',
      hours: 12,
    }),
  ]

  it('orders subjects by hours, heaviest first', () => {
    expect(groupBySubject(assignments).map((subject) => subject.subjectCode)).toEqual([
      'MAT101',
      'FIS201',
      'TFG',
    ])
  })

  it('adds up the groups and the concepts of each subject', () => {
    const [mat] = groupBySubject(assignments)

    expect(mat?.hours).toBe(70)
    expect(mat?.percent).toBe(62.5)
    expect(mat?.groups).toEqual([
      { groupId: 'group-1', groupCode: 'T1', hours: 50 },
      { groupId: 'g2', groupCode: 'P1', hours: 20 },
    ])
    // Only the concepts that actually carry hours, so the row stays readable.
    expect(mat?.byConcept.map((entry) => [entry.concept, entry.hours])).toEqual([
      ['lecture', 60],
      ['tutoring', 10],
    ])
  })

  it('keeps assignments with no group, such as final projects', () => {
    const tfg = groupBySubject(assignments).find((subject) => subject.subjectCode === 'TFG')
    expect(tfg?.groups).toEqual([{ groupId: null, groupCode: null, hours: 12 }])
  })

  it('breaks ties on the subject code so the order is stable', () => {
    const tied = [
      assignment({ subjectId: 'b', subjectCode: 'ZOO100', hours: 10 }),
      assignment({ subjectId: 'a', subjectCode: 'ANT100', hours: 10 }),
    ]
    expect(groupBySubject(tied).map((subject) => subject.subjectCode)).toEqual(['ANT100', 'ZOO100'])
  })
})

describe('teacher workload', () => {
  const input = {
    contractedHours: 240,
    reductions: [
      { hours: 40, approved: true },
      { hours: 20, approved: false },
    ],
    assignments: [
      assignment({ concept: 'lecture', hours: 120 }),
      assignment({ subjectId: 's2', subjectCode: 'FIS201', concept: 'tutoring', hours: 40 }),
      assignment({ subjectId: 's3', subjectCode: 'TFG', concept: 'tfg', hours: 20 }),
    ],
  }

  it('follows the model: capacity − reductions, workload by concept, ratio', () => {
    const workload = computeWorkload(input)

    expect(workload.capacityHours).toBe(200)
    expect(workload.assignedHours).toBe(180)
    expect(workload.ratioPercent).toBe(90)
    expect(workload.status).toBe('optimal')
    expect(workload.bySubject).toHaveLength(3)
    expect(workload.conceptTotals.find((total) => total.concept === 'lecture')?.percent).toBe(66.67)
  })

  it('reads the traffic light from the center settings, not from constants', () => {
    // Same numbers, a stricter center: 90 % now counts as under-loaded.
    const settings = parseCenterSettings({
      load: { thresholds: { underBelow: 95, optimalUpTo: 105, limitUpTo: 115 } },
    })

    expect(computeWorkload(input, settings.load.thresholds).status).toBe('under')
    expect(computeWorkload(input, parseCenterSettings({}).load.thresholds).status).toBe('optimal')
  })

  it('describes a teacher with no assignments without breaking', () => {
    const workload = computeWorkload({ contractedHours: 120 })

    expect(workload.assignedHours).toBe(0)
    expect(workload.bySubject).toEqual([])
    expect(workload.conceptTotals).toHaveLength(5)
    expect(workload.status).toBe('under')
  })
})

describe('center load table', () => {
  const row = (overrides: Partial<CenterLoadRow>): CenterLoadRow => ({
    teacherProfileId: 'p1',
    userId: 'u1',
    firstName: 'Marta',
    lastName: 'Puig Serra',
    avatarUrl: null,
    category: 'associate_professor',
    dedication: 'full_time',
    contractedHours: 240,
    reductionHours: 0,
    capacityHours: 240,
    assignedHours: 216,
    remainingHours: 24,
    ratioPercent: 90,
    status: 'optimal',
    degreeIds: ['d1'],
    ...overrides,
  })

  const rows = [
    row({}),
    row({
      teacherProfileId: 'p2',
      userId: 'u2',
      firstName: 'Sergi',
      lastName: 'Vila Rovira',
      category: 'adjunct',
      capacityHours: 120,
      assignedHours: 60,
      ratioPercent: 50,
      status: 'under',
      degreeIds: ['d2'],
    }),
    row({
      teacherProfileId: 'p3',
      userId: 'u3',
      firstName: 'Aina',
      lastName: 'Mestre Pons',
      capacityHours: 180,
      assignedHours: 210,
      ratioPercent: 116.67,
      status: 'over',
      degreeIds: ['d1', 'd2'],
    }),
    row({
      teacherProfileId: 'p4',
      userId: 'u4',
      firstName: 'Pau',
      lastName: 'Torres Gil',
      capacityHours: 0,
      assignedHours: 0,
      ratioPercent: null,
      status: 'under',
      degreeIds: [],
    }),
  ]

  it('filters by degree, category and traffic-light status', () => {
    expect(filterLoadRows(rows, { degreeId: 'd2' }).map((r) => r.teacherProfileId)).toEqual([
      'p2',
      'p3',
    ])
    expect(filterLoadRows(rows, { category: 'adjunct' }).map((r) => r.teacherProfileId)).toEqual([
      'p2',
    ])
    expect(filterLoadRows(rows, { status: 'over' }).map((r) => r.teacherProfileId)).toEqual(['p3'])
  })

  it('combines the filters and searches the full name, ignoring case and padding', () => {
    expect(filterLoadRows(rows, { degreeId: 'd1', status: 'optimal' })).toHaveLength(1)
    expect(filterLoadRows(rows, { search: '  mestre ' }).map((r) => r.firstName)).toEqual(['Aina'])
    expect(filterLoadRows(rows, { search: 'AINA MESTRE' })).toHaveLength(1)
    expect(filterLoadRows(rows, {})).toHaveLength(4)
  })

  it('sorts by name, hours and ratio', () => {
    expect(sortLoadRows(rows, 'name').map((r) => r.lastName)).toEqual([
      'Mestre Pons',
      'Puig Serra',
      'Torres Gil',
      'Vila Rovira',
    ])
    expect(sortLoadRows(rows, 'assigned', 'desc').map((r) => r.assignedHours)).toEqual([
      216, 210, 60, 0,
    ])
    // No capacity means no ratio: those teachers sort last, never first.
    expect(sortLoadRows(rows, 'ratio').map((r) => r.ratioPercent)).toEqual([null, 50, 90, 116.67])
  })

  it('puts the problems first when sorting by status', () => {
    expect(sortLoadRows(rows, 'status').map((r) => r.status)).toEqual([
      'over',
      'under',
      'under',
      'optimal',
    ])
  })

  it('never mutates the array it was given', () => {
    const original = [...rows]
    sortLoadRows(rows, 'ratio', 'desc')
    expect(rows).toEqual(original)
  })
})

describe('teaching that only exists on the timetable', () => {
  const timetabled = {
    subjectId: 's2',
    subjectCode: 'ALG201',
    subjectName: 'Algorísmica',
    groupId: 'g9',
    groupCode: 'T1',
    minutes: 90,
  }

  it('counts a group somebody teaches and holds no assignment on', () => {
    const result = withTimetabledTeaching([], [timetabled])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ groupId: 'g9', concept: 'lecture', hours: 1.5 })
  })

  it('leaves the teaching order alone where there is one', () => {
    const assignment: AssignmentDetail = {
      subjectId: 's2',
      subjectCode: 'ALG201',
      subjectName: 'Algorísmica',
      groupId: 'g9',
      groupCode: 'T1',
      concept: 'lecture',
      hours: 60,
    }

    // Sixty hours were agreed; an hour and a half of them are on the calendar
    // so far, and that is not a second commitment.
    expect(withTimetabledTeaching([assignment], [timetabled])).toEqual([assignment])
  })

  it('ignores a group with nothing placed yet', () => {
    expect(withTimetabledTeaching([], [{ ...timetabled, minutes: 0 }])).toEqual([])
  })
})
