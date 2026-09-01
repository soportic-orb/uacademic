/**
 * The teacher's calendar: day, week, month and agenda, over the published
 * timetable.
 *
 * The occurrences are expanded by the API (holidays already removed), so the
 * four views draw exactly the same days the ICS feed publishes and the PDF
 * prints — one source, four renderings.
 */
import type { EventInput } from '@fullcalendar/core'
import caLocale from '@fullcalendar/core/locales/ca'
import enLocale from '@fullcalendar/core/locales/en-gb'
import esLocale from '@fullcalendar/core/locales/es'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { useQuery } from '@tanstack/react-query'
import { CalendarSync, Download, FileText } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiDownload, apiFetch } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

interface CalendarEvent {
  sessionId: string
  date: string
  startTime: string
  endTime: string
  subjectId: string
  subjectCode: string
  subjectName: string
  groupCode: string
  spaceName: string | null
  /** What the class is about, as written on the planner block. */
  topic: string | null
}

interface CalendarResponse {
  from: string
  to: string
  subjects: { id: string; code: string; name: string }[]
  events: CalendarEvent[]
}

const VIEWS = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth',
  agenda: 'listMonth',
} as const

type ViewKey = keyof typeof VIEWS

/**
 * What a printed calendar can be: the four views on screen, plus the year's
 * programme — the months across the top with a dot on every teaching day, and
 * every class beneath it in date order.
 */
type PrintShape = ViewKey | 'programme'
const PRINT_SHAPES: PrintShape[] = ['day', 'week', 'month', 'agenda', 'programme']

const LOCALES = { ca: caLocale, es: esLocale, en: enLocale }

/**
 * The window fetched around whatever the calendar is showing.
 *
 * A month either side, so paging to the next month draws immediately from what
 * is already here and then refreshes. The range used to be fixed at the month
 * the screen opened on: paging past it found nothing, and the calendar said
 * there were no classes in a period nobody had asked the server about.
 */
