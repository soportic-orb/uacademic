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
  closuresInRange,
  effectiveAvailability,
  isoDateOf,
} from '@uacademic/shared'
import { Trash2, Undo2, Redo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { WhyThisRule } from '../settings/why-this-rule'
import { ApiRequestError } from '../../lib/api'
import { cn } from '../../lib/cn'
import {
  type PendingGroupDto,
  type PlannerSessionDto,
  type VersionDetailDto,
  useCreateSession,
  useDeleteSession,
  useUpdateSession,
} from './queries'
import { TeacherRail } from './teacher-rail'
import type { TeacherDirectoryEntry } from './use-planner'
import { dateOfWeekday, isoDate, mondayOf } from './week-dates'
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
  useUndoRedo,
} from './use-planner'

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
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))

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

  /** Picking a colleague dims everybody else's classes, rather than hiding them. */
  const [teacherFilter, setTeacherFilter] = useState<string | null>(null)

  /**
   * Puts somebody in front of a class that is already on the grid.
   *
   * The slot is checked against what that person said about their week before
   * the change is sent: an hour they marked as one they cannot do is refused
   * outright, and one they asked to avoid goes through with a warning. Both
   * read the same rules the engine uses, so the planner and the generator
   * cannot disagree about what is allowed.
   */
  const assignTeacher = async (session: PlannerSessionDto, teacherProfileId: string | null) => {
    if (teacherProfileId) {
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
        values: { teacherProfileId },
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
      if (held.kind === 'session' && held.sessionId) {
        const sessionId = held.sessionId
        const source = version.sessions.find((session) => session.id === sessionId)!
        const before = {
          weekday: source.weekday,
          startTime: source.startTime,
          endTime: source.endTime,
        }
        const after = { weekday: target.weekday, startTime: target.start, endTime }

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
          weekday: target.weekday,
          startTime: target.start,
          endTime,
        }
        const created = await createSession.mutateAsync(values)
        const newId = newestSessionId(created, version)

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
    const values = {
      groupId: session.groupId,
      teacherProfileId: session.teacherProfileId,
      spaceId: session.spaceId,
      weekday: session.weekday,
      startTime: session.startTime,
      endTime: session.endTime,
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

  const occupied = useMemo(() => {
    const map = new Map<string, PlannerSessionDto>()
    for (const session of version.sessions) {
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
  }, [version])

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-4">
          <PendingColumn
            pending={version.pending}
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
                dateFrom: version.sessions[0]?.dateFrom ?? new Date().toISOString().slice(0, 10),
                dateTo: version.sessions[0]?.dateTo ?? new Date().toISOString().slice(0, 10),
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
            <Legend />

            <div className="overflow-x-auto">
              <table
                className="w-full min-w-200 border-separate border-spacing-0.5 text-xs"
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
                    <tr key={slot.start}>
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
                            <td key={weekday} rowSpan={span} className="p-0 align-top">
                              <SessionBlock
                                session={session}
                                held={held?.sessionId === session.id}
                                editable={version.editable}
                                dimmed={Boolean(
                                  teacherFilter && session.teacherProfileId !== teacherFilter,
                                )}
                                directory={context.directory}
                                onAssign={(teacherProfileId) =>
                                  void assignTeacher(session, teacherProfileId)
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
  onAssign: (teacherProfileId: string | null) => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col gap-0.5 rounded-sm border border-primary/30 bg-primary-surface p-1 text-left',
        held && 'ring-2 ring-ring',
        dimmed && 'opacity-40',
      )}
    >
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
        <span className="block truncate text-text-muted">
          {session.spaceName ?? t('planner.unassignedSpace')}
        </span>
      </button>

      {/*
        The teacher, chosen here rather than only by dragging from the pending
        column: a class that is already placed still needs somebody to teach it,
        and there was nowhere in the planner to say who.
      */}
      {editable ? (
        <label className="block">
          <span className="sr-only">{t('planner.assignTeacher')}</span>
          <select
            value={session.teacherProfileId ?? ''}
            onChange={(event) => onAssign(event.target.value || null)}
            onClick={(event) => event.stopPropagation()}
            className="w-full truncate rounded-sm border border-border bg-surface px-1 py-0.5 text-xs text-text"
          >
            <option value="">{t('planner.unassignedTeacher')}</option>
            {directory.map((teacher) => (
              <option key={teacher.teacherProfileId} value={teacher.teacherProfileId}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="block truncate text-text-muted">
          {session.teacherName ?? t('planner.unassignedTeacher')}
        </span>
      )}

      {editable ? (
        <button
          type="button"
          aria-label={t('common.remove')}
          onClick={onRemove}
          className="absolute right-0.5 top-0.5 hidden rounded-sm p-0.5 text-text-muted hover:bg-surface hover:text-danger group-hover:block focus-visible:block"
        >
          <Trash2 className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

function PendingColumn({
  pending,
  held,
  editable,
  onPick,
}: {
  pending: PendingGroupDto[]
  held: HeldSession | null
  editable: boolean
  onPick: (item: PendingGroupDto) => void
}) {
  const { t } = useTranslation()

  return (
    <Card className="h-fit">
      <CardHeader title={t('planner.pending')} />
      <CardBody>
        {pending.length === 0 ? (
          <p className="text-sm text-text-muted">{t('planner.pendingEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((item) => (
              <li key={item.requirementId}>
                <button
                  type="button"
                  draggable={editable}
                  disabled={!editable}
                  aria-pressed={held?.groupId === item.groupId && held.kind === 'pending'}
                  aria-label={t('planner.pickSession', {
                    group: `${item.subjectCode} ${item.groupCode}`,
                  })}
                  onClick={() => onPick(item)}
                  onDragStart={() => onPick(item)}
                  className={cn(
                    'w-full rounded-control border border-border bg-surface-muted p-2 text-left text-sm',
                    held?.groupId === item.groupId && held.kind === 'pending'
                      ? 'ring-2 ring-ring'
                      : 'hover:border-primary',
                  )}
                >
                  <span className="block font-medium text-text">
                    {`${item.subjectCode} ${item.groupCode}`}
                  </span>
                  <span className="block text-text-muted">{item.subjectName}</span>
                </button>
              </li>
            ))}
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
