/**
 * The planner's local reasoning: where a session may go, and how to take back
 * what you just did.
 *
 * Cell colours are computed in the browser with the same pure engine the API
 * uses (`@uacademic/shared`), so dragging is instant instead of one round trip
 * per cell. The server stays the authority: every commit comes back with the
 * violations it recomputed.
 */
import type {
  CalendarDayEntry,
  CellEvaluation,
  CenterSettings,
  GroupResource,
  PlannedSession,
  ScheduleContext,
  SpaceResource,
  TeacherResource,
  Weekday,
} from '@uacademic/shared'
import { evaluateCell, isoDateOf, occursOn, slotsBetween } from '@uacademic/shared'
import { useCallback, useMemo, useState } from 'react'

import type { PlannerSessionDto, VersionDetailDto } from './queries'
import { dateOfWeekday } from './week-dates'

export interface TeacherDirectoryEntry {
  teacherProfileId: string
  name: string
  avatarUrl: string | null
  /** The year's contract, less approved reductions: what the engine judges by. */
  capacityHours: number
}

export interface PlannerContextDto {
  settings: CenterSettings
  teachers: TeacherResource[]
  spaces: SpaceResource[]
  groups: GroupResource[]
  /** The academic calendar of the year, for shading the days it closes. */
  calendar?: CalendarDayEntry[]
  /** Who the teachers are; the engine's own list is deliberately anonymous. */
  directory: TeacherDirectoryEntry[]
  /**
   * The kinds of class this center gives, chosen on the class itself.
   *
   * Absent for a center that has written none down, which is the state every
   * center starts in and the planner works in.
   */
  classTypes?: ClassTypeOption[]
}

export interface ClassTypeOption {
  id: string
  name: string
  /** How long a class placed with this kind starts out, in minutes. */
  defaultMinutes: number
}

export function buildScheduleContext(context: PlannerContextDto): ScheduleContext {
  return {
    settings: context.settings,
    teachers: new Map(context.teachers.map((entry) => [entry.teacherProfileId, entry])),
    spaces: new Map(context.spaces.map((entry) => [entry.spaceId, entry])),
    groups: new Map(context.groups.map((entry) => [entry.groupId, entry])),
  }
}

export function toPlanned(session: PlannerSessionDto): PlannedSession {
  return {
    id: session.id,
    groupId: session.groupId,
    teacherProfileId: session.teacherProfileId,
    spaceId: session.spaceId,
    weekday: session.weekday,
    startTime: session.startTime,
    endTime: session.endTime,
    dateFrom: new Date(session.dateFrom),
    dateTo: new Date(session.dateTo),
    recurrence: session.recurrence,
  }
}

export interface HeldSession {
  kind: 'session' | 'pending'
  /** Existing session being moved, or null when it comes from the sidebar. */
  sessionId: string | null
  groupId: string
  label: string
  durationMinutes: number
  teacherProfileId: string | null
  spaceId: string | null
  dateFrom: string
  dateTo: string
}

export function heldFromSession(session: PlannerSessionDto): HeldSession {
  return {
    kind: 'session',
    sessionId: session.id,
    groupId: session.groupId,
    label: `${session.subjectCode} ${session.groupCode}`,
    durationMinutes: minutesBetween(session.startTime, session.endTime),
    teacherProfileId: session.teacherProfileId,
    spaceId: session.spaceId,
    dateFrom: session.dateFrom,
    dateTo: session.dateTo,
  }
}

export function minutesBetween(start: string, end: string): number {
  const [startHour = 0, startMinute = 0] = start.split(':').map(Number)
  const [endHour = 0, endMinute = 0] = end.split(':').map(Number)
  return endHour * 60 + endMinute - (startHour * 60 + startMinute)
}

export function addMinutes(time: string, minutes: number): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  const total = hour * 60 + minute + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export interface GridGeometry {
  weekdays: Weekday[]
  slots: { start: string; end: string }[]
}

export function gridGeometry(version: VersionDetailDto): GridGeometry {
  return {
    weekdays: version.grid.weekdays as Weekday[],
    slots: slotsBetween(version.grid.dayStart, version.grid.dayEnd, version.grid.slotMinutes),
  }
}

