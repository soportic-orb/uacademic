/**
 * How much of a group is still to place, which is what the planner's side
 * column counts down as classes land.
 */
import { describe, expect, it } from 'vitest'

import { groupPlanState, minutesToHours } from '../src/domain/group-plan.js'

const state = (placedMinutes: number, plannedHours = 60) =>
  groupPlanState({ plannedHours, teachingWeeks: 30, sessionMinutes: 60, placedMinutes })

describe('what a group still needs', () => {
  it('turns a year of hours into one typical week', () => {
    // 60 hours over 30 weeks is two hours a week.
    expect(state(0).weeklyTargetMinutes).toBe(120)
  })

  it('counts down as classes are placed', () => {
    expect(state(0).remainingMinutes).toBe(120)
    expect(state(60).remainingMinutes).toBe(60)
    expect(state(120).remainingMinutes).toBe(0)
  })

  it('says when there is nothing left to place', () => {
    expect(state(60).complete).toBe(false)
    expect(state(120).complete).toBe(true)
  })

  it('reports more than enough as overplanned, not as negative work', () => {
    const over = state(180)

    expect(over.remainingMinutes).toBe(0)
    expect(over.overplannedMinutes).toBe(60)
    expect(over.sessionsRemaining).toBe(0)
    expect(over.complete).toBe(true)
  })

  it('counts a part session as a whole one still to place', () => {
    // 45 hours over 30 weeks is 90 minutes a week: one hour placed leaves
    // half an hour, which still needs a class placing for it.
    const half = groupPlanState({
      plannedHours: 45,
      teachingWeeks: 30,
      sessionMinutes: 60,
      placedMinutes: 60,
    })

    expect(half.remainingMinutes).toBe(30)
    expect(half.sessionsRemaining).toBe(1)
  })

  it('rounds the weekly target to the minute', () => {
    // 40 hours over 30 weeks is 80 minutes, not 79.9999999.
    expect(
      groupPlanState({
        plannedHours: 40,
        teachingWeeks: 30,
        sessionMinutes: 60,
        placedMinutes: 0,
      }).weeklyTargetMinutes,
    ).toBe(80)
  })

  it('survives a center with nonsense in its parameters', () => {
    // Zero teaching weeks would divide by zero and zero-minute sessions would
    // never finish; neither is worth crashing the planner for.
    const broken = groupPlanState({
      plannedHours: 60,
      teachingWeeks: 0,
      sessionMinutes: 0,
      placedMinutes: 0,
    })

    expect(Number.isFinite(broken.weeklyTargetMinutes)).toBe(true)
    expect(Number.isFinite(broken.sessionsRemaining)).toBe(true)
  })

  it('has nothing to place for a group with no hours', () => {
    expect(state(0, 0)).toMatchObject({ weeklyTargetMinutes: 0, complete: true })
  })
})

describe('minutes as hours', () => {
  it('is exact where it can be and short where it cannot', () => {
    expect(minutesToHours(120)).toBe(2)
    expect(minutesToHours(90)).toBe(1.5)
    expect(minutesToHours(50)).toBe(0.83)
  })
})
