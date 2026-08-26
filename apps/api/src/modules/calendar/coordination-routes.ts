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
import {
  type PlannedSession,
  type Weekday,
  calendarColor,
  detectSessionConflicts,
  occurrencesBetween,
  translate,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import PDFDocument from 'pdfkit'
import { z } from 'zod'

import { writeAuditLog } from '../../lib/audit.js'
import { scheduleMonthlyPdf } from '../../services/schedule-pdf.js'
import { AppError } from '../../lib/errors.js'
import { type PrismaClient, prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'
import { enqueueCalendarSync } from '../../services/calendar/sync.js'
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
        The pickers offer everything this person may look at, over the whole
        year — not what happens to fall in the month on screen. A colleague
        who teaches in the second term was missing from the list all autumn,
        and choosing one was the only way to find out they were not there.
      */
      const everything = await visibleSessions(request, db, unfiltered(query))

      return {
        from: query.from,
        to: query.to,
        /*
          How many subjects this person is responsible for, which is a fact
          about them and not about the month on screen: the screen used to
          read "you coordinate nothing" off an empty calendar — true in
          August, wrong the rest of the year.
        */
        coordinates: await coordinatedSubjects(request, db),
        // From the sessions themselves rather than from the occurrences the
        // range expands to: the pickers are about the year, not the month.
        filters: filterOptions(everything),
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

      /*
        A month prints as a month and a week as a week, the way the screen
        shows them; a day and the agenda are the list they already are. A
        printed calendar that is not the calendar in front of somebody is a
        different document.
      */
      if (query.view === 'month' || query.view === 'week') {
        const center = await prisma().center.findUnique({
          where: { id: requireCenterScope(request).centerId },
          select: { name: true },
        })

        const grid = await scheduleMonthlyPdf({
          teacherName: `${user.firstName} ${user.lastName}`,
          centerName: center?.name ?? '',
          note: describeFilters(rows, query, t),
          from: range.from,
          to: range.to,
          locale: request.locale,
          layout: query.view === 'week' ? 'weeks' : 'month',
          entries: rows.map((row) => ({
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
            subjectId: row.subjectId,
            subjectCode: row.subjectCode,
            subjectName: row.subjectName,
            subjectColor: row.subjectColor,
            groupCode: row.groupCode,
            spaceName: row.spaceName,
            topic: row.topic,
          })),
        })

        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', 'attachment; filename="uacademic-programme.pdf"')
          .send(grid)
      }

      // A day and the agenda are lists, and a list reads down a page.
      const document = new PDFDocument({ size: 'A4', margin: 36 })
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
        writeLegend(document, rows)
        writeDays(document, rows)
      }

      document.end()

      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'attachment; filename="uacademic-programme.pdf"')
        .send(await finished)
    },
  )

  registerRoomRoutes(app)
}

/* ──────────────────────────── changing the room ─────────────────────────── */

const roomSchema = z.object({ spaceId: z.uuid().nullable() })

/**
 * Moving one class to another room, from the calendar somebody is looking at.
 *
 * The room is the one thing about a published class that changes for reasons
 * that have nothing to do with the timetable — a broken projector, a room
 * being painted — and sending a coordinator back to the planner to redraft
 * and republish a whole version for it is out of proportion. Everything else
 * about a published class still goes through the change ladder.
 *
 * The room has to be free: a clash is refused with the class it clashes with,
 * and whoever gives the class gets their calendar resynced (R4 records it).
 */