/**
 * The colour of every cell for the session currently held: green when nothing
 * complains, amber when it costs something, red when it cannot happen. The
 * reasons travel with it, so the tooltip never has to guess (R8).
 *
 * Judged against the week on screen, and as the dated class it would become.
 *
 * Both of those used to be wrong in the same direction. Every session of the
 * version was compared, whatever week it fell in, and the candidate was
 * treated as a weekly one — so a class placed in October painted that hour red
 * in August, on a grid where nothing was drawn: "this group already has a
 * class here", and no class anywhere to be seen.
 */
export function evaluateGrid(
  held: HeldSession,
  version: VersionDetailDto,
  context: ScheduleContext,
  geometry: GridGeometry,
  /** Monday of the week being shown. */
  weekStart: Date,
): Map<string, CellEvaluation> {
  const others = version.sessions
    .filter((session) => session.id !== held.sessionId)
    // The same filter the grid draws with: what actually happens this week.
    .filter((session) =>
      occursOn(session, isoDateOf(dateOfWeekday(weekStart, session.weekday as Weekday))),
    )
    .map(toPlanned)

  const evaluations = new Map<string, CellEvaluation>()

  for (const weekday of geometry.weekdays) {
    const date = dateOfWeekday(weekStart, weekday)

    for (const slot of geometry.slots) {
      const endTime = addMinutes(slot.start, held.durationMinutes)
      if (endTime > version.grid.dayEnd) continue

      const candidate: PlannedSession = {
        id: held.sessionId ?? 'candidate',
        groupId: held.groupId,
        teacherProfileId: held.teacherProfileId,
        spaceId: held.spaceId,
        weekday,
        startTime: slot.start,
        endTime,
        // One day, once: what the server writes when this is dropped.
        dateFrom: date,
        dateTo: date,
        recurrence: 'once',
      }

      evaluations.set(cellKey(weekday, slot.start), evaluateCell(candidate, others, context))
    }
  }

  return evaluations
}

export function cellKey(weekday: number, start: string): string {
  return `${weekday}|${start}`
}

export interface PlannerOperation {
  /** Applied when the user asks to redo; also what was just done. */
  redo: () => Promise<string | null | void>
  /** The inverse. Receives the id the redo produced, if it created a session. */
  undo: (sessionId: string | null) => Promise<string | null | void>
  /** Id of the session the operation produced, when it created one. */
  sessionId: string | null
}

/**
 * Undo and redo over operations rather than over snapshots: the API is the
 * store, so the only honest way back is to send the inverse call. Creating a
 * session yields a new id each time, which is why an operation carries the id
 * its last run produced.
 */
export function useUndoRedo() {
  const [past, setPast] = useState<PlannerOperation[]>([])
  const [future, setFuture] = useState<PlannerOperation[]>([])
  const [busy, setBusy] = useState(false)

  const record = useCallback((operation: PlannerOperation) => {
    setPast((entries) => [...entries, operation])
    setFuture([])
  }, [])

  const undo = useCallback(async () => {
    const operation = past.at(-1)
    if (!operation || busy) return
    setBusy(true)
    try {
      await operation.undo(operation.sessionId)
      setPast((entries) => entries.slice(0, -1))
      setFuture((entries) => [operation, ...entries])
    } finally {
      setBusy(false)
    }
  }, [busy, past])

  const redo = useCallback(async () => {
    const operation = future[0]
    if (!operation || busy) return
    setBusy(true)
    try {
      const produced = await operation.redo()
      const next: PlannerOperation = {
        ...operation,
        sessionId: typeof produced === 'string' ? produced : operation.sessionId,
      }
      setFuture((entries) => entries.slice(1))
      setPast((entries) => [...entries, next])
    } finally {
      setBusy(false)
    }
  }, [busy, future])

  const reset = useCallback(() => {
    setPast([])
    setFuture([])
  }, [])

  return useMemo(
    () => ({
      record,
      undo,
      redo,
      reset,
      canUndo: past.length > 0 && !busy,
      canRedo: future.length > 0 && !busy,
    }),
    [record, undo, redo, reset, past.length, future.length, busy],
  )
}
