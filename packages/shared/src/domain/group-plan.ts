/**
 * How much of a group is still to be placed on the timetable.
 *
 * A group carries the hours it needs across the year, and that is what this
 * counts down: classes are placed one date at a time, all the way to the end
 * of the term, so "still to place" is the year's work minus what is already
 * on the calendar. It used to divide the year into a typical week, which was
 * the arithmetic of a planner that repeated a week — it no longer does, and a
 * countdown against one week reads as finished while most of the year is
 * empty.
 *
 * It lives here, with tests, rather than inside a component (R7): getting it
 * wrong means a coordinator either stops too early or keeps placing classes
 * nobody asked for.
 */
export interface GroupPlanInput {
  /** Teaching hours the group needs across the year. */
  plannedHours: number
  /** How long one class of this group lasts, in minutes. */
  sessionMinutes: number
  /** Minutes already placed for this group, across the whole year. */
  placedMinutes: number
}

export interface GroupPlanState {
  /** The year's teaching for this group, in minutes. */
  targetMinutes: number
  placedMinutes: number
  /** Still to place. Never negative — see `overplannedMinutes`. */
  remainingMinutes: number
  /** Placed beyond the target, which is a decision rather than an error. */
  overplannedMinutes: number
  /** Whole classes still to place, at this group's length. */
  sessionsRemaining: number
  complete: boolean
}

export function groupPlanState(input: GroupPlanInput): GroupPlanState {
  const session = Math.max(1, input.sessionMinutes)

  // Rounded to the minute: hours are decimal, and carrying the fraction would
  // show "1 h 20 m and 0.000001 left to place".
  const targetMinutes = Math.round(input.plannedHours * 60)
  const placedMinutes = Math.max(0, input.placedMinutes)
  const difference = targetMinutes - placedMinutes

  return {
    targetMinutes,
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