function registerRoomRoutes(app: FastifyInstance): void {
  app.patch(
    '/api/v1/calendar/coordination/sessions/:id',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const user = requireUser(request)
      const { centerId, db } = requireCenterScope(request)
      const input = parseWith(roomSchema, request.body)

      const session = await db.classSession.findFirst({
        where: { id: request.params.id, scheduleVersion: { status: 'published' } },
        include: { coTeachers: { select: { teacherProfileId: true } } },
      })
      if (!session) throw AppError.notFound()

      const mine = await visibleSessions(request, db, {
        from: isoOf(session.dateFrom),
        to: isoOf(session.dateTo),
      })
      // Only the classes this person is responsible for: the calendar shows
      // them, and nothing outside it is theirs to move.
      if (!mine.some((visible) => visible.id === session.id)) throw AppError.notFound()

      if (input.spaceId) {
        const space = await db.space.findFirst({ where: { id: input.spaceId } })
        if (!space) throw AppError.notFound()

        const others = await db.classSession.findMany({
          where: {
            spaceId: input.spaceId,
            id: { not: session.id },
            scheduleVersion: { status: 'published' },
          },
          take: 500,
        })

        // The class as it would be, not as it is: comparing the room it is
        // leaving would never find the clash being asked about.
        const candidate = { ...toPlanned(session), spaceId: input.spaceId }

        const clash = detectSessionConflicts([...others.map(toPlanned), candidate], {
          kinds: ['space'],
        }).find((conflict) => conflict.sessionIds.includes(session.id))

        if (clash) {
          throw new AppError(409, 'CONFLICT', 'calendar.coordination.errors.roomBusy')
        }
      }

      const updated = await db.classSession.update({
        where: { id: session.id },
        data: { spaceId: input.spaceId },
      })

      await writeAuditLog(prisma(), {
        centerId,
        userId: user.userId,
        entity: 'class_session',
        entityId: session.id,
        action: 'room',
        before: { spaceId: session.spaceId },
        after: { spaceId: updated.spaceId },
        source: 'user',
        ip: request.ip,
      })

      // The people giving it are the people whose calendar now says the wrong
      // room.
      const teaching = [
        session.teacherProfileId,
        ...session.coTeachers.map((entry) => entry.teacherProfileId),
      ].filter((id): id is string => Boolean(id))

      if (teaching.length > 0) {
        const profiles = await prisma().teacherProfile.findMany({
          where: { id: { in: teaching } },
          select: { userId: true },
        })
        await enqueueCalendarSync(
          prisma(),
          profiles.map((profile) => profile.userId),
          { reason: 'room' },
        )
      }

      return { id: session.id, spaceId: updated.spaceId }
    },
  )
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toPlanned(row: {
  id: string
  groupId: string
  teacherProfileId: string | null
  spaceId: string | null
  weekday: number
  startTime: string
  endTime: string
  dateFrom: Date
  dateTo: Date
  recurrence: string
}): PlannedSession {
  return {
    id: row.id,
    groupId: row.groupId,
    teacherProfileId: row.teacherProfileId,
    spaceId: row.spaceId,
    weekday: row.weekday as Weekday,
    startTime: row.startTime as PlannedSession['startTime'],
    endTime: row.endTime as PlannedSession['endTime'],
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    recurrence: row.recurrence as PlannedSession['recurrence'],
  }
}

/* ─────────────────────────────── the sessions ──────────────────────────── */

/**
 * What this person may see, before the filters narrow it.
 *
 * A coordinator's programme is the subjects they coordinate. Somebody who
 * coordinates nothing sees nothing rather than everything — the safer of the
 * two readings of an empty list.
 */
/**
 * How many subjects this person coordinates here.
 *
 * A center administrator administers the center, so the question does not
 * apply to them: they are responsible for all of it.
 */
async function coordinatedSubjects(request: FastifyRequest, db: PrismaClient): Promise<number> {
  const user = requireUser(request)
  const { centerId } = requireCenterScope(request)

  const administers = user.memberships.some(
    (membership) =>
      membership.centerId === centerId &&
      (membership.role === 'CENTER_ADMIN' || membership.role === 'SUPERADMIN'),
  )
  if (administers) return db.subject.count()

  return db.subjectCoordinator.count({ where: { userId: user.userId } })
}

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
  if (filters.teacherProfileId) {
    // Filtering by a person means the classes they give, including the ones
    // they give with somebody else.
    where.OR = [
      { teacherProfileId: filters.teacherProfileId },
      { coTeachers: { some: { teacherProfileId: filters.teacherProfileId } } },
    ]
  }
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
  subjectColor: string | null
  groupId: string
  groupCode: string
  spaceId: string | null
  spaceName: string | null
  topic: string | null
  teacherProfileId: string | null
  teacherName: string | null
  /** Everyone giving the class, the one above first. */
  teachers: { teacherProfileId: string; name: string }[]
  /** From the subject id, so the screen and this agree without being told. */
  color: string
  background: string
  /** The saturated version, for the stripe on paper and the legend dot. */
  accent: string
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
      // The colour the center chose for the subject, or the one its
      // identifier gives it.
      const colour = calendarColor(session.subjectId, session.subjectColor)

      return occurrencesBetween(toIcsSession(session), from, to, excluded).map((date) => ({
        sessionId: session.id,
        date: date.toISOString().slice(0, 10),
        startTime: session.startTime,
        endTime: session.endTime,
        subjectId: session.subjectId,
        subjectCode: session.subjectCode,
        subjectName: session.subjectName,
        subjectColor: session.subjectColor,
        groupId: session.groupId,
        groupCode: session.groupCode,
        spaceId: session.spaceId,
        spaceName: session.spaceName,
        topic: session.topic,
        teacherProfileId: session.teacherProfileId,
        teacherName: session.teacherName,
        teachers: session.teachers,
        color: colour.text,
        background: colour.background,
        accent: colour.accent,
      }))
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
}

