/**
 * The visual planner: a week you can drag classes around in.
 *
 * Every drag has an exact keyboard equivalent (R8): Space picks a session up,
 * the arrows move it, Space drops it, Escape puts it back. Both paths go
 * through the same placement call, and both read the same locally-computed
 * cell colours — green when the placement costs nothing, amber when it breaks
 * a soft constraint (with the reason in the tooltip), red when it is
 * impossible.
 */
import {
  type CellEvaluation,
  type SpaceResource,
  closuresInRange,
  firstClassDate,
  occursOn,
  effectiveAvailability,
  isoDateOf,
} from '@uacademic/shared'
import { formatDate, formatHours, minutesToHours } from '@uacademic/shared'
import { Clock, CopyPlus, Trash2, Undo2, Redo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { WhyThisRule } from '../settings/why-this-rule'
import { ApiRequestError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { currentLocale } from '../../i18n'
import {
  type GroupPlanDto,
  type PlannerSessionDto,
  type VersionDetailDto,
  useCreateSession,
  useDeleteSession,
  useDuplicateSession,
  useUpdateSession,
} from './queries'
import { TeacherRail } from './teacher-rail'
import type { TeacherDirectoryEntry } from './use-planner'
import { dateOfWeekday, isoDate, mondayOf, openingWeek, parseIsoDate } from './week-dates'
import { WeekNavigator } from './week-navigator'
import {
  type HeldSession,
  type PlannerContextDto,
  addMinutes,
  buildScheduleContext,
  cellKey,
  evaluateGrid,
  gridGeometry,
  heldFromSession,
  minutesBetween,
  useUndoRedo,
} from './use-planner'

/** The same ceiling the API keeps: a class, not a department meeting. */
const MAX_TEACHERS_PER_SESSION = 6

const STATUS_STYLE: Record<string, string> = {
  valid: 'bg-load-optimal-surface hover:ring-2 hover:ring-load-optimal',
  warning: 'bg-load-limit-surface hover:ring-2 hover:ring-load-limit',
  blocked: 'bg-load-over-surface cursor-not-allowed',
}

export function PlannerGrid({
  version,
  context,
}: {
  version: VersionDetailDto
  context: PlannerContextDto
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const history = useUndoRedo()

  const createSession = useCreateSession(version.id)
  const updateSession = useUpdateSession(version.id)
  const deleteSession = useDeleteSession(version.id)
  const duplicateSession = useDuplicateSession(version.id)

  const [held, setHeld] = useState<HeldSession | null>(null)
  const [cursor, setCursor] = useState({ day: 0, slot: 0 })
  const [announcement, setAnnouncement] = useState('')
  /**
   * The last refusal, kept on screen. A toast says what happened; this says
   * why, and links to the article of the center's regulation behind it.
   */
  const [blocked, setBlocked] = useState<{
    messageKey: string
    params: Record<string, string | number>
  } | null>(null)

  const geometry = useMemo(() => gridGeometry(version), [version])
  const engine = useMemo(() => buildScheduleContext(context), [context])

  const evaluations = useMemo(
    () =>
      held ? evaluateGrid(held, version, engine, geometry) : new Map<string, CellEvaluation>(),
    [held, version, engine, geometry],
  )

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const weekdayName = (weekday: number) => t(`weekday.${weekday}`)

  /**
   * Which week is on screen.
   *
   * The grid itself is still weekly — a timetable repeats, and a month laid
   * out as a month has nowhere to put an hour axis — but a coordinator
   * planning in February should not have to work out which week they are
   * looking at, or hold the date of a session in their head to know whether it
   * has started yet.
   */
  const [weekStart, setWeekStart] = useState(() => openingWeek(version.range))

  /*
    The days the center is shut, for the week on screen.

    Shown rather than enforced: a coordinator may well want a session on the
    template that falls on Christmas in one week and on an ordinary Monday in
    the other thirteen. The engine already skips the closed dates when it turns
    the template into actual classes; the shading is so nobody plans a whole
    afternoon into a fortnight that does not exist.
  */
  const closures = useMemo(() => {
    const dates = geometry.weekdays.map((weekday) => isoDateOf(dateOfWeekday(weekStart, weekday)))
    return closuresInRange(dates, context.calendar ?? [])
  }, [context.calendar, geometry.weekdays, weekStart])

  /**
   * What the class is about.
   *
   * Saved on its own, without touching anything else on the session: a topic
   * is not a placement, so it is not checked against availability and it does
   * not go through the undo history — nobody expects "undo" to take back a
   * sentence they typed and then left.
   */
  const setTopic = async (session: PlannerSessionDto, topic: string) => {
    try {
      await updateSession.mutateAsync({
        sessionId: session.id,
        values: { topic: topic.trim() || null },
      })
    } catch (error) {
      onError(error)
    }
  }

  /**
   * Lengthening or shortening a class by dragging its edge.
   *
   * `slots` is how many rows of the grid the edge moved by, positive
   * downwards. A class never becomes shorter than one slot and never leaves
   * the day the grid draws — both are refusals rather than clamps somewhere
   * the person cannot see.
   */
  const resizeSession = async (
    session: PlannerSessionDto,
    edge: 'start' | 'end',
    slots: number,
  ) => {
    if (slots === 0) return

    const minutes = slots * version.grid.slotMinutes
    const startTime = edge === 'start' ? addMinutes(session.startTime, minutes) : session.startTime
    const endTime = edge === 'end' ? addMinutes(session.endTime, minutes) : session.endTime

    if (minutesBetween(startTime, endTime) < version.grid.slotMinutes) return
    if (startTime < version.grid.dayStart || endTime > version.grid.dayEnd) return

    try {
      await updateSession.mutateAsync({ sessionId: session.id, values: { startTime, endTime } })
    } catch (error) {
      onError(error)
    }
  }

  /**
   * The hour, typed rather than dragged.
   *
   * The same rule as dragging: a class never becomes shorter than nothing and
   * never leaves the day the grid draws — refused rather than clamped, because
   * a class that silently moves somewhere else is worse than one that does
   * not move.
   */
  const setHours = async (session: PlannerSessionDto, startTime: string, endTime: string) => {
    if (minutesBetween(startTime, endTime) <= 0) {
      toast.error('planner.hours.invalid')
      return
    }
    if (startTime < version.grid.dayStart || endTime > version.grid.dayEnd) {
      toast.error('planner.hours.outsideDay', {
        params: { start: version.grid.dayStart, end: version.grid.dayEnd },
      })
      return
    }

    try {
      await updateSession.mutateAsync({ sessionId: session.id, values: { startTime, endTime } })
    } catch (error) {
      onError(error)
    }
  }

  /** The class whose series is being written, if somebody pressed duplicate. */
  const [duplicating, setDuplicating] = useState<PlannerSessionDto | null>(null)

  /** The room, changed on the block: a group's usual one is only a default. */
  const setSpace = async (session: PlannerSessionDto, spaceId: string | null) => {
    try {
      await updateSession.mutateAsync({ sessionId: session.id, values: { spaceId } })
    } catch (error) {
      onError(error)
    }
  }

  /** Picking a colleague dims everybody else's classes, rather than hiding them. */
  const [teacherFilter, setTeacherFilter] = useState<string | null>(null)

  /**
   * The subject being planned.
   *
   * A coordinator plans one subject at a time — that is what they coordinate —
   * and a column listing every group of the year is a column nobody reads.
   * Empty means all of them, which is what somebody arriving wants to see
   * before they choose.
   */
  const [subjectId, setSubjectId] = useState('')

  const subjects = useMemo(() => {
    const byId = new Map<string, { id: string; code: string; name: string }>()
    for (const group of version.groups) {
      if (group.subjectId && !byId.has(group.subjectId)) {
        byId.set(group.subjectId, {
          id: group.subjectId,
          code: group.subjectCode,
          name: group.subjectName,
        })
      }
    }
    return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [version.groups])

  const shownGroups = useMemo(
    () =>
      version.groups
        .filter((group) => !subjectId || group.subjectId === subjectId)
        .sort((a, b) =>
          `${a.subjectCode}${a.groupCode}`.localeCompare(`${b.subjectCode}${b.groupCode}`),
        ),
    [subjectId, version.groups],
  )

  /**
   * Puts somebody in front of a class that is already on the grid.
   *
   * The slot is checked against what that person said about their week before
   * the change is sent: an hour they marked as one they cannot do is refused
   * outright, and one they asked to avoid goes through with a warning. Both
   * read the same rules the engine uses, so the planner and the generator
   * cannot disagree about what is allowed.
   */
  const assignTeachers = async (session: PlannerSessionDto, teacherProfileIds: string[]) => {
    // Whoever was not on the class a moment ago is the one to check: nobody
    // needs to be told again about a colleague who was already teaching it.
    const added = teacherProfileIds.filter(
      (id) => !session.teachers.some((person) => person.teacherProfileId === id),
    )

    for (const teacherProfileId of added) {
      const teacher = context.teachers.find((entry) => entry.teacherProfileId === teacherProfileId)
      const level = teacher
        ? effectiveAvailability(
            {
              weekday: session.weekday,
              start: session.startTime,
              end: session.endTime,
            },
            teacher.availability,
          )
        : 'available'

      const name =
        context.directory.find((entry) => entry.teacherProfileId === teacherProfileId)?.name ?? ''

      if (level === 'unavailable') {
        toast.error('planner.warnings.unavailable', {
          params: { name, start: session.startTime, end: session.endTime },
          durationMs: 8_000,
        })
        return
      }

      if (level === 'avoid') {
        toast.warning('planner.warnings.avoid', {
          params: { name, start: session.startTime, end: session.endTime },
          durationMs: 8_000,
        })
      }
    }

    try {
      await updateSession.mutateAsync({
        sessionId: session.id,
        values: { teacherProfileIds },
      })
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    }
  }

  /** Commits a placement, recording how to take it back. */
  const place = async (target: { weekday: number; start: string }) => {
    if (!held) return
    const evaluation = evaluations.get(cellKey(target.weekday, target.start))

    if (evaluation?.status === 'blocked') {
      const reason = evaluation.violations[0]
      setBlocked(reason ? { messageKey: reason.messageKey, params: reason.params } : null)
      setAnnouncement(
        t('planner.dropRejected', {
          reason: reason ? t(reason.messageKey, reason.params) : '',
        }),
      )
      toast.error('planner.dropRejected', {
        params: { reason: reason ? t(reason.messageKey, reason.params) : '' },
      })
      return
    }

    const endTime = addMinutes(target.start, held.durationMinutes)

    try {
      // The date the column is showing. A class is placed on a day, not on a
      // weekday: the week on screen is a week, not a template of one.
      const date = isoDateOf(dateOfWeekday(weekStart, target.weekday))

      if (held.kind === 'session' && held.sessionId) {
        const sessionId = held.sessionId
        const source = version.sessions.find((session) => session.id === sessionId)!
        const before = {
          date: source.dateFrom,
          startTime: source.startTime,
          endTime: source.endTime,
        }
        const after = { date, startTime: target.start, endTime }

        await updateSession.mutateAsync({ sessionId, values: after })
        history.record({
          sessionId,
          redo: () => updateSession.mutateAsync({ sessionId, values: after }).then(() => undefined),
          undo: () =>
            updateSession.mutateAsync({ sessionId, values: before }).then(() => undefined),
        })
      } else {
        const values = {
          groupId: held.groupId,
          teacherProfileId: held.teacherProfileId,
          spaceId: held.spaceId,
          date,
          startTime: target.start,
          endTime,
        }
        const created = await createSession.mutateAsync(values)
        const newId = newestSessionId(created, version)

        /*
          Belt and braces: a class lands on the day it was dropped on, so it is
          in the week on screen by construction. This stays because the server
          decides the date it stores, and a screen that quietly loses a class
          it has just placed is the worst thing this grid can do.
        */
        const placed = created.sessions.find((session) => session.id === newId)
        if (placed && !occursOn(placed, isoDateOf(dateOfWeekday(weekStart, placed.weekday)))) {
          const first = parseIsoDate(firstClassDate(placed))
          if (first) {
            setWeekStart(mondayOf(first))
            toast.success('planner.jumpedToWeek', {
              params: { date: formatDate(currentLocale(), first) },
            })
          }
        }

        history.record({
          sessionId: newId,
          redo: async () => newestSessionId(await createSession.mutateAsync(values), version),
          undo: async (sessionId) => {
            if (sessionId) await deleteSession.mutateAsync(sessionId)
          },
        })
      }

      setAnnouncement(
        t('planner.dropped', {
          group: held.label,
          weekday: weekdayName(target.weekday),
          start: target.start,
        }),
      )
      toast.success('planner.saved')
    } catch (error) {
      onError(error)
    } finally {
      setHeld(null)
    }
  }

  const remove = async (session: PlannerSessionDto) => {
    // What it takes to put this class back exactly where it was, if the
    // deletion is undone. Its own day, not its weekday.
    const values = {
      groupId: session.groupId,
      teacherProfileId: session.teacherProfileId,
      spaceId: session.spaceId,
      date: session.dateFrom,
      startTime: session.startTime,
      endTime: session.endTime,
      topic: session.topic,
    }

    try {
      await deleteSession.mutateAsync(session.id)
      history.record({
        sessionId: session.id,
        redo: async (): Promise<void> => {
          await deleteSession.mutateAsync(session.id)
        },
        undo: async () => newestSessionId(await createSession.mutateAsync(values), version),
      })
      toast.success('planner.saved')
    } catch (error) {
      onError(error)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent, day: number, slot: number) => {
    const lastDay = geometry.weekdays.length - 1
    const lastSlot = geometry.slots.length - 1

    const move = (nextDay: number, nextSlot: number) => {
      event.preventDefault()
      setCursor({
        day: Math.min(Math.max(nextDay, 0), lastDay),
        slot: Math.min(Math.max(nextSlot, 0), lastSlot),
      })
    }

    switch (event.key) {
      case 'ArrowRight':
        return move(day + 1, slot)
      case 'ArrowLeft':
        return move(day - 1, slot)
      case 'ArrowDown':
        return move(day, slot + 1)
      case 'ArrowUp':
        return move(day, slot - 1)
      case 'Escape':
        if (held) {
          event.preventDefault()
          setHeld(null)
          setAnnouncement(t('planner.cancelled'))
        }
        return
      default:
    }
  }

  /**
   * The classes that actually happen in the week on screen.
   *
   * The grid used to draw every session in the version whatever week it was
   * showing, so a term that has not started and a fortnightly class in its off
   * week both looked like an ordinary Monday. Now that the columns carry
   * dates, that is a straightforward contradiction: the header says the 9th of
   * February and the cell says a class that finished in December.
   */
  const thisWeek = useMemo(
    () =>
      version.sessions.filter((session) =>
        occursOn(session, isoDateOf(dateOfWeekday(weekStart, session.weekday))),
      ),
    [version.sessions, weekStart],
  )

  const occupied = useMemo(() => {
    const map = new Map<string, PlannerSessionDto>()
    for (const session of thisWeek) {
      const span = Math.max(
        1,
        Math.round(
          (Number(session.endTime.slice(0, 2)) * 60 +
            Number(session.endTime.slice(3)) -
            (Number(session.startTime.slice(0, 2)) * 60 + Number(session.startTime.slice(3)))) /
            version.grid.slotMinutes,
        ),
      )
      for (let index = 0; index < span; index += 1) {
        const start = addMinutes(session.startTime, index * version.grid.slotMinutes)
        map.set(cellKey(session.weekday, start), session)
      }
    }
    return map
  }, [thisWeek, version.grid.slotMinutes])

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-4">
          <GroupsColumn
            groups={shownGroups}
            subjects={subjects}
            subjectId={subjectId}
            onSubject={setSubjectId}
            held={held}
            editable={version.editable}
            onPick={(item) => {
              setHeld({
                kind: 'pending',
                sessionId: null,
                groupId: item.groupId,
                label: `${item.subjectCode} ${item.groupCode}`,
                durationMinutes: item.durationMinutes,
                teacherProfileId: item.candidateTeacherIds[0] ?? null,
                spaceId: item.candidateSpaceIds[0] ?? null,
                // The server gives the new class its subject's term dates; these
                // are only what the local rules compare against while it is held.
                dateFrom: version.range.from,
                dateTo: version.range.to,
              })
              setAnnouncement(
                t('planner.holding', { group: `${item.subjectCode} ${item.groupCode}` }),
              )
            }}
          />

          {/*
            Who is being loaded up, counted from what is on screen: the question
            is "if I put this here, who ends up over?", and an answer that only
            arrives after publishing is not an answer.
          */}
          <TeacherRail
            directory={context.directory}
            sessions={version.sessions}
            selectedId={teacherFilter}
            onSelect={setTeacherFilter}
          />
        </div>

        <Card>
          <CardHeader
            title={t('planner.title')}
            description={version.editable ? t('planner.subtitle') : t('planner.readOnly')}
            action={
              <div className="flex flex-wrap items-center gap-1">
                <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.undo')}
                  disabled={!history.canUndo}
                  onClick={() => void history.undo()}
                >
                  <Undo2 className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.redo')}
                  disabled={!history.canRedo}
                  onClick={() => void history.redo()}
                >
                  <Redo2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            }
          />

          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Legend />
              {/*
                Says why the grid is emptier than the version is. Without it, a
                week outside the term — or the off week of a fortnightly class
                — reads as classes that have gone missing.
              */}
              <p className="text-xs text-text-muted">
                {t('planner.thisWeekCount', {
                  shown: thisWeek.length,
                  total: version.sessions.length,
                })}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table
                className="w-full min-w-200 table-fixed border-separate border-spacing-0.5 text-xs"
                role="grid"
                aria-label={t('planner.gridLabel')}
              >
                <caption className="sr-only">{t('planner.gridLabel')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-16 py-1 text-left font-medium text-text-muted">
                      {t('common.hoursShort')}
                    </th>
                    {geometry.weekdays.map((weekday) => {
                      const date = dateOfWeekday(weekStart, weekday)
                      const isToday = isoDate(date) === isoDate(new Date())
                      const closed = closures.get(isoDateOf(date))

                      return (
                        <th
                          key={weekday}
                          scope="col"
                          className={cn(
                            'py-1 font-medium text-text-muted',
                            closed && 'bg-surface-muted',
                          )}
                          aria-current={isToday ? 'date' : undefined}
                        >
                          <span className="block">{weekdayName(weekday)}</span>
                          <span
                            className={cn(
                              'tabular block text-sm',
                              isToday ? 'font-semibold text-primary' : 'text-text',
                            )}
                          >
                            {date.getDate()}
                          </span>
                          {closed ? (
                            // The name, not just a shade: "why is Thursday
                            // grey" is a question the grid should answer.
                            <span
                              className="block truncate text-xs font-normal text-text-muted"
                              title={closed.name}
                            >
                              {closed.name}
                            </span>
                          ) : null}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {geometry.slots.map((slot, slotIndex) => (
                    /*
                      Every row is exactly one slot tall, whatever is written
                      in it. A block used to push its row open until an hour
                      with a topic and three names was twice the height of an
                      hour without — the grid stopped being to scale, and
                      dragging an edge by "one row" meant nothing.
                    */
                    <tr key={slot.start} className="h-9">
                      <th
                        scope="row"
                        className="tabular py-1 pr-2 text-right font-normal text-text-muted"
                      >
                        {slot.start}
                      </th>
                      {geometry.weekdays.map((weekday, dayIndex) => {
                        const key = cellKey(weekday, slot.start)
                        const session = occupied.get(key)
                        const starts = session?.startTime === slot.start
                        const closed = closures.get(isoDateOf(dateOfWeekday(weekStart, weekday)))

                        if (session && !starts) return null

                        const evaluation = evaluations.get(key)
                        const isCursor = cursor.day === dayIndex && cursor.slot === slotIndex

                        if (session && starts) {
                          const span = Math.max(
                            1,
                            Math.round(
                              (Number(session.endTime.slice(0, 2)) * 60 +
                                Number(session.endTime.slice(3)) -
                                (Number(session.startTime.slice(0, 2)) * 60 +
                                  Number(session.startTime.slice(3)))) /
                                version.grid.slotMinutes,
                            ),
                          )

                          return (
                            <td key={weekday} rowSpan={span} className="relative p-0 align-top">
                              <SessionBlock
                                session={session}
                                held={held?.sessionId === session.id}
                                editable={version.editable}
                                dimmed={Boolean(
                                  teacherFilter && session.teacherProfileId !== teacherFilter,
                                )}
                                directory={context.directory}
                                onAssign={(teacherProfileIds) =>
                                  void assignTeachers(session, teacherProfileIds)
                                }
                                onTopic={(topic) => void setTopic(session, topic)}
                                spaces={context.spaces}
                                onSpace={(spaceId) => void setSpace(session, spaceId)}
                                onDuplicate={() => setDuplicating(session)}
                                slotMinutes={version.grid.slotMinutes}
                                onResize={(edge, slots) => void resizeSession(session, edge, slots)}
                                onHours={(startTime, endTime) =>
                                  void setHours(session, startTime, endTime)
                                }
                                onPick={() => {
                                  setHeld(heldFromSession(session))
                                  setCursor({ day: dayIndex, slot: slotIndex })
                                  setAnnouncement(
                                    t('planner.holding', {
                                      group: `${session.subjectCode} ${session.groupCode}`,
                                    }),
                                  )
                                }}
                                onDrop={() => void place({ weekday, start: slot.start })}
                                onRemove={() => void remove(session)}
                                onKeyDown={(event) => onKeyDown(event, dayIndex, slotIndex)}
                              />
                            </td>
                          )
                        }

                        return (
                          <td
                            key={weekday}
                            // Shaded, not disabled: the week is a template, and
                            // this same Monday slot is an ordinary Monday in
                            // the other thirteen weeks of the term.
                            className={cn('p-0', closed && 'bg-surface-muted')}
                          >
                            <button
                              type="button"
                              tabIndex={isCursor ? 0 : -1}
                              disabled={!version.editable || !held}
                              aria-label={
                                held
                                  ? t('planner.moveHere', {
                                      group: held.label,
                                      weekday: weekdayName(weekday),
                                      start: slot.start,
                                    })
                                  : t('planner.cellLabel', {
                                      weekday: weekdayName(weekday),
                                      start: slot.start,
                                    })
                              }
                              title={
                                closed
                                  ? t('planner.closedOn', { name: closed.name })
                                  : reasonFor(evaluation, t)
                              }
                              onFocus={() => setCursor({ day: dayIndex, slot: slotIndex })}
                              onKeyDown={(event) => {
                                if (event.key === ' ' || event.key === 'Enter') {
                                  event.preventDefault()
                                  if (held) void place({ weekday, start: slot.start })
                                  return
                                }
                                onKeyDown(event, dayIndex, slotIndex)
                              }}
                              onClick={() => void place({ weekday, start: slot.start })}
                              onDragOver={(event) => {
                                if (held && evaluation?.status !== 'blocked') event.preventDefault()
                              }}
                              onDrop={() => void place({ weekday, start: slot.start })}
                              className={cn(
                                'h-7 w-full rounded-sm border border-transparent',
                                evaluation
                                  ? STATUS_STYLE[evaluation.status]
                                  : 'bg-surface-muted/40',
                                isCursor && 'ring-2 ring-ring',
                              )}
                            >
                              <span className="sr-only">
                                {closed
                                  ? t('planner.closedOn', { name: closed.name })
                                  : evaluation
                                    ? t(`planner.status.${evaluation.status}`)
                                    : slot.start}
                              </span>
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p aria-live="polite" className="sr-only">
              {announcement}
            </p>

            {blocked ? (
              <div
                role="alert"
                className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-text"
              >
                <p className="text-danger">{t(blocked.messageKey, blocked.params)}</p>
                <WhyThisRule messageKey={blocked.messageKey} />
              </div>
            ) : null}

            <p className="text-xs text-text-muted">
              <span className="font-medium text-text">{t('planner.keyboardTitle')}: </span>
              {t('planner.keyboardHint')}
            </p>
          </CardBody>
        </Card>
      </div>

      <StatusBar version={version} />

      {duplicating ? (
        <DuplicateDialog
          session={duplicating}
          until={version.range.to}
          onClose={() => setDuplicating(null)}
          onConfirm={async (input) => {
            try {
              const result = await duplicateSession.mutateAsync({
                sessionId: duplicating.id,
                ...input,
              })
              setDuplicating(null)
              toast.success('planner.duplicate.done', {
                params: { created: result.created, skipped: result.skipped },
              })
            } catch (error) {
              onError(error)
            }
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Repeating one class across the term.
 *
 * Nothing in this planner repeats by itself, and this does not change that:
 * what it writes is ordinary sessions, one per day, each of which can then be
 * moved or removed on its own. It only saves somebody placing the same class
 * fifteen times by hand.
 */
function DuplicateDialog({
  session,
  until,
  onClose,
  onConfirm,
}: {
  session: PlannerSessionDto
  /** The end of the year: as far as a series can possibly run. */
  until: string
  onClose: () => void
  onConfirm: (input: {
    weekdays: number[]
    startTime: string
    endTime: string
    until: string
  }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [weekdays, setWeekdays] = useState<number[]>([session.weekday])
  const [startTime, setStartTime] = useState(session.startTime)
  const [endTime, setEndTime] = useState(session.endTime)
  const [lastDate, setLastDate] = useState(until)
  const [busy, setBusy] = useState(false)

  const toggle = (weekday: number) =>
    setWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((entry) => entry !== weekday)
        : [...current, weekday].sort((a, b) => a - b),
    )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('planner.duplicate.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-card border border-border bg-surface p-5">
        <div>
          <h2 className="text-lg font-semibold text-text">{t('planner.duplicate.title')}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {`${session.subjectCode} ${session.groupCode}`}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs text-text-muted">
            {t('planner.duplicate.weekdays')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
              <label key={weekday} className="flex items-center gap-1 text-sm text-text">
                <input
                  type="checkbox"
                  checked={weekdays.includes(weekday)}
                  onChange={() => toggle(weekday)}
                  className="size-4 rounded border-border"
                />
                {t(`weekday.${weekday}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">
              {t('planner.duplicate.from')}
            </span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('planner.duplicate.to')}</span>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-text-muted">{t('planner.duplicate.until')}</span>
          <input
            type="date"
            value={lastDate}
            max={until}
            onChange={(event) => setLastDate(event.target.value)}
            className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
          />
        </label>

        <p className="text-xs text-text-muted">{t('planner.duplicate.hint')}</p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || weekdays.length === 0 || endTime <= startTime || !lastDate}
            onClick={() => {
              setBusy(true)
              void onConfirm({ weekdays, startTime, endTime, until: lastDate }).finally(() =>
                setBusy(false),
              )
            }}
          >
            {t('planner.duplicate.action')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function reasonFor(
  evaluation: CellEvaluation | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
): string | undefined {
  if (!evaluation) return undefined
  const reason = evaluation.violations[0] ?? evaluation.penalties[0]
  if (!reason) return t('planner.statusHint.valid')
  return t(reason.messageKey, reason.params)
}

function newestSessionId(version: VersionDetailDto, previous: VersionDetailDto): string | null {
  const known = new Set(previous.sessions.map((session) => session.id))
  return version.sessions.find((session) => !known.has(session.id))?.id ?? null
}

function Legend() {
  const { t } = useTranslation()

  return (
    <ul className="flex flex-wrap gap-4 text-xs text-text-muted">
      {(['valid', 'warning', 'blocked'] as const).map((status) => (
        <li key={status} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('inline-block size-3 rounded-sm', STATUS_STYLE[status]?.split(' ')[0])}
          />
          <span>
            <span className="font-medium text-text">{t(`planner.status.${status}`)}</span>{' '}
            {t(`planner.statusHint.${status}`)}
          </span>
        </li>
      ))}

      {/* The shading is a fourth thing the grid says, so it says so here. */}
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-surface-muted" />
        <span>
          <span className="font-medium text-text">{t('planner.closedLegend')}</span>{' '}
          {t('planner.closedLegendHint')}
        </span>
      </li>
    </ul>
  )
}

function SessionBlock({
  session,
  held,
  editable,
  dimmed,
  directory,
  onPick,
  onDrop,
  onRemove,
  onAssign,
  onTopic,
  spaces,
  onSpace,
  onDuplicate,
  slotMinutes,
  onResize,
  onHours,
  onKeyDown,
}: {
  session: PlannerSessionDto
  held: boolean
  editable: boolean
  /** Somebody else's class, while a colleague is selected in the rail. */
  dimmed: boolean
  directory: TeacherDirectoryEntry[]
  onPick: () => void
  onDrop: () => void
  onRemove: () => void
  onAssign: (teacherProfileIds: string[]) => void
  /** What this class is about, typed on the block. Saved when the box is left. */
  onTopic: (topic: string) => void
  spaces: SpaceResource[]
  onSpace: (spaceId: string | null) => void
  /** Opens the panel that repeats this class across the term. */
  onDuplicate: () => void
  /** How long one row of the grid is, which is what an edge moves by. */
  slotMinutes: number
  /** An edge was dragged: `slots` rows, positive downwards. */
  onResize: (edge: 'start' | 'end', slots: number) => void
  /** The hour was typed instead. */
  onHours: (startTime: string, endTime: string) => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  const { t } = useTranslation()
  /** Whether the hour is being typed rather than dragged. */
  const [typing, setTyping] = useState(false)

  return (
    <div
      className={cn(
        // Exactly the box of the hour it occupies. The edges and the buttons
        // hang off this, so they stay where the hour is; the writing scrolls
        // inside instead of spilling over the hours below.
        'group absolute inset-0 rounded-sm border border-primary/30 bg-primary-surface text-left',
        held && 'ring-2 ring-ring',
        dimmed && 'opacity-40',
      )}
    >
      <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-1">
        {/*
          The hour, typed.

          Dragging an edge is quick when the change is small and the grid is
          in front of you; typing is what somebody does when a class moves to
          08:45, or when they are working on a trackpad. Both write the same
          thing, and the server checks the same rule.
        */}
        {editable && typing ? (
          <div className="flex items-center gap-1">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('planner.hours.start')}</span>
              <input
                type="time"
                defaultValue={session.startTime}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                }}
                onBlur={(event) => {
                  if (event.target.value && event.target.value !== session.startTime) {
                    onHours(event.target.value, session.endTime)
                  }
                }}
                className="tabular w-full rounded-sm border border-border bg-surface px-1 py-0.5 text-xs text-text"
              />
            </label>
            <span aria-hidden="true" className="text-text-muted">
              –
            </span>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('planner.hours.end')}</span>
              <input
                type="time"
                defaultValue={session.endTime}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                }}
                onBlur={(event) => {
                  if (event.target.value && event.target.value !== session.endTime) {
                    onHours(session.startTime, event.target.value)
                  }
                }}
                className="tabular w-full rounded-sm border border-border bg-surface px-1 py-0.5 text-xs text-text"
              />
            </label>
          </div>
        ) : null}

        <button
          type="button"
          draggable={editable}
          disabled={!editable}
          aria-pressed={held}
          aria-label={t('planner.sessionLabel', {
            group: `${session.subjectCode} ${session.groupCode}`,
            weekday: t(`weekday.${session.weekday}`),
            start: session.startTime,
            end: session.endTime,
          })}
          onClick={() => (held ? onDrop() : onPick())}
          onDragStart={onPick}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault()
              if (held) onDrop()
              else onPick()
              return
            }
            onKeyDown(event)
          }}
          className="flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          {/*
          Subject, group, teacher and room. The subject code alone identified a
          class only to somebody who had the catalogue memorised, and the one
          thing a coordinator most needs to see at a glance — who is teaching
          it — was not on the card at all.
        */}
          <span className="block font-medium text-text" title={session.subjectName}>
            {session.subjectCode}
          </span>
          <span className="block text-text-muted">{session.groupCode}</span>
          {editable ? null : (
            <span className="block truncate text-text-muted">
              {session.spaceName ?? t('planner.unassignedSpace')}
            </span>
          )}
        </button>

        {/*
        The room. A group has one it normally meets in, and a session starts
        there — but a week has exceptions, so it is changed here rather than by
        editing the group.
      */}
        {editable ? (
          <label className="block">
            <span className="sr-only">{t('planner.assignSpace')}</span>
            <select
              value={session.spaceId ?? ''}
              onChange={(event) => onSpace(event.target.value || null)}
              onClick={(event) => event.stopPropagation()}
              className="w-full truncate rounded-sm border border-border bg-surface px-1 py-0.5 text-xs text-text"
            >
              <option value="">{t('planner.unassignedSpace')}</option>
              {spaces.map((space) => (
                <option key={space.spaceId} value={space.spaceId}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/*
        What the class is about, written on the block itself.

        Above the teacher because it is what a coordinator scans a week for —
        "where did I put the practical?" — and it is theirs to write, where the
        subject, the group and the room are all facts from elsewhere. Saved on
        leaving the box rather than on every keystroke: a session is a row on
        the server, and a request per letter is a request per letter.
      */}
        {editable ? (
          <label className="block">
            <span className="sr-only">{t('planner.topic')}</span>
            <input
              type="text"
              maxLength={200}
              defaultValue={session.topic ?? ''}
              placeholder={t('planner.topicPlaceholder')}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              }}
              onBlur={(event) => {
                if (event.target.value !== (session.topic ?? '')) onTopic(event.target.value)
              }}
              className="w-full rounded-sm border border-border bg-surface px-1 py-0.5 text-xs text-text"
            />
          </label>
        ) : session.topic ? (
          <span className="block truncate font-medium text-text" title={session.topic}>
            {session.topic}
          </span>
        ) : null}

        {/*
        The teacher, chosen here rather than only by dragging from the pending
        column: a class that is already placed still needs somebody to teach it,
        and there was nowhere in the planner to say who.
      */}
        {editable ? (
          <TeacherPickers session={session} directory={directory} onAssign={onAssign} />
        ) : session.teachers.length > 0 ? (
          <span
            className="block truncate text-text-muted"
            title={session.teachers.map((person) => person.name).join(' · ')}
          >
            {session.teachers.map((person) => person.name).join(' · ')}
          </span>
        ) : (
          <span className="block truncate text-text-muted">{t('planner.unassignedTeacher')}</span>
        )}
      </div>

      {editable ? (
        <>
          <ResizeHandle
            edge="start"
            session={session}
            slotMinutes={slotMinutes}
            onResize={onResize}
          />
          <ResizeHandle
            edge="end"
            session={session}
            slotMinutes={slotMinutes}
            onResize={onResize}
          />
        </>
      ) : null}

      {editable ? (
        <div className="absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex group-focus-within:flex">
          <button
            type="button"
            aria-label={t('planner.hours.edit')}
            aria-expanded={typing}
            onClick={() => setTyping(!typing)}
            className="rounded-sm p-0.5 text-text-muted hover:bg-surface hover:text-primary"
          >
            <Clock className="size-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('planner.duplicate.action')}
            onClick={onDuplicate}
            className="rounded-sm p-0.5 text-text-muted hover:bg-surface hover:text-primary"
          >
            <CopyPlus className="size-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('common.remove')}
            onClick={onRemove}
            className="rounded-sm p-0.5 text-text-muted hover:bg-surface hover:text-danger"
          >
            <Trash2 className="size-3" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The edge of a class, dragged to make it longer or shorter.
 *
 * A timetable is read in hours, so the grid's own rows are the unit: a row of
 * the table is one slot, the edge moves in whole slots, and the class is
 * written when the pointer is let go. Measuring the row rather than the block
 * matters — the block is as tall as what is written on it, which is not the
 * hour it occupies, and measuring that made a whole row of movement round to
 * nothing.
 *
 * The pointer is followed on the window, so a drag that leaves the six pixels
 * of the handle — which every drag does — is still a drag. While it lasts the
 * hour it would become is shown on the handle, because an edge that moves with
 * no feedback is indistinguishable from one that does not work. The arrow keys
 * do the same thing: a planner nobody can drive from the keyboard is a planner
 * some people cannot use at all (R8).
 */
function ResizeHandle({
  edge,
  session,
  slotMinutes,
  onResize,
}: {
  edge: 'start' | 'end'
  session: PlannerSessionDto
  slotMinutes: number
  onResize: (edge: 'start' | 'end', slots: number) => void
}) {
  const { t } = useTranslation()
  const [slots, setSlots] = useState<number | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const handle = event.currentTarget
    // One row of the grid is one slot, whatever the screen is doing to it.
    const slotHeight = handle.closest('tr')?.getBoundingClientRect().height ?? 0
    if (slotHeight <= 0) return

    const from = event.clientY
    const stepsFrom = (moved: { clientY: number }) =>
      Math.round((moved.clientY - from) / slotHeight)

    // Capture keeps the drag alive over anything it passes; where it is not
    // available the window listeners below carry it anyway.
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // Nothing to do: the drag works without it.
    }

    const move = (moved: PointerEvent) => setSlots(stepsFrom(moved))

    const finish = (up: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setSlots(null)
      onResize(edge, stepsFrom(up))
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const dragging = slots !== null
  const preview = dragging
    ? addMinutes(edge === 'start' ? session.startTime : session.endTime, slots * slotMinutes)
    : null

  return (
    <button
      type="button"
      aria-label={t(`planner.resize.${edge}`)}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        event.stopPropagation()
        onResize(edge, event.key === 'ArrowDown' ? 1 : -1)
      }}
      className={cn(
        'absolute inset-x-0 z-10 h-2 cursor-ns-resize touch-none',
        'hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-2 focus-visible:outline-ring',
        dragging && 'bg-primary/60',
        edge === 'start' ? 'top-0' : 'bottom-0',
      )}
    >
      {preview ? (
        <span className="tabular pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-sm bg-primary px-1 text-[10px] text-primary-contrast">
          {preview}
        </span>
      ) : null}
    </button>
  )
}

/**
 * Who gives this class — one person, or several.
 *
 * The names read as one line: a class given by two lecturers is a class, not
 * two, and a picker per person turned a cell in a week grid into a column of
 * dropdowns. Each name carries the button that takes that person off the
 * class, and one dropdown underneath adds the next one. A cell has no room
 * for a dialog, and both controls are reachable from the keyboard (R8).
 */
function TeacherPickers({
  session,
  directory,
  onAssign,
}: {
  session: PlannerSessionDto
  directory: TeacherDirectoryEntry[]
  onAssign: (teacherProfileIds: string[]) => void
}) {
  const { t } = useTranslation()
  const current = session.teachers.map((person) => person.teacherProfileId)
  const full = current.length >= MAX_TEACHERS_PER_SESSION

  return (
    <div className="min-w-0 space-y-0.5">
      {session.teachers.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-x-1 text-xs text-text-muted"
          title={session.teachers.map((person) => person.name).join(' · ')}
        >
          {session.teachers.map((person, index) => (
            <span key={person.teacherProfileId} className="inline-flex items-center gap-0.5">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <span className="truncate">{person.name}</span>
              <button
                type="button"
                aria-label={t('planner.removeTeacher', { name: person.name })}
                onClick={(event) => {
                  event.stopPropagation()
                  onAssign(current.filter((id) => id !== person.teacherProfileId))
                }}
                className="rounded-sm text-text-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {full ? null : (
        <label className="block">
          <span className="sr-only">
            {current.length === 0 ? t('planner.assignTeacher') : t('planner.addTeacher')}
          </span>
          <select
            // Always empty: this is the control that adds somebody, and the
            // people already on the class are the line above it.
            value=""
            onChange={(event) => {
              if (event.target.value) onAssign([...current, event.target.value])
            }}
            onClick={(event) => event.stopPropagation()}
            className="w-full truncate rounded-sm border border-border bg-surface px-1 py-0.5 text-xs text-text"
          >
            <option value="">
              {current.length === 0 ? t('planner.unassignedTeacher') : t('planner.addTeacher')}
            </option>
            {directory
              .filter((teacher) => !current.includes(teacher.teacherProfileId))
              .map((teacher) => (
                <option key={teacher.teacherProfileId} value={teacher.teacherProfileId}>
                  {teacher.name}
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  )
}

/**
 * The groups of the subject being planned, and how much of each is still to
 * place.
 *
 * It used to list only what was left over, one entry per unplaced session,
 * and only for groups somebody had already been assigned to. Three things
 * were wrong with that. A coordinator plans a subject and wants to see its
 * groups — the finished ones as much as the empty ones, because "have I done
 * this one?" is the question the column exists to answer. A group with nobody
 * assigned to it is precisely one that needs the work, so hiding it hid the
 * work. And a row that disappears when it is done tells you nothing about
 * what it was.
 */
function GroupsColumn({
  groups,
  subjects,
  subjectId,
  onSubject,
  held,
  editable,
  onPick,
}: {
  groups: GroupPlanDto[]
  subjects: { id: string; code: string; name: string }[]
  subjectId: string
  onSubject: (id: string) => void
  held: HeldSession | null
  editable: boolean
  onPick: (item: GroupPlanDto) => void
}) {
  const { t } = useTranslation()
  const locale = currentLocale()

  return (
    <Card className="h-fit">
      <CardHeader title={t('planner.groups.title')} />
      <CardBody className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-text-muted">{t('planner.groups.subject')}</span>
          <select
            value={subjectId}
            onChange={(event) => onSubject(event.target.value)}
            className="h-9 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
          >
            <option value="">{t('planner.groups.allSubjects')}</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {`${subject.code} · ${subject.name}`}
              </option>
            ))}
          </select>
        </label>

        {groups.length === 0 ? (
          <p className="text-sm text-text-muted">{t('planner.groups.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((item) => {
              const picked = held?.kind === 'pending' && held.groupId === item.groupId

              return (
                <li key={item.groupId}>
                  <button
                    type="button"
                    draggable={editable}
                    disabled={!editable}
                    aria-pressed={picked}
                    aria-label={t('planner.pickSession', {
                      group: `${item.subjectCode} ${item.groupCode}`,
                    })}
                    onClick={() => onPick(item)}
                    onDragStart={() => onPick(item)}
                    className={cn(
                      'w-full rounded-control border p-2 text-left text-sm',
                      // Done is stated, not hidden: the row stays so the
                      // column answers "have I finished this one?".
                      item.complete
                        ? 'border-load-optimal/40 bg-load-optimal-surface'
                        : 'border-border bg-surface-muted',
                      picked ? 'ring-2 ring-ring' : 'hover:border-primary',
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-text">
                        {`${item.subjectCode} ${item.groupCode}`}
                      </span>
                      <span className="tabular shrink-0 text-xs text-text-muted">
                        {t('planner.groups.perYear', {
                          hours: formatHours(locale, minutesToHours(item.targetMinutes)),
                        })}
                      </span>
                    </span>

                    <span className="block truncate text-text-muted">{item.subjectName}</span>

                    <span
                      className={cn(
                        'tabular mt-1 block text-xs font-medium',
                        item.overplannedMinutes > 0
                          ? 'text-load-over'
                          : item.complete
                            ? 'text-load-optimal'
                            : 'text-text',
                      )}
                    >
                      {item.overplannedMinutes > 0
                        ? t('planner.groups.over', {
                            hours: formatHours(locale, minutesToHours(item.overplannedMinutes)),
                          })
                        : item.complete
                          ? t('planner.groups.done')
                          : t('planner.groups.remaining', {
                              hours: formatHours(locale, minutesToHours(item.remainingMinutes)),
                            })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function StatusBar({ version }: { version: VersionDetailDto }) {
  const { t } = useTranslation()
  const summary = version.summary

  const items = [
    { key: 'placed', value: summary.placed, tone: 'text-text' },
    {
      key: 'pending',
      value: summary.pending,
      tone: summary.pending > 0 ? 'text-warning' : 'text-text',
    },
    {
      key: 'blocked',
      value: summary.blocked,
      tone: summary.blocked > 0 ? 'text-danger' : 'text-text',
    },
    { key: 'warnings', value: summary.warnings, tone: 'text-text' },
    {
      key: 'outOfRange',
      value: summary.teachersOutOfRange,
      tone: summary.teachersOutOfRange > 0 ? 'text-warning' : 'text-text',
    },
    { key: 'cost', value: summary.softCost, tone: 'text-text' },
  ] as const

  return (
    <dl className="grid grid-cols-2 gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-6">
      {items.map((item) => (
        <div key={item.key}>
          <dt className="text-xs text-text-muted">{t(`planner.summary.${item.key}`)}</dt>
          <dd className={cn('tabular text-lg font-semibold', item.tone)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
