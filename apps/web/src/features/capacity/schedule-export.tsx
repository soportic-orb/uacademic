import { useMutation } from '@tanstack/react-query'
import { FileDown, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiDownload, apiJson } from '../../lib/api'

/** The first of this month to the last of the one after: a sensible default. */
function defaultRange(): { from: string; to: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 2, 0)
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`
  return { from: iso(first), to: iso(last) }
}

/**
 * Printing a timetable, and sending it out.
 *
 * The range is asked for every time rather than defaulted to the whole year: a
 * term, the month before an exam period, the fortnight somebody is covering
 * for a colleague — the useful ranges are all shorter than the year, and a
 * ninety-page PDF is one nobody prints.
 */
export function ScheduleExport({
  teacherId,
  canSendToEveryone = false,
  published = true,
}: {
  /** Whose timetable to download. Absent on the planning screen, which is
   * about everybody at once and has nobody in particular to print. */
  teacherId?: string
  canSendToEveryone?: boolean
  /**
   * Whether there is a published timetable to send.
   *
   * A draft is nobody's week: sending one out would put a timetable in front
   * of thirty people that the coordinator is still moving around.
   */
  published?: boolean
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [range, setRange] = useState(defaultRange)
  const [busy, setBusy] = useState(false)

  /*
    A date input reports an empty value while somebody is still typing one —
    "2026-0" is not a date — so the state kept a blank, the button stayed
    enabled, and pressing it asked the server to send a timetable for no
    period at all. Now an incomplete date simply is not a range yet.
  */
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to)
  const usable = complete && range.to >= range.from

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const download = async () => {
    if (!teacherId) return
    setBusy(true)
    try {
      const blob = await apiDownload(
        `/api/v1/teachers/${teacherId}/schedule.pdf?from=${range.from}&to=${range.to}`,
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `uacademic-${range.from}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  const send = useMutation({
    mutationFn: () =>
      apiJson<{ queued: number; mailConfigured: boolean }>(
        '/api/v1/teachers/schedules/send',
        'POST',
        range,
      ),
    onSuccess: (result) => {
      // Saying "sent" when there is no mail server is the kind of small lie
      // that costs somebody an afternoon of looking for the message.
      if (result.mailConfigured)
        toast.success('teachers.schedule.sent', { params: { count: result.queued } })
      else toast.warning('teachers.schedule.sentNoMail', { durationMs: 10_000 })
    },
    onError,
  })

  return (
    <Card>
      <CardHeader
        title={t('teachers.schedule.title')}
        description={t(teacherId ? 'teachers.schedule.hint' : 'teachers.schedule.hintAll')}
      />
      <CardBody>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('admin.fields.dateFrom')}</span>
            <input
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
              className="h-10 rounded-control border border-border bg-surface px-3 text-sm text-text"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('admin.fields.dateTo')}</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
              className="h-10 rounded-control border border-border bg-surface px-3 text-sm text-text"
            />
          </label>

          {teacherId ? (
            <Button onClick={() => void download()} disabled={busy || !usable}>
              <FileDown className="size-4" aria-hidden="true" />
              {busy ? t('common.loading') : t('teachers.schedule.download')}
            </Button>
          ) : null}

          {canSendToEveryone ? (
            <Button
              variant="secondary"
              onClick={() => {
                // Said out loud rather than left as a disabled button nobody
                // can explain: what is missing is a publication, and that is
                // one press away on the bar at the top of this screen.
                if (!published) {
                  toast.warning('teachers.schedule.publishFirst', { durationMs: 8_000 })
                  return
                }
                send.mutate()
              }}
              disabled={send.isPending || !usable}
            >
              <Send className="size-4" aria-hidden="true" />
              {send.isPending ? t('common.saving') : t('teachers.schedule.sendAll')}
            </Button>
          ) : null}
        </div>

        {canSendToEveryone && !published ? (
          <p className="mt-3 text-xs text-warning">{t('teachers.schedule.publishFirst')}</p>
        ) : null}

        {complete ? null : (
          <p className="mt-3 text-xs text-text-muted">{t('teachers.schedule.dateNeeded')}</p>
        )}

        <p className="mt-3 text-xs text-text-muted">{t('teachers.schedule.format')}</p>
      </CardBody>
    </Card>
  )
}
