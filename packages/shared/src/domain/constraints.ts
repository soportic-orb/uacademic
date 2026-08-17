/**
 * The constraint engine (R7): what makes a timetable illegal, and what merely
 * makes it worse.
 *
 * Hard constraints block. They are facts about the world — a person cannot be
 * in two rooms at once — and no weight can trade them away.
 *
 * Soft constraints penalise. Their weights live in `centers.settings_json`
 * (R9), because "a gap between classes is worse than changing building" is a
 * judgement each center makes for itself.
 *
 * Every violation carries an i18n key and its parameters rather than a
 * sentence (R1): the planner tooltip, the generator's explanation and the
 * assistant all render the same fact in the reader's language.
 */
import { type AvailabilityEntry, effectiveAvailability } from './availability.js'
import { type SessionConflict, type SessionLike, findConflictsFor } from './conflicts.js'
import type { CenterSettings } from './settings.js'
import { type ClockTime, type Weekday, durationHours, round2, toMinutes, sumHours } from './time.js'

export type HardConstraint =
  | 'teacherOverlap'
  | 'spaceOverlap'
  | 'groupOverlap'
  | 'teacherUnavailable'
  | 'teacherCapacity'
  | 'spaceCapacity'
  | 'spaceEquipment'

export const HARD_CONSTRAINTS: readonly HardConstraint[] = [
  'teacherOverlap',
  'spaceOverlap',
  'groupOverlap',
  'teacherUnavailable',
  'teacherCapacity',
  'spaceCapacity',
  'spaceEquipment',
]

export type SoftConstraint =
  | 'avoidSlot'
  | 'teacherGaps'
  | 'singleSessionDay'
  | 'buildingChange'
  | 'consecutiveHours'
  | 'weeklySpread'

export const SOFT_CONSTRAINTS: readonly SoftConstraint[] = [
  'avoidSlot',
  'teacherGaps',
  'singleSessionDay',
  'buildingChange',
  'consecutiveHours',
  'weeklySpread',
]

/** A session as the engine sees it: a slot plus the three resources it uses. */
export interface PlannedSession extends SessionLike {
  groupId: string
  teacherProfileId: string | null
  spaceId: string | null
}

export interface TeacherResource {
  teacherProfileId: string
  /** Weekly availability windows; anything uncovered counts as unavailable. */
  availability: readonly AvailabilityEntry[]
  /**
   * Hours the contract leaves for this week — annual capacity divided by the
   * center's teaching weeks. Null means "not contracted", which blocks nothing
   * by itself but is reported when hours are assigned anyway.
   */
  weeklyCapacityHours: number | null
}

export interface SpaceResource {
  spaceId: string
  name: string
  building: string | null
  capacity: number
  type: string
  equipment: readonly string[]
}

export interface GroupResource {
  groupId: string
  code: string
  subjectId: string
  subjectCode: string
  subjectName: string
  /** Students expected. Null means nobody recorded it, so it cannot block. */
  capacity: number | null
  requiredSpaceType: string | null
  requiredEquipment: readonly string[]
}

export interface ScheduleContext {
  settings: CenterSettings
  teachers: ReadonlyMap<string, TeacherResource>
  spaces: ReadonlyMap<string, SpaceResource>
  groups: ReadonlyMap<string, GroupResource>
}

export interface Violation {
  constraint: HardConstraint
  sessionId: string
  /** The other session, when the violation is a collision. */
  otherSessionId?: string
  /** i18n key under `planner.hard.`, plus the parameters it interpolates. */
  messageKey: string
  params: Record<string, string | number>
}

export interface Penalty {
  constraint: SoftConstraint
  /** Whose experience gets worse: a teacher, a group, or the whole week. */
  subjectId?: string
  teacherProfileId?: string
  groupId?: string
  /** How much of the thing there is: gap hours, extra hours, days… */
  amount: number
  weight: number
  /** `amount × weight`, the number the solver minimises. */
  cost: number
  messageKey: string
  params: Record<string, string | number>
}

export interface ScheduleScore {
  violations: Violation[]
  penalties: Penalty[]
  /** Sum of every soft cost. Lower is better; 0 is a perfect week. */
  softCost: number
  feasible: boolean
}

