/**
 * Printing the classes of the version on screen.
 *
 * The programme screen prints what is published; a coordinator planning next
 * term needs the same document about the draft in front of them — that is how
 * a timetable gets taken to a meeting and agreed. So this asks the same
 * questions the programme's dialog asks (a period, a shape) plus the two the
 * planner is about (which colleague, which subjects), and returns the same
 * document. A draft carries "provisional" on every page.
 */
import { FileDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiDownload } from '../../lib/api'
import type { VersionDetailDto } from './queries'

/** The shapes a printed calendar comes in, in the order they are offered. */
const VIEWS = ['week', 'month', 'agenda', 'programme'] as const
type PrintView = (typeof VIEWS)[number]

const CONTROL = 'h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text'

/** The first of this month to the last of the next: a period worth printing. */
function defaultRange(): { from: string; to: string } {
  const now = new Date()
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`

  return {
    from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: iso(new Date(now.getFullYear(), now.getMonth() + 2, 0)),
  }
}

export function CalendarPrint({ version }: { version: VersionDetailDto }) {
  const { t } = useTranslation()
  const toast = useToast()

  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [teacherProfileId, setTeacherProfileId] = useState('')
  const [subjectIds, setSubjectIds] = useState<string[]>([])
  const [view, setView] = useState<PrintView>('week')
  const [busy, setBusy] = useState(false)

  // The subjects of this version, each once: the groups are what carry them.
  const subjects = new Map<string, { id: string; code: string; name: string }>()
  for (const group of version.groups) {
    if (!subjects.has(group.subjectId)) {
      subjects.set(group.subjectId, {
        id: group.subjectId,
        code: group.subjectCode,
        name: group.subjectName,
      })
    }
  }

  // A half-typed date is not a date: the input reports an empty value until
  // the whole of it is there.
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)

  const download = async () => {
    setBusy(true)

    const search = new URLSearchParams({ from, to, view })
    if (teacherProfileId) search.set('teacherProfileId', teacherProfileId)
    // One field rather than one per subject: a list of chosen subjects is one
    // answer to one question.
    if (subjectIds.length > 0) search.set('subjectIds', subjectIds.join(','))

    try {
      const blob = await apiDownload(
        `/api/v1/planner/versions/${version.id}/calendar.pdf?${search.toString()}`,
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'uacademic-calendar.pdf'
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success('calendar.export.done')
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('calendar.export.failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title={t('planning.print.title')} description={t('planning.print.hint')} />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('admin.fields.dateFrom')}</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={CONTROL}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('admin.fields.dateTo')}</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              className={CONTROL}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">
              {t('planning.print.teacher')}
            </span>
            <select
              value={teacherProfileId}
              onChange={(event) => setTeacherProfileId(event.target.value)}
              className={CONTROL}
            >
              <option value="">{t('planning.print.allTeachers')}</option>
              {version.context.directory.map((teacher) => (
                <option key={teacher.teacherProfileId} value={teacher.teacherProfileId}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('planning.print.view')}</span>
            <select
              value={view}
              onChange={(event) => setView(event.target.value as PrintView)}
              className={CONTROL}
            >
              {VIEWS.map((option) => (
                <option key={option} value={option}>
                  {t(`calendar.views.${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/*
          Subjects as a list of ticks rather than a multiple select: choosing
          three of eight with a keyboard modifier is a thing people get wrong,
          and nothing ticked is the honest way to say "all of them".
        */}
        <fieldset>
          <legend className="mb-1 text-xs text-text-muted">{t('planning.print.subjects')}</legend>
          <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-control border border-border p-2">
            {subjects.size === 0 ? (
              <span className="text-sm text-text-muted">{t('planning.print.allSubjects')}</span>
            ) : (
              [...subjects.values()].map((subject) => (
                <label
                  key={subject.id}
                  className="flex items-center gap-1.5 text-sm text-text"
                  title={subject.name}
                >
                  <input
                    type="checkbox"
                    checked={subjectIds.includes(subject.id)}
                    onChange={(event) =>
                      setSubjectIds((current) =>
                        event.target.checked
                          ? [...current, subject.id]
                          : current.filter((id) => id !== subject.id),
                      )
                    }
                    className="size-4 rounded border-border"
                  />
                  {subject.code}
                </label>
              ))
            )}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {subjectIds.length === 0 ? t('planning.print.allSubjects') : null}
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy || !complete || to < from} onClick={() => void download()}>
            <FileDown className="size-4" aria-hidden="true" />
            {busy ? t('common.loading') : t('planning.print.export')}
          </Button>

          {/* A draft prints, and says on every page that it is one. */}
          {version.status === 'published' ? null : (
            <span className="text-xs text-text-muted">{t('planning.print.draftHint')}</span>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
