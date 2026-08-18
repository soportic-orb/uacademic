/**
 * Absences: report the days you will be away, then answer the question that
 * always follows — who takes the classes.
 *
 * Reporting is anybody's; ranking and asking a colleague to cover is
 * coordination's, and the API says which of the two the reader is.
 */
import { formatDate } from '@uacademic/shared'
import { CalendarOff, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, TableSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { CandidateList } from '../features/absences/candidate-list'
import {
  useAbsenceSessions,
  useAbsences,
  useReportAbsence,
} from '../features/collaboration/queries'
import { useToast } from '../hooks/use-toast'
import { currentLocale } from '../i18n'
import { ApiRequestError } from '../lib/api'

const TYPES = ['sick_leave', 'personal_leave', 'conference', 'training', 'other'] as const

function ReportForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const report = useReportAbsence()
  const [form, setForm] = useState({
    dateFrom: '',
    dateTo: '',
    type: 'sick_leave' as (typeof TYPES)[number],
    reason: '',
  })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    report.mutate(
      {
        dateFrom: form.dateFrom,
        dateTo: form.dateTo || form.dateFrom,
        type: form.type,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success('absences.reported')
          onDone()
        },
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader title={t('absences.report')} description={t('absences.subtitle')} />
      <CardBody>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('absences.dateFrom')}</span>
            <input
              type="date"
              required
              value={form.dateFrom}
              onChange={(event) => setForm({ ...form, dateFrom: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('absences.dateTo')}</span>
            <input
              type="date"
              required
              min={form.dateFrom}
              value={form.dateTo}
              onChange={(event) => setForm({ ...form, dateTo: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('absences.type')}</span>
            <select
              value={form.type}
              onChange={(event) =>
                setForm({ ...form, type: event.target.value as (typeof TYPES)[number] })
              }
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`absenceType.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('absences.reason')}</span>
            <input
              type="text"
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={report.isPending}>
              {t('absences.report')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function AbsenceDetail({ absenceId, canManage }: { absenceId: string; canManage: boolean }) {
  const { t } = useTranslation()
  const sessions = useAbsenceSessions(absenceId)
  const [sessionId, setSessionId] = useState<string | null>(null)

  if (sessions.isPending) return <TableSkeleton rows={3} columns={3} />
  if (sessions.isError) return <ErrorState onRetry={() => void sessions.refetch()} />

  const items = sessions.data.items

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('absences.affectedSessions')} />
        <CardBody>
          {items.length === 0 ? (
            <p className="text-sm text-text-muted">{t('absences.noSessions')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-text">{session.label}</p>
                    <p className="tabular text-xs text-text-muted">
                      {`${t(`weekday.${session.weekday}`)} ${session.startTime}–${session.endTime}${
                        session.spaceName ? ` · ${session.spaceName}` : ''
                      }`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={sessionId === session.id ? 'primary' : 'secondary'}
                    aria-pressed={sessionId === session.id}
                    onClick={() => setSessionId(session.id)}
                  >
                    {t('absences.findSubstitute')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {sessionId ? (
        <Card>
          <CardHeader title={t('substitutes.title')} />
          <CardBody>
            <CandidateList absenceId={absenceId} sessionId={sessionId} canManage={canManage} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

export function AbsencesPage() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const query = useAbsences()
  const [reporting, setReporting] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const items = query.data?.items ?? []
  const canManage = query.data?.canManage ?? false
  const current = selected ?? items[0]?.id ?? null

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('absences.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('absences.subtitle')}</p>
        </div>
        <Button onClick={() => setReporting((value) => !value)}>
          <Plus className="size-4" aria-hidden="true" />
          {t('absences.report')}
        </Button>
      </header>

      {reporting ? <ReportForm onDone={() => setReporting(false)} /> : null}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader title={t('absences.title')} />
          <CardBody>
            {query.isPending ? <TableSkeleton rows={4} columns={2} /> : null}
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : null}
            {query.data && items.length === 0 ? (
              <EmptyState
                title={t('absences.empty')}
                actionLabel={t('absences.report')}
                onAction={() => setReporting(true)}
                icon={<CalendarOff className="size-8" aria-hidden="true" />}
              />
            ) : null}

            {items.length > 0 ? (
              <ul className="divide-y divide-border">
                {items.map((absence) => (
                  <li key={absence.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(absence.id)}
                      aria-current={current === absence.id}
                      className={`w-full rounded-control px-2 py-3 text-left hover:bg-surface-muted ${
                        current === absence.id ? 'bg-surface-muted' : ''
                      }`}
                    >
                      <span className="block text-sm font-medium text-text">
                        {absence.teacherName}
                      </span>
                      <span className="tabular mt-0.5 block text-xs text-text-muted">
                        {`${formatDate(locale, new Date(absence.dateFrom))} – ${formatDate(
                          locale,
                          new Date(absence.dateTo),
                        )} · ${t(`absenceType.${absence.type}`)}`}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {t(`absences.status.${absence.status}`)}
                        {absence.substituteName
                          ? ` · ${t('absences.substituteAsked', { name: absence.substituteName })}`
                          : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        {current ? (
          <AbsenceDetail absenceId={current} canManage={canManage} />
        ) : (
          <EmptyState title={t('absences.empty')} />
        )}
      </div>
    </div>
  )
}
