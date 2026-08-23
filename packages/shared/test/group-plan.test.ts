/**
 * How much of a group is still to place, which is what the planner's side
 * column counts down as classes land.
 *
 * Against the year, not against a typical week: classes are placed one date at
 * a time until the term ends, so a countdown against one week would read as
 * finished with most of the year still empty.
 */
import { describe, expect, it } from 'vitest'

import { groupPlanState, minutesToHours } from '../src/domain/group-plan.js'

const state = (placedMinutes: number, plannedHours = 60) =>
  groupPlanState({ plannedHours, sessionMinutes: 60, placedMinutes })

describe('what a group still needs', () => {
  it('counts the whole year of teaching, not one week of it', () => {
    // 60 hours for the year is 60 hours to place.
    expect(state(0).targetMinutes).toBe(3600)
    expect(state(0).remainingMinutes).toBe(3600)
  })

  it('counts down as classes are placed', () => {
    expect(state(60).remainingMinutes).toBe(3540)
    expect(state(1800).remainingMinutes).toBe(1800)
    expect(state(3600).remainingMinutes).toBe(0)
  })

  it('says when there is nothing left to place', () => {
    expect(state(3540).complete).toBe(false)
    expect(state(3600).complete).toBe(true)
  })

  it('reports more than enough as overplanned, not as negative work', () => {
    const over = state(3660)

    expect(over.remainingMinutes).toBe(0)
    expect(over.overplannedMinutes).toBe(60)
    expect(over.sessionsRemaining).toBe(0)
    expect(over.complete).toBe(true)
  })

  it('counts a part session as a whole one still to place', () => {
    // Half an hour left of a group taught in hour-long classes still needs a
    // class placing for it.
    const half = groupPlanState({
      plannedHours: 45.5,
      sessionMinutes: 60,
      placedMinutes: 45 * 60,
    })

    expect(half.remainingMinutes).toBe(30)
    expect(half.sessionsRemaining).toBe(1)
  })

  it('counts in the classes this group is actually taught in', () => {
    // A three-hour lab of 45 annual hours is fifteen classes, not forty-five.
    expect(
      groupPlanState({ plannedHours: 45, sessionMinutes: 180, placedMinutes: 0 }).sessionsRemaining,
    ).toBe(15)
  })

  it('rounds the target to the minute', () => {
    // 45.5 hours is 2730 minutes, not 2729.9999999.
    expect(
      groupPlanState({ plannedHours: 45.5, sessionMinutes: 60, placedMinutes: 0 }).targetMinutes,
    ).toBe(2730)
  })

  it('survives a center with nonsense in its parameters', () => {
    // Zero-minute sessions would never finish, which is not worth crashing
    // the planner for.
    const broken = groupPlanState({ plannedHours: 60, sessionMinutes: 0, placedMinutes: 0 })

    expect(Number.isFinite(broken.targetMinutes)).toBe(true)
    expect(Number.isFinite(broken.sessionsRemaining)).toBe(true)
  })

  it('has nothing to place for a group with no hours', () => {
    expect(state(0, 0)).toMatchObject({ targetMinutes: 0, complete: true })
  })
})

describe('minutes as hours', () => {
  it('is exact where it can be and short where it cannot', () => {
    expect(minutesToHours(120)).toBe(2)
    expect(minutesToHours(90)).toBe(1.5)
    expect(minutesToHours(50)).toBe(0.83)
  })
})
