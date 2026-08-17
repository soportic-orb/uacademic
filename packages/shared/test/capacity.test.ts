import { describe, expect, it } from 'vitest'

import {
  computeGroupCoverage,
  computeTeacherLoad,
  effectiveCapacityHours,
  loadStatusFromRatio,
  summarizeLoads,
} from '../src/domain/capacity.js'

describe('effective capacity', () => {
  it('subtracts only approved reductions', () => {
    expect(
      effectiveCapacityHours({
        contractedHours: 240,
        reductions: [
          { hours: 30, approved: true },
          { hours: 60, approved: false },
        ],
      }),
    ).toBe(210)
  })

  it('never goes below zero', () => {
    expect(
      effectiveCapacityHours({
        contractedHours: 100,
        reductions: [{ hours: 150, approved: true }],
      }),
    ).toBe(0)
  })
})

describe('traffic light boundaries', () => {
  it('follows the ranges of the design system', () => {
    expect(loadStatusFromRatio(0)).toBe('under')
    expect(loadStatusFromRatio(84.99)).toBe('under')
    expect(loadStatusFromRatio(85)).toBe('optimal')
    expect(loadStatusFromRatio(100)).toBe('optimal')
    expect(loadStatusFromRatio(100.01)).toBe('limit')
    expect(loadStatusFromRatio(110)).toBe('limit')
    expect(loadStatusFromRatio(110.01)).toBe('over')
  })

  it('honours center-specific thresholds', () => {
    const thresholds = { underBelow: 70, optimalUpTo: 95, limitUpTo: 105 }
    expect(loadStatusFromRatio(80, thresholds)).toBe('optimal')
    expect(loadStatusFromRatio(100, thresholds)).toBe('limit')
    expect(loadStatusFromRatio(106, thresholds)).toBe('over')
  })
})

describe('teacher load', () => {
  it('computes capacity, occupancy and the remaining hours', () => {
    const load = computeTeacherLoad({
      contractedHours: 240,
      reductions: [{ hours: 40, approved: true }],
      assignments: [
        { concept: 'lecture', hours: 120 },
        { concept: 'lecture', hours: 30 },
        { concept: 'tutoring', hours: 20 },
        { concept: 'coordination', hours: 10 },
      ],
    })

    expect(load.capacityHours).toBe(200)
    expect(load.assignedHours).toBe(180)
    expect(load.remainingHours).toBe(20)
    expect(load.ratioPercent).toBe(90)
    expect(load.status).toBe('optimal')
    expect(load.byConcept.lecture).toBe(150)
    expect(load.byConcept.tfg).toBe(0)
  })

  it('flags overload above the limit', () => {
    const load = computeTeacherLoad({
      contractedHours: 100,
      assignments: [{ concept: 'lecture', hours: 115 }],
    })
    expect(load.ratioPercent).toBe(115)
    expect(load.status).toBe('over')
    expect(load.remainingHours).toBe(-15)
  })

  it('never reports Infinity when capacity is zero', () => {
    const withHours = computeTeacherLoad({
      contractedHours: 0,
      assignments: [{ concept: 'lecture', hours: 10 }],
    })
    expect(withHours.ratioPercent).toBeNull()
    expect(withHours.status).toBe('over')

    const idle = computeTeacherLoad({ contractedHours: 0 })
    expect(idle.ratioPercent).toBe(0)
    expect(idle.status).toBe('under')
  })

  it('keeps two-decimal precision on repeated fractional hours', () => {
    const load = computeTeacherLoad({
      contractedHours: 30,
      assignments: Array.from({ length: 3 }, () => ({ concept: 'lecture' as const, hours: 0.1 })),
    })
    expect(load.assignedHours).toBe(0.3)
    expect(load.remainingHours).toBe(29.7)
  })
})

describe('group coverage', () => {
  it('classifies uncovered, partial, covered and over-covered groups', () => {
    expect(computeGroupCoverage(60, []).status).toBe('uncovered')
    expect(computeGroupCoverage(60, [{ concept: 'lecture', hours: 30 }]).status).toBe('partial')
    expect(computeGroupCoverage(60, [{ concept: 'lecture', hours: 60 }]).status).toBe('covered')
    expect(computeGroupCoverage(60, [{ concept: 'lecture', hours: 75 }]).remainingHours).toBe(-15)
    expect(computeGroupCoverage(60, [{ concept: 'lecture', hours: 75 }]).status).toBe('over')
  })
})

describe('center summary', () => {
  it('aggregates capacity, assignment and the traffic-light census', () => {
    const summary = summarizeLoads([
      computeTeacherLoad({ contractedHours: 100, assignments: [{ concept: 'lecture', hours: 50 }] }),
      computeTeacherLoad({ contractedHours: 100, assignments: [{ concept: 'lecture', hours: 95 }] }),
      computeTeacherLoad({
        contractedHours: 100,
        assignments: [{ concept: 'lecture', hours: 130 }],
      }),
    ])

    expect(summary.teachers).toBe(3)
    expect(summary.totalCapacityHours).toBe(300)
    expect(summary.totalAssignedHours).toBe(275)
    expect(summary.ratioPercent).toBe(91.67)
    expect(summary.byStatus).toEqual({ under: 1, optimal: 1, limit: 0, over: 1 })
  })
})
