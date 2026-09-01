/**
 * The teaching programme, for coordination.
 *
 * The teacher's calendar answers "what am I teaching?"; this one answers "what
 * is happening?" — every class of the subjects somebody coordinates, whoever
 * is giving it. Same four views, because the shape of the question is the
 * same, and four filters, because the shape of the answer is not.
 *
 * Colour is by subject, computed from the subject's own identifier so the
 * screen and the printed PDF agree without either being told. It is never the
 * only carrier: every event also shows its code, its group and its room (R8).
 */
import type { EventInput } from '@fullcalendar/core'
import caLocale from '@fullcalendar/core/locales/ca'
import enLocale from '@fullcalendar/core/locales/en-gb'
import esLocale from '@fullcalendar/core/locales/es'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { calendarColor } from '@uacademic/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText, FilterX } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiDownload, apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

interface ProgrammeEvent {
  sessionId: string
  date: string
  startTime: string
  endTime: string
  subjectId: string
  subjectCode: string
  subjectName: string
  groupCode: string
  spaceId: string | null
  spaceName: string | null
  teacherName: string | null
  /** Everyone giving the class, the one above first. */
  teachers: { teacherProfileId: string; name: string }[]
  color: string
  background: string
}

interface Option {
  id: string
  label: string
  /** Subjects only: the colour the center chose for it. */
  color?: string | null
}

interface ProgrammeResponse {
  from: string
  to: string
  /** How many subjects this person is responsible for, across the year. */
  coordinates: number
  filters: {
    subjects: Option[]
    teachers: Option[]
    groups: Option[]
    spaces: Option[]
  }
  events: ProgrammeEvent[]
}

const VIEWS = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth',
  agenda: 'listMonth',
} as const

type ViewKey = keyof typeof VIEWS

const LOCALES = { ca: caLocale, es: esLocale, en: enLocale }

/**
 * The window fetched around whatever the calendar is showing: a month either
 * side, so paging draws from what is already here and then refreshes.
 */
function rangeAround(date: Date): { from: string; to: string } {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0))
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

type FilterKey = 'subjectId' | 'teacherProfileId' | 'groupId' | 'spaceId'