function rangeAround(date: Date): { from: string; to: string } {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0))
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export function CalendarView() {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  const [view, setView] = useState<ViewKey>('week')
  /** Whether the "what shape of PDF?" dialog is open. */
  const [printing, setPrinting] = useState(false)
  const [subjectId, setSubjectId] = useState('')
  const [range, setRange] = useState(() => rangeAround(new Date()))
  const calendarRef = useRef<FullCalendar>(null)

  const query = `from=${range.from}&to=${range.to}${subjectId ? `&subjectId=${subjectId}` : ''}`

  const sessions = useQuery({
    queryKey: ['calendar', mockUserEmail, centerId, query],
    queryFn: () => apiFetch<CalendarResponse>(`/api/v1/calendar/sessions?${query}`),
    enabled: Boolean(centerId),
    /*
      The previous months stay on screen while the next ones are fetched.

      Without this the query goes back to pending every time the range moves,
      the calendar is replaced by a skeleton — and a calendar that unmounts
      forgets which month it was on and comes back at today. Paging forward
      twice landed you back where you started.
    */
    placeholderData: (previous) => previous,
  })

  const events = useMemo<EventInput[]>(
    () =>
      (sessions.data?.events ?? []).map((event) => ({
        id: `${event.sessionId}-${event.date}`,
        title: `${event.subjectCode} ${event.groupCode}`,
        start: `${event.date}T${event.startTime}:00`,
        end: `${event.date}T${event.endTime}:00`,
        extendedProps: {
          // The hour as the timetable holds it, so the card says when a class
          // finishes as well as when it starts.
          time: `${event.startTime}–${event.endTime}`,
          room: event.spaceName,
          // The topic where somebody wrote one, the subject's name where
          // they did not: a code alone means nothing to whoever is reading.
          subject: event.topic ?? event.subjectName,
        },
      })),
    [sessions.data],
  )

  const download = async (format: 'pdf' | 'xlsx', shape: PrintShape = view) => {
    try {
      // The page prints the shape that was asked for, on the date on screen.
      // The Excel export stays the whole fetched range, which is what a
      // spreadsheet is for.
      const shown = calendarRef.current?.getApi().getDate() ?? new Date()
      const printQuery =
        format === 'pdf' ? `${query}&view=${shape}&date=${shown.toISOString().slice(0, 10)}` : query

      const blob = await apiDownload(`/api/v1/calendar/export.${format}?${printQuery}`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `uacademic-calendar.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success('calendar.export.done')
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('calendar.export.failed')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="space-y-6">
      {printing ? (
        <PrintShapeDialog
          view={view}
          onClose={() => setPrinting(false)}
          onPrint={(shape) => download('pdf', shape)}
        />
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('calendar.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('calendar.subtitle')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPrinting(true)}>
            <FileText className="size-4" aria-hidden="true" />
            {t('calendar.export.pdf')}
          </Button>
          <Button variant="secondary" onClick={() => void download('xlsx')}>
            <Download className="size-4" aria-hidden="true" />
            {t('calendar.export.excel')}
          </Button>
        </div>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div
              role="group"
              aria-label={t('calendar.title')}
              className="inline-flex rounded-control border border-border p-0.5"
            >
              {(Object.keys(VIEWS) as ViewKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => {
                    setView(key)
                    calendarRef.current?.getApi().changeView(VIEWS[key])
                  }}
                  className={
                    view === key
                      ? 'rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-contrast'
                      : 'rounded-sm px-3 py-1.5 text-sm text-text-muted hover:text-text'
                  }
                >
                  {t(`calendar.views.${key}`)}
                </button>
              ))}
            </div>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-text-muted">
                {t('calendar.filterSubject')}
              </span>
              <select
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('calendar.allSubjects')}</option>
                {(sessions.data?.subjects ?? []).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {`${subject.code} · ${subject.name}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/*
            An empty month is a month, not a dead end. The calendar used to be
            replaced by "no classes in this period", which took away the very
            arrows somebody needed to go and look at the month that does have
            them.
          */}
          {sessions.data && events.length === 0 ? (
            <p className="rounded-control border border-border bg-surface-muted px-3 py-2 text-sm text-text-muted">
              {t('calendar.empty')}
            </p>
          ) : null}

          {/*
            Only ever before the first answer: after that the calendar stays
            mounted, because unmounting it is what loses the month somebody
            navigated to.
          */}
          {!sessions.data && sessions.isPending ? (
            <CardSkeleton />
          ) : !sessions.data && sessions.isError ? (
            <ErrorState onRetry={() => void sessions.refetch()} />
          ) : (
            <div className="uacademic-calendar">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
                initialView={VIEWS[view]}
                locale={LOCALES[locale]}
                firstDay={1}
                height="auto"
                allDaySlot={false}
                slotMinTime="07:00:00"
                slotMaxTime="22:00:00"
                nowIndicator
                headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
                // FullCalendar's chevrons render as `role="img"` with no
                // alternative text. Its own localised words are both readable
                // and announceable, so the icons go.
                buttonIcons={false}
                events={events}
                /*
                  Whatever the calendar moves to, the server is asked about:
                  the four views and the arrows all end up here, so there is
                  one place that keeps the data and the screen in step.
                */
                datesSet={(argument) => {
                  const middle = new Date((argument.start.getTime() + argument.end.getTime()) / 2)
                  const next = rangeAround(middle)
                  setRange((current) =>
                    current.from === next.from && current.to === next.to ? current : next,
                  )
                }}
                eventContent={(argument) => (
                  <div className="px-1 py-0.5 text-xs">
                    <span className="tabular block opacity-90">
                      {String(argument.event.extendedProps.time ?? '')}
                    </span>
                    <span className="block font-medium">{argument.event.title}</span>
                    <span className="block opacity-80">
                      {String(argument.event.extendedProps.subject ?? '')}
                    </span>
                    <span className="block opacity-80">
                      {String(argument.event.extendedProps.room ?? t('planner.unassignedSpace'))}
                    </span>
                  </div>
                )}
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/*
        Subscribing, and the two API-based connections, live on one screen:
        choosing between them means comparing how fast each one delivers, and
        that comparison only makes sense side by side.
      */}
      <Card>
        <CardHeader
          title={t('connections.title')}
          description={t('connections.subtitle')}
          action={
            <Link
              to="/connections"
              className="inline-flex h-10 items-center gap-2 rounded-control border border-border px-4 text-sm text-text hover:bg-surface-muted"
            >
              <CalendarSync className="size-4" aria-hidden="true" />
              {t('calendar.subscribe.title')}
            </Link>
          }
        />
      </Card>
    </div>
  )
}

/**
 * What shape the PDF should be.
 *
 * Printing used to hand over whichever view happened to be open, which is
 * right often enough and wrong whenever somebody wants the year's programme
 * while looking at next Tuesday. So it is asked, with the view on screen
 * already chosen.
 */
function PrintShapeDialog({
  view,
  onClose,
  onPrint,
}: {
  view: ViewKey
  onClose: () => void
  onPrint: (shape: PrintShape) => Promise<void>
}) {
  const { t } = useTranslation()
  const [shape, setShape] = useState<PrintShape>(view)
  const [busy, setBusy] = useState(false)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('calendar.export.pdf')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm space-y-4 rounded-card border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text">{t('calendar.export.pdf')}</h2>

        <fieldset>
          <legend className="mb-1 text-xs text-text-muted">
            {t('calendar.coordination.printView')}
          </legend>
          <div className="flex flex-wrap gap-3">
            {PRINT_SHAPES.map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-sm text-text">
                <input
                  type="radio"
                  name="calendar-print-view"
                  value={option}
                  checked={shape === option}
                  onChange={() => setShape(option)}
                  className="size-4"
                />
                {t(`calendar.views.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {shape === 'programme' ? (
          <p className="text-xs text-text-muted">{t('calendar.programme.printHint')}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onPrint(shape).finally(() => setBusy(false))
            }}
          >
            <FileText className="size-4" aria-hidden="true" />
            {busy ? t('common.loading') : t('calendar.export.pdf')}
          </Button>
        </div>
      </div>
    </div>
  )
}
