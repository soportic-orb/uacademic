/**
 * Dated exceptions: conferences, leave, sick leave. They only ever tighten the
 * weekly pattern — that rule lives in the domain package, not here.
 */
import type { AvailabilityLevel, AvailabilityResponseDto } from '@uacademic/shared'
import { AVAILABILITY_LEVELS, formatDate } from '@uacademic/shared'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError } from '../../lib/api'
import { useDeleteException, useSaveException } from './queries'

export function ExceptionsPanel({
  teacherId,
  data,
}: {
  teacherId: string
  data: AvailabilityResponseDto
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const create = useSaveException(teacherId)
  const remove = useDeleteException(teacherId)

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    dateFrom: '',
    dateTo: '',
    reason: '',
    level: 'unavailable' as AvailabilityLevel,
  })

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    create.mutate(
      {
        dateFrom: form.dateFrom,
        dateTo: form.dateTo || form.dateFrom,
        level: form.level,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success('teachers.exceptions.created')
          setOpen(false)
          setForm({ dateFrom: '', dateTo: '', reason: '', level: 'unavailable' })
        },
        onError,
      },
    )
  }

  return (
    <Card>
      <CardHeader
        title={t('teachers.exceptions.title')}
        description={t('teachers.exceptions.subtitle')}
        action={
          data.editable ? (
            <Button variant="secondary" onClick={() => setOpen((current) => !current)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('teachers.exceptions.add')}
            </Button>
          ) : null
        }
      />

      <CardBody className="space-y-4">
        {open && data.editable ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">
                {t('teachers.exceptions.dateFrom')}
              </span>
              <input
                type="date"
                required
                value={form.dateFrom}
                onChange={(event) => setForm({ ...form, dateFrom: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('teachers.exceptions.dateTo')}</span>
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
              <span className="mb-1 block text-text-muted">{t('teachers.exceptions.level')}</span>
              <select
                value={form.level}
                onChange={(event) =>
                  setForm({ ...form, level: event.target.value as AvailabilityLevel })
                }
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
              >
                {AVAILABILITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`availabilityLevel.${level}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('teachers.exceptions.reason')}</span>
              <input
                type="text"
                value={form.reason}
                placeholder={t('teachers.exceptions.reasonPlaceholder')}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
              />
            </label>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={create.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        ) : null}

        {data.exceptions.length === 0 ? (
          <EmptyState title={t('teachers.exceptions.empty')} />
        ) : (
          <ul className="divide-y divide-border">
            {data.exceptions.map((exception) => (
              <li key={exception.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="tabular text-sm font-medium text-text">
                    {`${formatDate(locale, new Date(exception.dateFrom))} – ${formatDate(
                      locale,
                      new Date(exception.dateTo),
                    )}`}
                  </p>
                  <p className="text-sm text-text-muted">
                    {`${t(`availabilityLevel.${exception.level}`)}${
                      exception.reason ? ` · ${exception.reason}` : ''
                    }`}
                  </p>
                </div>
                {data.editable ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.remove')}
                    onClick={() => {
                      if (!window.confirm(t('teachers.exceptions.confirmRemove'))) return
                      remove.mutate(exception.id, {
                        onSuccess: () => toast.success('teachers.exceptions.removed'),
                        onError,
                      })
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