export function ProgrammeView() {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  const [view, setView] = useState<ViewKey>('week')
  const [range, setRange] = useState(() => rangeAround(new Date()))
  /** None active by default: coordination arrives wanting the whole picture. */
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    subjectId: '',
    teacherProfileId: '',
    groupId: '',
    spaceId: '',
  })
  const calendarRef = useRef<FullCalendar>(null)

  /**
   * The class whose room is being changed.
   *
   * A room changes for reasons that have nothing to do with the timetable — a
   * broken projector, a room being painted — and it is this calendar somebody
   * is looking at when they find out.
   */
  const [movingRoom, setMovingRoom] = useState<{
    sessionId: string
    title: string
    spaceId: string
  } | null>(null)

  /** Whether the print dialog is open. */
  const [printing, setPrinting] = useState(false)

  const search = new URLSearchParams({ from: range.from, to: range.to })
  for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value)
  const query = search.toString()

  const programme = useQuery({
    queryKey: ['programme', mockUserEmail, centerId, query],
    queryFn: () => apiFetch<ProgrammeResponse>(`/api/v1/calendar/coordination?${query}`),
    enabled: Boolean(centerId),
    // What is on screen stays there while the next months are fetched: a
    // calendar that unmounts forgets the month somebody navigated to.
    placeholderData: (previous) => previous,
  })

  const events = useMemo<EventInput[]>(
    () =>
      (programme.data?.events ?? []).map((event) => ({
        id: `${event.sessionId}-${event.date}`,
        title: `${event.subjectCode} ${event.groupCode}`,
        start: `${event.date}T${event.startTime}:00`,
        end: `${event.date}T${event.endTime}:00`,
        backgroundColor: event.background,
        borderColor: event.background,
        textColor: event.color,
        extendedProps: {
          // The hour as the timetable holds it: read off the class, not
          // reconstructed from a timestamp in some other zone.
          time: `${event.startTime}–${event.endTime}`,
          room: event.spaceName,
          // Both names on a class given by two people: the point of this
          // calendar is seeing who is where.
          teacher: event.teachers.map((person) => person.name).join(' · ') || event.teacherName,
        },
      })),
    [programme.data],
  )

  const active = Object.values(filters).some(Boolean)

  const print = async (asked: { from: string; to: string; view: PrintView }) => {
    /*
      The period and the shape are the ones asked for in the dialog; the
      filters are whatever is on screen. No `date` is sent, which is what
      tells the server to print the range itself rather than the week or the
      month around a day.
    */
    const search = new URLSearchParams({ from: asked.from, to: asked.to, view: asked.view })
    for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value)
    const printQuery = search.toString()

    try {
      const blob = await apiDownload(`/api/v1/calendar/coordination.pdf?${printQuery}`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'uacademic-programme.pdf'
      anchor.click()
      URL.revokeObjectURL(url)
      setPrinting(false)
      toast.success('calendar.export.done')
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('calendar.export.failed')
    }
  }

  const options = programme.data?.filters

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('calendar.coordination.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('calendar.coordination.subtitle')}</p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <Button variant="secondary" onClick={() => setPrinting(true)}>
            <FileText className="size-4" aria-hidden="true" />
            {t('calendar.coordination.print')}
          </Button>
          <span className="text-xs text-text-muted">{t('calendar.coordination.printHint')}</span>
        </div>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div
              role="group"
              aria-label={t('calendar.coordination.title')}
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

            {active ? (
              <Button
                variant="secondary"
                onClick={() =>
                  setFilters({ subjectId: '', teacherProfileId: '', groupId: '', spaceId: '' })
                }
              >
                <FilterX className="size-4" aria-hidden="true" />
                {t('calendar.coordination.clearFilters')}
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Picker
              label={t('calendar.filterSubject')}
              all={t('calendar.allSubjects')}
              value={filters.subjectId}
              options={options?.subjects ?? []}
              onChange={(value) => setFilters({ ...filters, subjectId: value })}
            />
            <Picker
              label={t('calendar.coordination.filterTeacher')}
              all={t('calendar.coordination.allTeachers')}
              value={filters.teacherProfileId}
              options={options?.teachers ?? []}
              onChange={(value) => setFilters({ ...filters, teacherProfileId: value })}
            />
            <Picker
              label={t('calendar.coordination.filterGroup')}
              all={t('calendar.coordination.allGroups')}
              value={filters.groupId}
              options={options?.groups ?? []}
              onChange={(value) => setFilters({ ...filters, groupId: value })}
            />
            <Picker
              label={t('calendar.coordination.filterSpace')}
              all={t('calendar.coordination.allSpaces')}
              value={filters.spaceId}
              options={options?.spaces ?? []}
              onChange={(value) => setFilters({ ...filters, spaceId: value })}
            />
          </div>

          {options && options.subjects.length > 0 ? <Legend subjects={options.subjects} /> : null}

          {/*
            An empty month is a month: the arrows have to survive it, and the
            reason it is empty is not "you coordinate nothing" unless that is
            actually true of the person rather than of August.
          */}
          {programme.data && events.length === 0 ? (
            <p className="rounded-control border border-border bg-surface-muted px-3 py-2 text-sm text-text-muted">
              {programme.data.coordinates === 0
                ? t('calendar.coordination.none')
                : t('calendar.coordination.empty')}
            </p>
          ) : null}

          {!programme.data && programme.isPending ? (
            <CardSkeleton />
          ) : !programme.data && programme.isError ? (
            <ErrorState onRetry={() => void programme.refetch()} />
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
                // alternative text; its own localised words read better.
                buttonIcons={false}
                events={events}
                // Whatever the calendar moves to, the server is asked about.
                datesSet={(argument) => {
                  const middle = new Date((argument.start.getTime() + argument.end.getTime()) / 2)
                  const next = rangeAround(middle)
                  setRange((current) =>
                    current.from === next.from && current.to === next.to ? current : next,
                  )
                }}
                eventClick={(argument) => {
                  const event = (programme.data?.events ?? []).find(
                    (candidate) => `${candidate.sessionId}-${candidate.date}` === argument.event.id,
                  )
                  if (!event) return
                  setMovingRoom({
                    sessionId: event.sessionId,
                    title: `${event.subjectCode} ${event.groupCode} · ${event.date} ${event.startTime}`,
                    spaceId: event.spaceId ?? '',
                  })
                }}
                eventContent={(argument) => (
                  <div className="px-1 py-0.5 text-xs">
                    <span className="tabular block opacity-90">
                      {String(argument.event.extendedProps.time ?? '')}
                    </span>
                    <span className="block font-medium">{argument.event.title}</span>
                    <span className="block opacity-80">
                      {[argument.event.extendedProps.teacher, argument.event.extendedProps.room]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
              />
            </div>
          )}
        </CardBody>
      </Card>

      {printing ? (
        <PrintDialog
          range={range}
          view={view === 'day' ? 'week' : view}
          onClose={() => setPrinting(false)}
          onPrint={print}
        />
      ) : null}

      {movingRoom ? (
        <RoomDialog
          session={movingRoom}
          onClose={() => setMovingRoom(null)}
          onSaved={() => {
            setMovingRoom(null)
            void programme.refetch()
          }}
        />
      ) : null}
    </div>
  )
}

/** Moving one class to another room, without redrafting a whole version. */
function RoomDialog({
  session,
  onClose,
  onSaved,
}: {
  session: { sessionId: string; title: string; spaceId: string }
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [spaceId, setSpaceId] = useState(session.spaceId)

  const spaces = useQuery({
    queryKey: ['admin-options', 'admin/spaces'],
    queryFn: () =>
      apiFetch<{ items: { id: string; name: string }[] }>('/api/v1/admin/spaces?pageSize=100'),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: () =>
      apiJson(`/api/v1/calendar/coordination/sessions/${session.sessionId}`, 'PATCH', {
        spaceId: spaceId || null,
      }),
    onSuccess: () => {
      toast.success('calendar.coordination.roomChanged')
      onSaved()
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('calendar.coordination.changeRoom')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm space-y-4 rounded-card border border-border bg-surface p-5">
        <div>
          <h2 className="text-lg font-semibold text-text">
            {t('calendar.coordination.changeRoom')}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{session.title}</p>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-text-muted">{t('admin.fields.space')}</span>
          <select
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
            className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
          >
            <option value="">{t('planner.unassignedSpace')}</option>
            {(spaces.data?.items ?? []).map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Picker({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string
  all: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
      >
        <option value="">{all}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Which colour is which subject, in words as well as in colour. */
function Legend({ subjects }: { subjects: Option[] }) {
  const { t } = useTranslation()

  return (
    <div>
      <p className="mb-1 text-xs text-text-muted">{t('calendar.coordination.legend')}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {subjects.map((subject) => {
          const colour = calendarColor(subject.id, subject.color)
          return (
            <li key={subject.id} className="flex items-center gap-1.5 text-xs text-text">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: colour.accent }}
              />
              {subject.label}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The shapes a printed programme comes in.
 *
 * The first three are the views on screen, printed as what they are. The
 * fourth is a document rather than a view: the plan for the year — the months
 * across the top with a dot on every teaching day, then every class beneath in
 * date order — which is why it takes no period of its own.
 */
export type PrintView = 'week' | 'month' | 'agenda' | 'programme'

/**
 * What to print.
 *
 * The screen is a place to work in, and paper is a thing somebody hands
 * round: the period wanted on paper is rarely the month being looked at — a
 * term, the fortnight of the exams, the week a colleague is covering. So the
 * dates are asked for rather than assumed. The filters are not asked for
 * again: they are the ones on screen, which is where they were set.
 */
function PrintDialog({
  range,
  view,
  onClose,
  onPrint,
}: {
  range: { from: string; to: string }
  view: PrintView
  onClose: () => void
  onPrint: (asked: { from: string; to: string; view: PrintView }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  const [shape, setShape] = useState<PrintView>(view)
  const [busy, setBusy] = useState(false)

  // A half-typed date is not a date: the input reports an empty value until
  // the whole of it is there.
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)

  // The programme is the year's plan, so it prints the year: asking for dates
  // it will not use would be asking a question with no effect.
  const wholeYear = shape === 'programme'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('calendar.coordination.print')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-card border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text">{t('calendar.coordination.print')}</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('admin.fields.dateFrom')}</span>
            <input
              type="date"
              value={from}
              disabled={wholeYear}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text disabled:opacity-50"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('admin.fields.dateTo')}</span>
            <input
              type="date"
              value={to}
              min={from}
              disabled={wholeYear}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text disabled:opacity-50"
            />
          </label>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs text-text-muted">
            {t('calendar.coordination.printView')}
          </legend>
          <div className="flex flex-wrap gap-3">
            {(['week', 'month', 'agenda', 'programme'] as PrintView[]).map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-sm text-text">
                <input
                  type="radio"
                  name="print-view"
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

        <p className="text-xs text-text-muted">
          {wholeYear ? t('calendar.programme.printHint') : t('calendar.coordination.printHint')}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || (!wholeYear && (!complete || to < from))}
            onClick={() => {
              setBusy(true)
              void onPrint({ from, to, view: shape }).finally(() => setBusy(false))
            }}
          >
            <FileText className="size-4" aria-hidden="true" />
            {busy ? t('common.loading') : t('calendar.coordination.print')}
          </Button>
        </div>
      </div>
    </div>
  )
}
