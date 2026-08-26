/**
 * What changed between two schedule versions.
 *
 * Publishing a version is the moment a timetable stops being an exercise and
 * starts being someone's Tuesday, so the diff has to be per person: a teacher
 * is told about the three sessions that moved under them, not that "the
 * schedule was republished".
 *
 * Sessions are matched across versions rather than compared by id, because a
 * draft is a copy: every row has a new identifier even when nothing about the
 * class changed.
 */
import type { Recurrence } from './conflicts.js'
import type { ClockTime, Weekday } from './time.js'
import { toMinutes } from './time.js'

/** A session frozen with the names a person needs to read it. */
export interface SessionSnapshot {
  id: string
  groupId: string
  groupCode: string
  /** The subject, for the screens that colour a class by it. */
  subjectId?: string
  subjectCode: string
  subjectName: string
  /** The colour the center chose for the subject, if it chose one. */
  subjectColor?: string | null
  teacherProfileId: string | null
  teacherName: string | null
  /**
   * Everyone giving the class, `teacherProfileId` first.
   *
   * Absent on a snapshot taken before co-teaching existed, and on the many
   * classes given by one person, where it says nothing `teacherName` does not.
   */
  teachers?: readonly { teacherProfileId: string; name: string }[]
  spaceId: string | null
  spaceName: string | null
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  recurrence: Recurrence
}

export type ChangeKind = 'added' | 'removed' | 'changed'
export type ChangedField = 'slot' | 'teacher' | 'space'

export interface ScheduleChange {
  kind: ChangeKind
  /** What changed, when the session exists on both sides. */
  fields: ChangedField[]
  before: SessionSnapshot | null
  after: SessionSnapshot | null
  /** Everyone this concerns: the teacher losing it and the one gaining it. */
  teacherProfileIds: string[]
  /** i18n key under `planner.change.`. */
  messageKey: string
  params: Record<string, string | number>
}

export interface TeacherChanges {
  teacherProfileId: string
  teacherName: string | null
  changes: ScheduleChange[]
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
  unchanged: number
  teachersAffected: number
}

export interface ScheduleDiff {
  changes: ScheduleChange[]
  byTeacher: TeacherChanges[]
  summary: DiffSummary
}

function slotOf(session: SessionSnapshot): string {
  return `${session.weekday}#${session.startTime}#${session.endTime}#${session.recurrence}`
}

/**
 * How much two sessions of the same group look like the same class.
 * Used only to pair rows across versions; higher is a better match.
 */
function similarity(before: SessionSnapshot, after: SessionSnapshot): number {
  let score = 0
  if (slotOf(before) === slotOf(after)) score += 8
  else {
    if (before.weekday === after.weekday) score += 2
    const distance = Math.abs(toMinutes(before.startTime) - toMinutes(after.startTime))
    score += Math.max(0, 2 - distance / 240)
  }
  if (before.teacherProfileId && before.teacherProfileId === after.teacherProfileId) score += 3
  if (before.spaceId && before.spaceId === after.spaceId) score += 1
  return score
}

/** Everyone giving the class, as a stable string to compare two of them by. */
function teachersOf(session: SessionSnapshot): string {
  const ids = session.teachers?.map((entry) => entry.teacherProfileId) ?? [
    ...(session.teacherProfileId ? [session.teacherProfileId] : []),
  ]
  return [...new Set(ids)].sort().join(',')
}

function changedFields(before: SessionSnapshot, after: SessionSnapshot): ChangedField[] {
  const fields: ChangedField[] = []
  if (slotOf(before) !== slotOf(after)) fields.push('slot')
  // Losing a second lecturer is a change of teacher even when the first one
  // stayed put, and the people it drops have to hear about it.
  if (teachersOf(before) !== teachersOf(after)) fields.push('teacher')
  if (before.spaceId !== after.spaceId) fields.push('space')
  return fields
}

function affected(...sessions: (SessionSnapshot | null)[]): string[] {
  return [
    ...new Set(
      sessions.flatMap((session) =>
        session ? teachersOf(session).split(',').filter(Boolean) : [],
      ),
    ),
  ]
}

function label(session: SessionSnapshot): string {
  return `${session.subjectCode} ${session.groupCode}`
}

