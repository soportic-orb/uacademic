/**
 * The whole teaching programme, for the people responsible for it.
 *
 * The teacher's calendar answers "what am I teaching?". This one answers
 * "what is happening?" — every class of the subjects somebody coordinates,
 * whoever is giving it — which is a different question and needs different
 * filters: by subject, by colleague, by group, by room.
 *
 * Coordination sees the subjects they coordinate. A center administrator sees
 * the center, because that is what they administer. Neither sees another
 * center: the sessions are read through the tenant-scoped client (R2).
 */
import { calendarColor, occurrencesBetween, translate } from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import PDFDocument from 'pdfkit'
import { z } from 'zod'

import { type PrismaClient } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'
import {
  type CalendarSession,
  nonTeachingDates,
  publishedSessionsWhere,
  toIcsSession,
} from './routes.js'

const COORDINATION = ['COORDINATOR', 'CENTER_ADMIN', 'SUPERADMIN'] as const

const filterSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  subjectId: z.uuid().optional(),
  teacherProfileId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  spaceId: z.uuid().optional(),
})

type Filters = z.infer<typeof filterSchema>

/** What the PDF prints: whichever slice of the range is on screen. */
const printSchema = filterSchema.extend({
  view: z.enum(['day', 'week', 'month', 'agenda']).default('agenda'),
  /** The date the view is showing. Ignored by `agenda`, which prints the range. */
  date: z.iso.date().optional(),
})

export function registerCoordinationCalendarRoutes(app: FastifyInstance): void {
  app.get(
    '/api/v1/calendar/coordination',
    { config: { roles: [...COORDINATION] } },
    async (request) => {
      const query = parseWith(filterSchema, request.query)
      const { db } = requireCenterScope(request)
      const excluded = await nonTeachingDates(db, query.from, query.to)
      const sessions = await visibleSessions(request, db, query)

      /*
        The pickers offer what is actually in the period on screen, not the
        center's whole catalogue and not the whole year: a colleague who only
        teaches in the second term is not a useful thing to offer somebody
        looking at October, because choosing them empties the calendar.
      */
      const everything = await visibleSessions(request, db, unfiltered(query))

      return {
        from: query.from,
        to: query.to,
        filters: filterOptions(expandWithColour(everything, query, excluded)),
        events: expandWithColour(sessions, query, excluded),
      }
    },
  )

  app.get(
    '/api/v1/calendar/coordination.pdf',
    { config: { roles: [...COORDINATION] } },
    async (request, reply) => {
      const user = requireUser(request)
      const query = parseWith(printSchema, request.query)
      const { db } = requireCenterScope(request)
      const t = (key: string) => translate(request.locale, key)

      // The printed range is the one on screen, not the one fetched: somebody
      // looking at a week and pressing print expects that week.
      const range = rangeForView(query)
      const sessions = await visibleSessions(request, db, { ...query, ...range })
      const excluded = await nonTeachingDates(db, range.from, range.to)
      const rows = expandWithColour(sessions, { ...query, ...range }, excluded)

      const landscape = query.view === 'week' || query.view === 'month'
      const document = new PDFDocument({
        size: 'A4',
        layout: landscape ? 'landscape' : 'portrait',
        margin: 36,
      })
      const chunks: Buffer[] = []
      document.on('data', (chunk: Buffer) => chunks.push(chunk))
      const finished = new Promise<Buffer>((resolve) =>
        document.on('end', () => resolve(Buffer.concat(chunks))),
      )

      document.fontSize(18).fillColor('#0F172A').text(t('calendar.coordination.title'))
      document
        .fontSize(10)
        .fillColor('#475569')
        .text(
          [
            `${user.firstName} ${user.lastName}`,
            `${range.from} – ${range.to}`,
            t(`calendar.views.${query.view}`),
            describeFilters(rows, query, t),
          ]
            .filter(Boolean)
            .join(' · '),
        )
      document.moveDown()

      if (rows.length === 0) {
        document.fontSize(11).fillColor('#0F172A').text(t('calendar.empty'))
      } else {
        writeDays(document, rows)
      }

      document.end()

      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'attachment; filename="uacademic-programme.pdf"')
        .send(await finished)
    },
  )
}

/* ─────────────────────────────── the sessions ──────────────────────────── */

/**
 * What this person may see, before the filters narrow it.
 *
 * A coordinator's programme is the subjects they coordinate. Somebody who
 * coordinates nothing sees nothing rather than everything — the safer of the
 * two readings of an empty list.
 */
async function visibleSessions(
  request: FastifyRequest,
  db: PrismaClient,
  filters: Filters,
): Promise<CalendarSession[]> {
  const user = requireUser(request)
  const { centerId } = requireCenterScope(request)

  const administers = user.memberships.some(
    (membership) =>
      membership.centerId === centerId &&
      (membership.role === 'CENTER_ADMIN' || membership.role === 'SUPERADMIN'),
  )

  const where: Record<string, unknown> = {}
  const group: Record<string, unknown> = {}

  if (!administers) {
    const coordinated = await db.subjectCoordinator.findMany({
      where: { userId: user.userId },
      select: { subjectId: true },
    })
    group.subjectId = { in: coordinated.map((entry) => entry.subjectId) }
  }

  if (filters.subjectId) group.subjectId = filters.subjectId
  if (filters.groupId) where.groupId = filters.groupId
  if (filters.teacherProfileId) where.teacherProfileId = filters.teacherProfileId
  if (filters.spaceId) where.spaceId = filters.spaceId
  if (Object.keys(group).length > 0) where.group = group

  return publishedSessionsWhere(db, where)
}

/** The same query with the four pickers cleared, for the pickers themselves. */
function unfiltered(filters: Filters): Filters {
  return { from: filters.from, to: filters.to }
}

