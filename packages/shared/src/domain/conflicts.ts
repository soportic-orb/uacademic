/**
 * Timetable conflict detection.
 *
 * Two sessions conflict when they share a resource (teacher, space or student
 * group), fall on the same weekday, overlap in time and can actually happen on
 * the same week.
 */
import {
  type ClockTime,
  type DateRange,
  type Weekday,
  dateRangesOverlap,
  overlapMinutes,
} from './time.js'

export type Recurrence = 'weekly' | 'biweekly' | 'once'

export interface SessionLike {
  id: string
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  dateFrom: Date
  dateTo: Date
  recurrence?: Recurrence
  teacherProfileId?: string | null
  /**
   * The other people who give this class.
   *
   * A lab with two lecturers, a seminar shared between a titular and an
   * assistant: both are teaching, so both must be free, and the class belongs
   * on both their calendars. `teacherProfileId` is the first of them and is
   * what a single-teacher class has always used.
   */
  coTeacherIds?: readonly string[] | null
  spaceId?: string | null
  groupId?: string | null
}

/** Everyone who gives this class, the first one first, without repeats. */
export function sessionTeacherIds(session: SessionLike): string[] {
  const ids = session.teacherProfileId ? [session.teacherProfileId] : []
  for (const id of session.coTeacherIds ?? []) {
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export type ConflictKind = 'teacher' | 'space' | 'group'

export const CONFLICT_KINDS: readonly ConflictKind[] = ['teacher', 'space', 'group']

export interface SessionConflict {
  kind: ConflictKind
  /** The shared resource: teacher profile id, space id or group id. */
  resourceId: string
  /** Both session ids, ordered so the pair is stable across runs. */
  sessionIds: [string, string]
  weekday: Weekday
  overlapMinutes: number
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
/** 1970-01-05 was a Monday: the anchor for week parity. */
const EPOCH_MONDAY = Date.UTC(1970, 0, 5)

function weekIndex(date: Date): number {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.floor((midnight - EPOCH_MONDAY) / MS_PER_WEEK)
}

function range(session: SessionLike): DateRange {
  return { from: session.dateFrom, to: session.dateTo }
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

/**
 * Whether two same-weekday sessions can land on the same calendar week.
 *
 * Biweekly sessions only collide with each other when their week parity
 * matches — otherwise they alternate and never meet. A one-off session is
 * compared by its single date.
 */
export function occurrencesCanCollide(a: SessionLike, b: SessionLike): boolean {
  const recurrenceA = a.recurrence ?? 'weekly'
  const recurrenceB = b.recurrence ?? 'weekly'

  if (recurrenceA === 'once' && recurrenceB === 'once') return sameDay(a.dateFrom, b.dateFrom)

  if (!dateRangesOverlap(range(a), range(b))) return false

  if (recurrenceA === 'once' || recurrenceB === 'once') {
    const [once, recurring] = recurrenceA === 'once' ? [a, b] : [b, a]
    if ((recurring.recurrence ?? 'weekly') === 'biweekly') {
      return weekIndex(once.dateFrom) % 2 === weekIndex(recurring.dateFrom) % 2
    }
    return true
  }

  if (recurrenceA === 'biweekly' && recurrenceB === 'biweekly') {
    return weekIndex(a.dateFrom) % 2 === weekIndex(b.dateFrom) % 2
  }

  // weekly vs anything else: the weekly one is there every week.
  return true
}

/**
 * The resources of one kind a session occupies.
 *
 * Only teaching is plural: a class has one room and one group, and two or
 * more people.
 */
function resourceIdsFor(session: SessionLike, kind: ConflictKind): string[] {
  switch (kind) {
    case 'teacher':
      return sessionTeacherIds(session)
    case 'space':
      return session.spaceId ? [session.spaceId] : []
    case 'group':
      return session.groupId ? [session.groupId] : []
  }
}

/** Whether both sessions occupy this exact resource, and clash over it. */
function conflictBetween(
  a: SessionLike,
  b: SessionLike,
  kind: ConflictKind,
  resourceId: string,
): SessionConflict | null {
  if (a.id === b.id) return null
  if (a.weekday !== b.weekday) return null

  if (!resourceIdsFor(a, kind).includes(resourceId)) return null
  if (!resourceIdsFor(b, kind).includes(resourceId)) return null

  const minutes = overlapMinutes(
    { start: a.startTime, end: a.endTime },
    { start: b.startTime, end: b.endTime },
  )
  if (minutes <= 0) return null
  if (!occurrencesCanCollide(a, b)) return null

  const sessionIds: [string, string] = a.id < b.id ? [a.id, b.id] : [b.id, a.id]
  return { kind, resourceId, sessionIds, weekday: a.weekday, overlapMinutes: minutes }
}

export interface DetectConflictsOptions {
  /** Which resources to check. Defaults to all three. */
  kinds?: readonly ConflictKind[]
}

/**
 * All conflicts inside a set of sessions, deduplicated per (kind, pair).
 *
 * Sessions are bucketed by resource and weekday and then swept in start order,
 * so the comparison is linear in the number of sessions that actually share a
 * resource instead of quadratic over the whole timetable.
 */
export function detectSessionConflicts(
  sessions: readonly SessionLike[],
  options: DetectConflictsOptions = {},
): SessionConflict[] {
  const kinds = options.kinds ?? CONFLICT_KINDS
  const conflicts: SessionConflict[] = []

  for (const kind of kinds) {
    const buckets = new Map<string, { resourceId: string; sessions: SessionLike[] }>()
    for (const session of sessions) {
      for (const resourceId of resourceIdsFor(session, kind)) {
        const key = `${resourceId}#${session.weekday}`
        const bucket = buckets.get(key)
        if (bucket) bucket.sessions.push(session)
        else buckets.set(key, { resourceId, sessions: [session] })
      }
    }

    for (const { resourceId, sessions: bucket } of buckets.values()) {
      if (bucket.length < 2) continue
      const ordered = [...bucket].sort((x, y) => x.startTime.localeCompare(y.startTime))
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const current = ordered[i]
          const candidate = ordered[j]
          if (!current || !candidate) continue
          // Sorted by start time: once a session starts after this one ends,
          // no later session in the bucket can overlap it either.
          if (candidate.startTime >= current.endTime) break
          const conflict = conflictBetween(current, candidate, kind, resourceId)
          if (conflict) conflicts.push(conflict)
        }
      }
    }
  }

  return conflicts.sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.kind.localeCompare(b.kind) ||
      a.sessionIds[0].localeCompare(b.sessionIds[0]),
  )
}

/**
 * Conflicts a candidate session would introduce against an existing timetable.
 * This is what the planner calls on drag & drop and what the AI assistant calls
 * before returning a proposal (R5).
 */
export function findConflictsFor(
  candidate: SessionLike,
  existing: readonly SessionLike[],
  options: DetectConflictsOptions = {},
): SessionConflict[] {
  const kinds = options.kinds ?? CONFLICT_KINDS
  const conflicts: SessionConflict[] = []

  for (const session of existing) {
    for (const kind of kinds) {
      // One conflict per shared resource: a pair of classes given by the same
      // two people clashes twice over, and each person has to hear about it.
      for (const resourceId of resourceIdsFor(candidate, kind)) {
        const conflict = conflictBetween(candidate, session, kind, resourceId)
        if (conflict) conflicts.push(conflict)
      }
    }
  }

  return conflicts
}