/**
 * What the four pickers offer.
 *
 * Every subject, colleague, group and room of the published timetable — not
 * only the ones that happen to fall in the month being looked at. It used to
 * be built from the occurrences on screen, so a colleague who teaches in the
 * second term was missing from the list all autumn, and choosing one was the
 * only way to find out they were not there.
 */
function filterOptions(sessions: readonly CalendarSession[]) {
  const subjects = new Map<string, { id: string; label: string; color: string | null }>()
  const teachers = new Map<string, { id: string; label: string }>()
  const groups = new Map<string, { id: string; label: string }>()
  const spaces = new Map<string, { id: string; label: string }>()

  for (const session of sessions) {
    subjects.set(session.subjectId, {
      id: session.subjectId,
      label: `${session.subjectCode} · ${session.subjectName}`,
      // The legend and the events have to agree about the colour, so it
      // travels with the option rather than being derived twice.
      color: session.subjectColor,
    })
    groups.set(session.groupId, {
      id: session.groupId,
      label: `${session.subjectCode} ${session.groupCode}`,
    })
    // Every person who gives a class is somebody the coordinator can filter
    // by, whether or not they are the first name on it.
    for (const person of session.teachers) {
      teachers.set(person.teacherProfileId, { id: person.teacherProfileId, label: person.name })
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
    const named = first?.teachers.find(
      (person) => person.teacherProfileId === query.teacherProfileId,
    )
    parts.push(`${t('calendar.coordination.filterTeacher')}: ${named?.name ?? ''}`)
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
/**
 * The colours and what each of them is, before the list itself.
 *
 * A page of coloured stripes is only readable to somebody who already knows
 * the timetable.
 */
function writeLegend(document: PDFKit.PDFDocument, rows: readonly ColouredOccurrence[]): void {
  const subjects = new Map<string, ColouredOccurrence>()
  for (const row of rows) if (!subjects.has(row.subjectId)) subjects.set(row.subjectId, row)

  const left = document.page.margins.left
  let x = left
  const top = document.y

  for (const row of subjects.values()) {
    const label = `${row.subjectCode} ${row.subjectName}`
    const width = Math.min(170, 14 + document.fontSize(8).widthOfString(label))
    if (x + width > document.page.width - document.page.margins.right) break

    document.rect(x, top + 2, 7, 7).fill(row.accent)
    document
      .fillColor('#475569')
      .fontSize(8)
      .text(label, x + 11, top, { width: width - 11, lineBreak: false, ellipsis: true })

    x += width + 8
  }

  document.x = left
  document.y = top + 14
  document.moveDown(0.4)
}

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
    // expensive to print and harder to read than ink on paper. Saturated, so
    // it is a colour rather than a suggestion of one.
    document.rect(document.page.margins.left, top + 1, 4, 11).fill(row.accent)

    document
      .fillColor('#0F172A')
      .fontSize(10)
      .text(
        [
          `${row.startTime}–${row.endTime}`,
          `${row.subjectCode} ${row.groupCode}`,
          // What the class is: its topic where somebody wrote one, and the
          // subject's name where they did not.
          row.topic ?? row.subjectName,
          row.teachers.map((person) => person.name).join(', '),
          row.spaceName ?? '',
        ]
          .filter(Boolean)
          .join('   '),
        document.page.margins.left + 10,
        top,
      )
  }
}