interface ColouredOccurrence {
  sessionId: string
  date: string
  startTime: string
  endTime: string
  subjectId: string
  subjectCode: string
  subjectName: string
  groupId: string
  groupCode: string
  spaceId: string | null
  spaceName: string | null
  teacherProfileId: string | null
  teacherName: string | null
  /** From the subject id, so the screen and this agree without being told. */
  color: string
  background: string
}

function expandWithColour(
  sessions: readonly CalendarSession[],
  range: { from: string; to: string },
  excluded: readonly string[],
): ColouredOccurrence[] {
  const from = new Date(`${range.from}T00:00:00Z`)
  const to = new Date(`${range.to}T00:00:00Z`)

  return sessions
    .flatMap((session) => {
      const colour = calendarColor(session.subjectId)

      return occurrencesBetween(toIcsSession(session), from, to, excluded).map((date) => ({
        sessionId: session.id,
        date: date.toISOString().slice(0, 10),
        startTime: session.startTime,
        endTime: session.endTime,
        subjectId: session.subjectId,
        subjectCode: session.subjectCode,
        subjectName: session.subjectName,
        groupId: session.groupId,
        groupCode: session.groupCode,
        spaceId: session.spaceId,
        spaceName: session.spaceName,
        teacherProfileId: session.teacherProfileId,
        teacherName: session.teacherName,
        color: colour.text,
        background: colour.background,
      }))
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
}

function filterOptions(sessions: readonly ColouredOccurrence[]) {
  const subjects = new Map<string, { id: string; label: string }>()
  const teachers = new Map<string, { id: string; label: string }>()
  const groups = new Map<string, { id: string; label: string }>()
  const spaces = new Map<string, { id: string; label: string }>()

  for (const session of sessions) {
    subjects.set(session.subjectId, {
      id: session.subjectId,
      label: `${session.subjectCode} · ${session.subjectName}`,
    })
    groups.set(session.groupId, {
      id: session.groupId,
      label: `${session.subjectCode} ${session.groupCode}`,
    })
    if (session.teacherProfileId && session.teacherName) {
      teachers.set(session.teacherProfileId, {
        id: session.teacherProfileId,
        label: session.teacherName,
      })
    }
    if (session.spaceId && session.spaceName) {
      spaces.set(session.spaceId, { id: session.spaceId, label: session.spaceName })
    }
  }

  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)

  return {
    subjects: [...subjects.values()].sort(byLabel),
    teachers: [...teachers.values()].sort(byLabel),
    groups: [...groups.values()].sort(byLabel),
    spaces: [...spaces.values()].sort(byLabel),
  }
}

/* ──────────────────────────────── the print ────────────────────────────── */

/** The dates a view covers, so the paper matches the screen. */
export function rangeForView(input: {
  view: 'day' | 'week' | 'month' | 'agenda'
  date?: string | undefined
  from: string
  to: string
}): { from: string; to: string } {
  if (input.view === 'agenda' || !input.date) return { from: input.from, to: input.to }

  const day = new Date(`${input.date}T00:00:00Z`)

  if (input.view === 'day') return { from: input.date, to: input.date }

  if (input.view === 'week') {
    // Monday first, everywhere in this product (CLAUDE.md §5).
    const isoWeekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay()
    const monday = new Date(day)
    monday.setUTCDate(monday.getUTCDate() - (isoWeekday - 1))
    const sunday = new Date(monday)
    sunday.setUTCDate(sunday.getUTCDate() + 6)
    return { from: iso(monday), to: iso(sunday) }
  }

  const first = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1))
  const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0))
  return { from: iso(first), to: iso(last) }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function describeFilters(
  rows: readonly ColouredOccurrence[],
  query: z.infer<typeof printSchema>,
  t: (key: string) => string,
): string {
  const first = rows[0]
  const parts: string[] = []

  if (query.subjectId) parts.push(`${t('calendar.filterSubject')}: ${first?.subjectCode ?? ''}`)
  if (query.teacherProfileId) {
    parts.push(`${t('calendar.coordination.filterTeacher')}: ${first?.teacherName ?? ''}`)
  }
  if (query.groupId)
    parts.push(`${t('calendar.coordination.filterGroup')}: ${first?.groupCode ?? ''}`)
  if (query.spaceId)
    parts.push(`${t('calendar.coordination.filterSpace')}: ${first?.spaceName ?? ''}`)

  return parts.join(' · ')
}

/**
 * Day by day, each class on its own line with its subject's colour beside it,
 * so the printed page reads the way the screen does.
 */
function writeDays(document: PDFKit.PDFDocument, rows: readonly ColouredOccurrence[]): void {
  let currentDate = ''

  for (const row of rows) {
    if (document.y > document.page.height - document.page.margins.bottom - 40) {
      document.addPage()
      currentDate = ''
    }

    if (row.date !== currentDate) {
      currentDate = row.date
      document.moveDown(0.4).fontSize(12).fillColor('#0F172A').text(row.date, { underline: true })
      document.moveDown(0.2)
    }

    const top = document.y
    // The colour is a stripe rather than a fill: a page of pale blocks is
    // expensive to print and harder to read than ink on paper.
    document.rect(document.page.margins.left, top + 1, 4, 11).fill(row.background)

    document
      .fillColor('#0F172A')
      .fontSize(10)
      .text(
        [
          `${row.startTime}–${row.endTime}`,
          `${row.subjectCode} ${row.groupCode}`,
          row.teacherName ?? '',
          row.spaceName ?? '',
        ]
          .filter(Boolean)
          .join('   '),
        document.page.margins.left + 10,
        top,
      )
  }
}