function changeFor(before: SessionSnapshot | null, after: SessionSnapshot | null): ScheduleChange {
  if (before && after) {
    const fields = changedFields(before, after)
    return {
      kind: 'changed',
      fields,
      before,
      after,
      teacherProfileIds: affected(before, after),
      messageKey: `planner.change.${fields[0] ?? 'slot'}`,
      params: {
        group: label(after),
        weekday: after.weekday,
        start: after.startTime,
        previousWeekday: before.weekday,
        previousStart: before.startTime,
        teacher: after.teacherName ?? '',
        previousTeacher: before.teacherName ?? '',
        space: after.spaceName ?? '',
        previousSpace: before.spaceName ?? '',
      },
    }
  }

  const session = (after ?? before)!
  return {
    kind: after ? 'added' : 'removed',
    fields: [],
    before,
    after,
    teacherProfileIds: affected(before, after),
    messageKey: after ? 'planner.change.added' : 'planner.change.removed',
    params: {
      group: label(session),
      weekday: session.weekday,
      start: session.startTime,
      end: session.endTime,
      space: session.spaceName ?? '',
    },
  }
}

/**
 * Pairs the sessions of one group across versions: exact slot matches first,
 * then the best remaining resemblance. Greedy on purpose — an optimal
 * assignment would not read any better to the person whose class moved.
 */
function pairGroup(
  before: readonly SessionSnapshot[],
  after: readonly SessionSnapshot[],
): {
  pairs: [SessionSnapshot, SessionSnapshot][]
  removed: SessionSnapshot[]
  added: SessionSnapshot[]
} {
  const pairs: [SessionSnapshot, SessionSnapshot][] = []
  const remainingBefore = [...before]
  const remainingAfter = [...after]

  for (const pass of [true, false]) {
    for (let i = remainingBefore.length - 1; i >= 0; i -= 1) {
      const source = remainingBefore[i]!
      let bestIndex = -1
      let bestScore = pass ? 8 : 0

      for (const [index, target] of remainingAfter.entries()) {
        const score = similarity(source, target)
        if (pass ? score >= 8 : score > bestScore) {
          bestScore = score
          bestIndex = index
          if (pass) break
        }
      }

      if (bestIndex >= 0) {
        pairs.push([source, remainingAfter.splice(bestIndex, 1)[0]!])
        remainingBefore.splice(i, 1)
      }
    }
  }

  return { pairs, removed: remainingBefore, added: remainingAfter }
}

function groupBy(sessions: readonly SessionSnapshot[]): Map<string, SessionSnapshot[]> {
  const groups = new Map<string, SessionSnapshot[]>()
  for (const session of sessions) {
    const bucket = groups.get(session.groupId)
    if (bucket) bucket.push(session)
    else groups.set(session.groupId, [session])
  }
  return groups
}

/** The whole comparison: what was added, removed and changed, and for whom. */
export function diffSchedules(
  before: readonly SessionSnapshot[],
  after: readonly SessionSnapshot[],
): ScheduleDiff {
  const beforeGroups = groupBy(before)
  const afterGroups = groupBy(after)
  const groupIds = [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort()

  const changes: ScheduleChange[] = []
  let unchanged = 0

  for (const groupId of groupIds) {
    const { pairs, removed, added } = pairGroup(
      beforeGroups.get(groupId) ?? [],
      afterGroups.get(groupId) ?? [],
    )

    for (const [source, target] of pairs) {
      if (changedFields(source, target).length === 0) {
        unchanged += 1
        continue
      }
      changes.push(changeFor(source, target))
    }
    for (const session of removed) changes.push(changeFor(session, null))
    for (const session of added) changes.push(changeFor(null, session))
  }

  changes.sort((a, b) => {
    const left = a.after ?? a.before!
    const right = b.after ?? b.before!
    return (
      left.weekday - right.weekday ||
      left.startTime.localeCompare(right.startTime) ||
      label(left).localeCompare(label(right))
    )
  })

  const byTeacher = new Map<string, TeacherChanges>()
  for (const change of changes) {
    for (const teacherProfileId of change.teacherProfileIds) {
      const entry = byTeacher.get(teacherProfileId)
      const name =
        change.after?.teacherProfileId === teacherProfileId
          ? change.after.teacherName
          : (change.before?.teacherName ?? null)

      if (entry) entry.changes.push(change)
      else
        byTeacher.set(teacherProfileId, { teacherProfileId, teacherName: name, changes: [change] })
    }
  }

  return {
    changes,
    byTeacher: [...byTeacher.values()].sort((a, b) =>
      (a.teacherName ?? a.teacherProfileId).localeCompare(b.teacherName ?? b.teacherProfileId),
    ),
    summary: {
      added: changes.filter((change) => change.kind === 'added').length,
      removed: changes.filter((change) => change.kind === 'removed').length,
      changed: changes.filter((change) => change.kind === 'changed').length,
      unchanged,
      teachersAffected: byTeacher.size,
    },
  }
}

/** Only what one teacher has to be told. Empty means: do not notify them. */
export function changesForTeacher(diff: ScheduleDiff, teacherProfileId: string): ScheduleChange[] {
  return diff.byTeacher.find((entry) => entry.teacherProfileId === teacherProfileId)?.changes ?? []
}
