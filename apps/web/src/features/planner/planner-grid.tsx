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
import type { CellEvaluation } from '@uacademic/shared'
import { Trash2, Undo2, Redo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
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

  /** Commits a placement, recording how to take it back. */
  const place = async (target: { weekday: number; start: string }) => {
    if (!held) return
    const evaluation = evaluations.get(cellKey(target.weekday, target.start))

    if (evaluation?.status === 'blocked') {
      const reason = evaluation.violations[0]
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

        <Card>
          <CardHeader
            title={t('planner.title')}
            description={version.editable ? t('planner.subtitle') : t('planner.readOnly')}
            action={
              <div className="flex gap-1">
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
                    {geometry.weekdays.map((weekday) => (
                      <th key={weekday} scope="col" className="py-1 font-medium text-text-muted">
                        {weekdayName(weekday)}
                      </th>
                    ))}
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
                          <td key={weekday} className="p-0">
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
                              title={reasonFor(evaluation, t)}
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
                                {evaluation ? t(`planner.status.${evaluation.status}`) : slot.start}
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
    </ul>
  )
}

function SessionBlock({
  session,
  held,
  editable,
  onPick,
  onDrop,
  onRemove,
  onKeyDown,
}: {
  session: PlannerSessionDto
  held: boolean
  editable: boolean
  onPick: () => void
  onDrop: () => void
  onRemove: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col gap-0.5 rounded-sm border border-primary/30 bg-primary-surface p-1 text-left',
        held && 'ring-2 ring-ring',
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
        <span className="block font-medium text-text">{session.subjectCode}</span>
        <span className="block text-text-muted">{session.groupCode}</span>
        <span className="block truncate text-text-muted">
          {session.spaceName ?? t('planner.unassignedSpace')}
        </span>
      </button>

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
