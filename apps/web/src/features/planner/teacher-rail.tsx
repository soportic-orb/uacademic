import { formatHours, formatPercent } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'

import { LoadBadge } from '../../components/data/load-badge'
import { Avatar } from '../../components/ui/avatar'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { currentLocale } from '../../i18n'
import { cn } from '../../lib/cn'
import type { PlannerSessionDto } from './queries'
import type { TeacherDirectoryEntry } from './use-planner'

/** Hours a session is worth, from its own start and end. */
function sessionHours(session: PlannerSessionDto): number {
  const minutes =
    Number(session.endTime.slice(0, 2)) * 60 +
    Number(session.endTime.slice(3)) -
    (Number(session.startTime.slice(0, 2)) * 60 + Number(session.startTime.slice(3)))
  return minutes / 60
}

/**
 * The colleagues, and what this version is doing to their weeks.
 *
 * Counted from the sessions on screen rather than from the stored load, so the
 * figures move as classes are dropped: the question a coordinator is actually
 * asking is "if I put this here, who ends up over?", and an answer that only
 * arrives after publishing is not an answer.
 */
export function TeacherRail({
  directory,
  sessions,
  selectedId,
  onSelect,
}: {
  directory: TeacherDirectoryEntry[]
  sessions: PlannerSessionDto[]
  selectedId: string | null
  onSelect: (teacherProfileId: string | null) => void
}) {
  const { t } = useTranslation()
  const locale = currentLocale()

  const assigned = new Map<string, number>()
  for (const session of sessions) {
    if (!session.teacherProfileId) continue
    assigned.set(
      session.teacherProfileId,
      (assigned.get(session.teacherProfileId) ?? 0) + sessionHours(session),
    )
  }

  return (
    <Card>
      <CardHeader title={t('planner.teachers.title')} description={t('planner.teachers.hint')} />
      <CardBody className="max-h-96 space-y-1 overflow-y-auto">
        {directory.length === 0 ? (
          <p className="text-sm text-text-muted">{t('planner.teachers.none')}</p>
        ) : null}

        {directory.map((teacher) => {
          const hours = assigned.get(teacher.teacherProfileId) ?? 0
          const weekly = teacher.weeklyCapacityHours
          const ratio = weekly && weekly > 0 ? (hours / weekly) * 100 : null
          const picked = selectedId === teacher.teacherProfileId

          return (
            <button
              key={teacher.teacherProfileId}
              type="button"
              aria-pressed={picked}
              onClick={() => onSelect(picked ? null : teacher.teacherProfileId)}
              className={cn(
                'flex w-full items-center gap-2 rounded-control border px-2 py-1.5 text-left',
                picked
                  ? 'border-primary bg-primary-50'
                  : 'border-transparent hover:bg-surface-muted',
              )}
            >
              <Avatar name={teacher.name} url={teacher.avatarUrl} size="xs" />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{teacher.name}</span>
                <span className="tabular block text-xs text-text-muted">
                  {formatHours(locale, hours)}
                  {weekly ? ` / ${formatHours(locale, weekly)}` : ''} {t('common.hoursShort')}
                </span>
              </span>

              {ratio === null ? null : (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular text-xs text-text-muted">
                    {formatPercent(locale, ratio)}
                  </span>
                  <LoadBadge status={statusOf(ratio)} />
                </span>
              )}
            </button>
          )
        })}
      </CardBody>
    </Card>
  )
}

/**
 * The same bands as everywhere else in the product (CLAUDE.md §4), applied to
 * one week rather than to a year.
 */
function statusOf(ratio: number): 'under' | 'optimal' | 'limit' | 'over' {
  if (ratio < 85) return 'under'
  if (ratio <= 100) return 'optimal'
  if (ratio <= 110) return 'limit'
  return 'over'
}
