/**
 * How much of a group is still to be placed on the timetable.
 *
 * A group carries the hours it needs over the whole year; the planner works on
 * one typical week. Turning one into the other is the arithmetic the side
 * column lives on, and getting it wrong means a coordinator either stops too
 * early or keeps placing classes nobody asked for — so it lives here, with
 * tests, rather than inside a component (R7).
 */
export interface GroupPlanInput {
  /** Teaching hours the group needs across the year. */
  plannedHours: number
  /** Teaching weeks in the year, from the center's parameters. */
  teachingWeeks: number
  /** The center's default session length, in minutes. */
  sessionMinutes: number
  /** Minutes already placed for this group in the week being planned. */
  placedMinutes: number
}

export interface GroupPlanState {
  /** What one week of this group ought to hold. */
  weeklyTargetMinutes: number
  placedMinutes: number
  /** Still to place. Never negative — see `overplannedMinutes`. */
  remainingMinutes: number
  /** Placed beyond the target, which is a decision rather than an error. */
  overplannedMinutes: number
  /** Whole sessions still to place, at the center's default length. */
  sessionsRemaining: number
  complete: boolean
}

export function groupPlanState(input: GroupPlanInput): GroupPlanState {
  const weeks = Math.max(1, input.teachingWeeks)
  const session = Math.max(1, input.sessionMinutes)

  // Rounded to the minute: a group of 45 annual hours over 30 weeks is 90
  // minutes a week exactly, and one of 40 is 80. Carrying the fraction would
  // show "1 h 20 m and 0.000001 left to place".
  const weeklyTargetMinutes = Math.round((input.plannedHours / weeks) * 60)
  const placedMinutes = Math.max(0, input.placedMinutes)
  const difference = weeklyTargetMinutes - placedMinutes

  return {
    weeklyTargetMinutes,
    placedMinutes,
    remainingMinutes: Math.max(0, difference),
    overplannedMinutes: Math.max(0, -difference),
    // Half a session left still needs a session placed for it.
    sessionsRemaining: Math.max(0, Math.ceil(difference / session)),
    complete: difference <= 0,
  }
}

/** Decimal hours from minutes, for a figure somebody reads. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}