function hardKey(constraint: HardConstraint): string {
  return `planner.hard.${constraint}`
}

function softKey(constraint: SoftConstraint): string {
  return `planner.soft.${constraint}`
}

function sessionHours(session: PlannedSession): number {
  return durationHours({ start: session.startTime, end: session.endTime })
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard constraints
// ─────────────────────────────────────────────────────────────────────────────

function overlapConstraint(conflict: SessionConflict): HardConstraint {
  switch (conflict.kind) {
    case 'teacher':
      return 'teacherOverlap'
    case 'space':
      return 'spaceOverlap'
    case 'group':
      return 'groupOverlap'
  }
}

/**
 * Everything that makes one placement illegal, given the rest of the week.
 *
 * `others` must not contain the candidate itself; the planner passes the
 * timetable minus the session being dragged.
 */
export function evaluatePlacement(
  candidate: PlannedSession,
  others: readonly PlannedSession[],
  context: ScheduleContext,
): Violation[] {
  const violations: Violation[] = []

  for (const conflict of findConflictsFor(candidate, others)) {
    const other = conflict.sessionIds.find((id) => id !== candidate.id) ?? candidate.id
    violations.push({
      constraint: overlapConstraint(conflict),
      sessionId: candidate.id,
      otherSessionId: other,
      messageKey: hardKey(overlapConstraint(conflict)),
      params: { name: resourceName(conflict, context), minutes: conflict.overlapMinutes },
    })
  }

  violations.push(...availabilityViolations(candidate, context))
  violations.push(...capacityViolations(candidate, others, context))
  violations.push(...spaceViolations(candidate, context))

  return violations
}

function resourceName(conflict: SessionConflict, context: ScheduleContext): string {
  switch (conflict.kind) {
    case 'space':
      return context.spaces.get(conflict.resourceId)?.name ?? conflict.resourceId
    case 'group': {
      const group = context.groups.get(conflict.resourceId)
      return group ? `${group.subjectCode} ${group.code}` : conflict.resourceId
    }
    case 'teacher':
      return conflict.resourceId
  }
}

function availabilityViolations(candidate: PlannedSession, context: ScheduleContext): Violation[] {
  if (!candidate.teacherProfileId) return []
  const teacher = context.teachers.get(candidate.teacherProfileId)
  if (!teacher) return []

  const level = effectiveAvailability(
    { weekday: candidate.weekday, start: candidate.startTime, end: candidate.endTime },
    teacher.availability,
  )
  if (level !== 'unavailable') return []

  return [
    {
      constraint: 'teacherUnavailable',
      sessionId: candidate.id,
      messageKey: hardKey('teacherUnavailable'),
      params: { start: candidate.startTime, end: candidate.endTime, weekday: candidate.weekday },
    },
  ]
}

/**
 * Weekly hours against the contract. The ceiling is the center's own
 * `load.maxOverloadPercent` (R9): a center that tolerates 120 % says so in its
 * settings rather than in this file.
 */
function capacityViolations(
  candidate: PlannedSession,
  others: readonly PlannedSession[],
  context: ScheduleContext,
): Violation[] {
  if (!candidate.teacherProfileId) return []
  const teacher = context.teachers.get(candidate.teacherProfileId)
  if (!teacher || teacher.weeklyCapacityHours === null) return []

  const ceiling = round2(
    teacher.weeklyCapacityHours * (context.settings.load.maxOverloadPercent / 100),
  )
  const scheduled = sumHours([
    sessionHours(candidate),
    ...others
      .filter((session) => session.teacherProfileId === candidate.teacherProfileId)
      .map(sessionHours),
  ])

  if (scheduled <= ceiling) return []

  return [
    {
      constraint: 'teacherCapacity',
      sessionId: candidate.id,
      messageKey: hardKey('teacherCapacity'),
      params: { scheduled, ceiling },
    },
  ]
}

function spaceViolations(candidate: PlannedSession, context: ScheduleContext): Violation[] {
  if (!candidate.spaceId) return []
  const space = context.spaces.get(candidate.spaceId)
  const group = context.groups.get(candidate.groupId)
  if (!space || !group) return []

  const violations: Violation[] = []

  if (group.capacity !== null && group.capacity > space.capacity) {
    violations.push({
      constraint: 'spaceCapacity',
      sessionId: candidate.id,
      messageKey: hardKey('spaceCapacity'),
      params: { space: space.name, capacity: space.capacity, students: group.capacity },
    })
  }

  const missing = group.requiredEquipment.filter((item) => !space.equipment.includes(item))
  if (missing.length > 0) {
    violations.push({
      constraint: 'spaceEquipment',
      sessionId: candidate.id,
      messageKey: hardKey('spaceEquipment'),
      // The list is rendered by the caller, which knows how to translate the
      // equipment names themselves.
      params: { space: space.name, equipment: missing.join(', ') },
    })
  }

  return violations
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft constraints
// ─────────────────────────────────────────────────────────────────────────────

interface DaySessions {
  teacherProfileId: string
  weekday: Weekday
  sessions: PlannedSession[]
}

function byTeacherAndDay(sessions: readonly PlannedSession[]): DaySessions[] {
  const days = new Map<string, DaySessions>()

  for (const session of sessions) {
    if (!session.teacherProfileId) continue
    const key = `${session.teacherProfileId}#${session.weekday}`
    const day = days.get(key)
    if (day) day.sessions.push(session)
    else {
      days.set(key, {
        teacherProfileId: session.teacherProfileId,
        weekday: session.weekday,
        sessions: [session],
      })
    }
  }

  for (const day of days.values()) {
    day.sessions.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
  }

  return [...days.values()].sort(
    (a, b) => a.teacherProfileId.localeCompare(b.teacherProfileId) || a.weekday - b.weekday,
  )
}

function penalty(
  constraint: SoftConstraint,
  amount: number,
  context: ScheduleContext,
  extra: Partial<Penalty> & { params: Record<string, string | number> },
): Penalty | null {
  const weight = context.settings.engine.weights[constraint]
  if (weight <= 0 || amount <= 0) return null

  return {
    constraint,
    amount: round2(amount),
    weight,
    cost: round2(amount * weight),
    messageKey: softKey(constraint),
    ...extra,
  }
}

/** Everything that makes a legal week worse than it could be. */
export function evaluateSoft(
  sessions: readonly PlannedSession[],
  context: ScheduleContext,
): Penalty[] {
  const penalties: Penalty[] = []
  const days = byTeacherAndDay(sessions)

  for (const session of sessions) {
    const avoid = avoidPenalty(session, context)
    if (avoid) penalties.push(avoid)
  }

  for (const day of days) {
    penalties.push(...dayPenalties(day, context))
  }

  penalties.push(...spreadPenalties(sessions, context))

  return penalties
}

function avoidPenalty(session: PlannedSession, context: ScheduleContext): Penalty | null {
  if (!session.teacherProfileId) return null
  const teacher = context.teachers.get(session.teacherProfileId)
  if (!teacher) return null

  const level = effectiveAvailability(
    { weekday: session.weekday, start: session.startTime, end: session.endTime },
    teacher.availability,
  )
  if (level !== 'avoid') return null

  return penalty('avoidSlot', sessionHours(session), context, {
    teacherProfileId: session.teacherProfileId,
    params: { start: session.startTime, end: session.endTime, weekday: session.weekday },
  })
}

function dayPenalties(day: DaySessions, context: ScheduleContext): Penalty[] {
  const penalties: Penalty[] = []
  const { minBreakMinutes, maxConsecutiveHours } = context.settings.schedule

  // A single session is a whole trip to campus for one hour of teaching.
  if (day.sessions.length === 1) {
    const single = penalty('singleSessionDay', 1, context, {
      teacherProfileId: day.teacherProfileId,
      params: { weekday: day.weekday },
    })
    if (single) penalties.push(single)
  }

  let gapMinutes = 0
  let buildingChanges = 0
  let runMinutes = day.sessions[0] ? minutesOf(day.sessions[0]) : 0
  let excessMinutes = 0

  for (let index = 1; index < day.sessions.length; index += 1) {
    const previous = day.sessions[index - 1]!
    const current = day.sessions[index]!
    const gap = toMinutes(current.startTime) - toMinutes(previous.endTime)

    if (gap > 0) gapMinutes += gap

    if (buildingOf(previous, context) !== buildingOf(current, context)) buildingChanges += 1

    // A break long enough by the center's own rule ends the run.
    if (gap >= minBreakMinutes) {
      excessMinutes += Math.max(0, runMinutes - maxConsecutiveHours * 60)
      runMinutes = minutesOf(current)
    } else {
      runMinutes += gap + minutesOf(current)
    }
  }
  excessMinutes += Math.max(0, runMinutes - maxConsecutiveHours * 60)

  const gaps = penalty('teacherGaps', gapMinutes / 60, context, {
    teacherProfileId: day.teacherProfileId,
    params: { weekday: day.weekday, hours: round2(gapMinutes / 60) },
  })
  if (gaps) penalties.push(gaps)

  const buildings = penalty('buildingChange', buildingChanges, context, {
    teacherProfileId: day.teacherProfileId,
    params: { weekday: day.weekday, changes: buildingChanges },
  })
  if (buildings) penalties.push(buildings)

  const consecutive = penalty('consecutiveHours', excessMinutes / 60, context, {
    teacherProfileId: day.teacherProfileId,
    params: {
      weekday: day.weekday,
      hours: round2(excessMinutes / 60),
      limit: maxConsecutiveHours,
    },
  })
  if (consecutive) penalties.push(consecutive)

  return penalties
}

function minutesOf(session: PlannedSession): number {
  return toMinutes(session.endTime) - toMinutes(session.startTime)
}

function buildingOf(session: PlannedSession, context: ScheduleContext): string | null {
  if (!session.spaceId) return null
  return context.spaces.get(session.spaceId)?.building ?? null
}

/**
 * A group's week should breathe: four hours of the same subject on Monday and
 * nothing else is worse for students than one hour on four days.
 */
function spreadPenalties(sessions: readonly PlannedSession[], context: ScheduleContext): Penalty[] {
  const byGroup = new Map<string, PlannedSession[]>()
  for (const session of sessions) {
    const bucket = byGroup.get(session.groupId)
    if (bucket) bucket.push(session)
    else byGroup.set(session.groupId, [session])
  }

  const penalties: Penalty[] = []
  for (const [groupId, groupSessions] of byGroup) {
    if (groupSessions.length < 2) continue
    const days = new Set(groupSessions.map((session) => session.weekday))
    // Ideally as many days as sessions, capped by the working week.
    const ideal = Math.min(groupSessions.length, context.settings.schedule.workingWeekdays.length)
    const bunched = ideal - days.size
    if (bunched <= 0) continue

    const group = context.groups.get(groupId)
    const spread = penalty('weeklySpread', bunched, context, {
      groupId,
      params: {
        group: group ? `${group.subjectCode} ${group.code}` : groupId,
        days: days.size,
        sessions: groupSessions.length,
      },
    })
    if (spread) penalties.push(spread)
  }

  return penalties
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole-week scoring
// ─────────────────────────────────────────────────────────────────────────────

/** Scores a complete timetable: what is illegal, what merely hurts, and how much. */
export function scoreSchedule(
  sessions: readonly PlannedSession[],
  context: ScheduleContext,
): ScheduleScore {
  const violations: Violation[] = []
  const seen = new Set<string>()

  for (const session of sessions) {
    const others = sessions.filter((other) => other.id !== session.id)
    for (const violation of evaluatePlacement(session, others, context)) {
      // A collision is one violation, not one per session involved.
      const pair = violation.otherSessionId
        ? [violation.sessionId, violation.otherSessionId].sort().join('#')
        : violation.sessionId
      const key = `${violation.constraint}#${pair}`
      if (seen.has(key)) continue
      seen.add(key)
      violations.push(violation)
    }
  }

  const penalties = evaluateSoft(sessions, context)

  return {
    violations,
    penalties,
    softCost: round2(penalties.reduce((total, entry) => total + entry.cost, 0)),
    feasible: violations.length === 0,
  }
}

export type CellStatus = 'valid' | 'warning' | 'blocked'

export interface CellEvaluation {
  status: CellStatus
  violations: Violation[]
  penalties: Penalty[]
}

/**
 * What the planner paints on a cell: green when the placement is legal and
 * nobody complains, amber when it is legal but costs something, red when it
 * cannot happen at all. The reasons travel with the colour so the tooltip can
 * say why (R8: colour is never the only carrier).
 */
export function evaluateCell(
  candidate: PlannedSession,
  others: readonly PlannedSession[],
  context: ScheduleContext,
): CellEvaluation {
  const violations = evaluatePlacement(candidate, others, context)
  if (violations.length > 0) return { status: 'blocked', violations, penalties: [] }

  // Soft cost is a property of the whole week, so it is measured as the
  // difference the candidate makes rather than in isolation.
  const before = evaluateSoft(others, context)
  const after = evaluateSoft([...others, candidate], context)
  const penalties = addedPenalties(before, after)

  return { status: penalties.length > 0 ? 'warning' : 'valid', violations: [], penalties }
}

function penaltyKey(entry: Penalty): string {
  return [
    entry.constraint,
    entry.teacherProfileId ?? '',
    entry.groupId ?? '',
    JSON.stringify(entry.params),
  ].join('#')
}

function addedPenalties(before: readonly Penalty[], after: readonly Penalty[]): Penalty[] {
  const previous = new Map(before.map((entry) => [penaltyKey(entry), entry]))

  return after.filter((entry) => {
    const existing = previous.get(penaltyKey(entry))
    return !existing || entry.cost > existing.cost
  })
}

export interface PlannerSummary {
  placed: number
  pending: number
  blocked: number
  warnings: number
  softCost: number
  /** Teachers whose weekly hours are outside their contracted range. */
  teachersOutOfRange: number
}

/** The bottom bar of the planner: the state of the week in five numbers. */
export function summarizePlan(
  sessions: readonly PlannedSession[],
  pending: number,
  context: ScheduleContext,
): PlannerSummary {
  const score = scoreSchedule(sessions, context)

  const hoursByTeacher = new Map<string, number>()
  for (const session of sessions) {
    if (!session.teacherProfileId) continue
    hoursByTeacher.set(
      session.teacherProfileId,
      round2((hoursByTeacher.get(session.teacherProfileId) ?? 0) + sessionHours(session)),
    )
  }

  let teachersOutOfRange = 0
  for (const [teacherProfileId, hours] of hoursByTeacher) {
    const capacity = context.teachers.get(teacherProfileId)?.weeklyCapacityHours
    if (capacity === null || capacity === undefined || capacity <= 0) continue
    const ratio = (hours / capacity) * 100
    if (ratio < context.settings.load.thresholds.underBelow) teachersOutOfRange += 1
    else if (ratio > context.settings.load.thresholds.limitUpTo) teachersOutOfRange += 1
  }

  return {
    placed: sessions.length,
    pending,
    blocked: score.violations.length,
    warnings: score.penalties.length,
    softCost: score.softCost,
    teachersOutOfRange,
  }
}

/** Weekly ceiling from an annual contract, given the center's teaching weeks. */
export function weeklyCapacityFrom(annualHours: number, settings: CenterSettings): number {
  return round2(annualHours / settings.schedule.teachingWeeks)
}

export function candidateSlots(
  settings: CenterSettings,
  durationMinutes: number,
): { weekday: Weekday; startTime: ClockTime; endTime: ClockTime }[] {
  const slots: { weekday: Weekday; startTime: ClockTime; endTime: ClockTime }[] = []
  const step = settings.schedule.slotMinutes
  const dayStart = toMinutes(settings.schedule.dayStart)
  const dayEnd = toMinutes(settings.schedule.dayEnd)

  for (const weekday of settings.schedule.workingWeekdays) {
    for (let start = dayStart; start + durationMinutes <= dayEnd; start += step) {
      slots.push({
        weekday: weekday as Weekday,
        startTime: clock(start),
        endTime: clock(start + durationMinutes),
      })
    }
  }

  return slots
}

function clock(minutes: number): ClockTime {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
