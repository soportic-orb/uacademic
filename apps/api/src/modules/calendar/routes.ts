/**
 * The teacher's own calendar: what they teach, in the shape each surface needs.
 *
 * The same published sessions are served three ways — as occurrences for the
 * day/week/month/agenda views, as a subscribable ICS feed, and as a PDF or an
 * Excel file. All three read the *published* version: a draft is nobody's
 * Tuesday yet.
 *
 * The feed URL is a bearer capability. It is stored as a SHA-256 hash (the
 * column is exactly 64 characters wide for that reason), so a database dump
 * cannot be turned into a set of working calendar URLs, and it is revocable
 * without touching anything else.
 */
import { type IcsSession, buildIcsFeed, occurrencesBetween, translate } from '@uacademic/shared'
import ExcelJS from 'exceljs'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import PDFDocument from 'pdfkit'
import { z } from 'zod'

import { generateFeedToken } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { type PrismaClient, prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

const rangeSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  subjectId: z.uuid().optional(),
})

/**
 * Where the subscription URL points. Behind Nginx the API is proxied, so the
 * forwarded host is what a calendar client must call back on.
 */
function feedBaseUrl(request: FastifyRequest): string {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host
  return `${request.protocol}://${Array.isArray(host) ? host[0] : host}`
}

/** Hashing, not encrypting: a bearer token only ever needs to be recognised. */
export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

interface CalendarSession {
  id: string
  subjectId: string
  subjectCode: string
  subjectName: string
  groupCode: string
  spaceName: string | null
  teacherName: string | null
  weekday: number
  startTime: string
  endTime: string
  dateFrom: Date
  dateTo: Date
  recurrence: 'weekly' | 'biweekly' | 'once'
}

export function registerCalendarRoutes(app: FastifyInstance): void {
  /** Occurrences in a range, which is what every calendar view draws. */
  app.get('/api/v1/calendar/sessions', async (request) => {
    const user = requireUser(request)
    const { centerId, db } = requireCenterScope(request)
    const query = parseWith(rangeSchema, request.query)

    const sessions = await publishedSessionsFor(db, user.userId, query.subjectId)
    const excluded = await nonTeachingDates(db, query.from, query.to)

    const from = new Date(`${query.from}T00:00:00Z`)
    const to = new Date(`${query.to}T00:00:00Z`)

    const events = sessions.flatMap((session) =>
      occurrencesBetween(toIcsSession(session), from, to, excluded).map((date) => ({
        sessionId: session.id,
        date: date.toISOString().slice(0, 10),
        startTime: session.startTime,
        endTime: session.endTime,
        subjectId: session.subjectId,
        subjectCode: session.subjectCode,
        subjectName: session.subjectName,
        groupCode: session.groupCode,
        spaceName: session.spaceName,
      })),
    )

    return {
      centerId,
      from: query.from,
      to: query.to,
      subjects: distinctSubjects(sessions),
      events: events.sort(
        (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
      ),
    }
  })

  registerFeedRoutes(app)
  registerExportRoutes(app)
}

function registerFeedRoutes(app: FastifyInstance): void {
  app.get('/api/v1/calendar/feed', async (request) => {
    const user = requireUser(request)
    const token = await prisma().calendarFeedToken.findFirst({
      where: { userId: user.userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })

    return {
      // The plaintext token is shown once, at creation: we only keep its hash.
      active: Boolean(token),
      createdAt: token?.createdAt.toISOString() ?? null,
      lastFetchedAt: token?.lastFetchedAt?.toISOString() ?? null,
      id: token?.id ?? null,
    }
  })

  /** Creating an address revokes the previous one: one live URL per person. */
  app.post('/api/v1/calendar/feed', async (request, reply) => {
    const user = requireUser(request)
    const token = generateFeedToken()

    await prisma().calendarFeedToken.updateMany({
      where: { userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    const created = await prisma().calendarFeedToken.create({
      data: { userId: user.userId, token: hashFeedToken(token) },
    })

    return reply.code(201).send({
      id: created.id,
      url: `${feedBaseUrl(request)}/api/v1/calendar/feed/${token}.ics`,
      token,
    })
  })

  app.delete(
    '/api/v1/calendar/feed/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = requireUser(request)
      const updated = await prisma().calendarFeedToken.updateMany({
        where: { id: request.params.id, userId: user.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      if (updated.count === 0) throw AppError.notFound()
      return reply.code(204).send()
    },
  )

  /**
   * The subscription itself. No session, no cookie: the token is the identity,
   * which is why it is single-purpose, revocable and carries only the owner's
   * own timetable.
   */
  app.get(
    '/api/v1/calendar/feed/:token.ics',
    { config: { public: true } },
    async (request: FastifyRequest<{ Params: { token: string } }>, reply) => {
      const raw = request.params.token.replace(/\.ics$/, '')
      const feed = await prisma().calendarFeedToken.findFirst({
        where: { token: hashFeedToken(raw), revokedAt: null },
        include: { user: { select: { id: true, firstName: true, lastName: true, locale: true } } },
      })
      if (!feed) throw AppError.notFound()

      const sessions = await publishedSessionsFor(prisma(), feed.user.id)
      const centers = await prisma().center.findMany({
        where: { userRoles: { some: { userId: feed.user.id } } },
        select: { timezone: true },
        take: 1,
      })

      const excluded = await nonTeachingDates(prisma(), '2000-01-01', '2100-01-01')

      await prisma().calendarFeedToken.update({
        where: { id: feed.id },
        data: { lastFetchedAt: new Date() },
      })

      const body = buildIcsFeed(sessions.map(toIcsSession), {
        calendarName: `UAcademic · ${feed.user.firstName} ${feed.user.lastName}`,
        timezone: centers[0]?.timezone ?? 'Europe/Madrid',
        excludedDates: excluded,
      })

      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('cache-control', 'private, max-age=900')
        .send(body)
    },
  )
}

function registerExportRoutes(app: FastifyInstance): void {
  app.get('/api/v1/calendar/export.xlsx', async (request, reply) => {
    const user = requireUser(request)
    const { db } = requireCenterScope(request)
    const query = parseWith(rangeSchema, request.query)
    const t = (key: string) => translate(request.locale, key)

    const sessions = await publishedSessionsFor(db, user.userId, query.subjectId)
    const excluded = await nonTeachingDates(db, query.from, query.to)
    const rows = expand(sessions, query.from, query.to, excluded)

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'UAcademic'
    const sheet = workbook.addWorksheet(t('calendar.title'))
    sheet.columns = [
      { header: t('admin.fields.startDate'), key: 'date', width: 14 },
      { header: t('common.from'), key: 'start', width: 10 },
      { header: t('common.to'), key: 'end', width: 10 },
      { header: t('teachers.workload.subject'), key: 'subject', width: 34 },
      { header: t('teachers.workload.groups'), key: 'group', width: 12 },
      { header: t('admin.resources.spaces'), key: 'space', width: 20 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]

    for (const row of rows) {
      sheet.addRow({
        date: row.date,
        start: row.startTime,
        end: row.endTime,
        subject: `${row.subjectCode} · ${row.subjectName}`,
        group: row.groupCode,
        space: row.spaceName ?? '—',
      })
    }

    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="uacademic-calendar.xlsx"')
      .send(Buffer.from(await workbook.xlsx.writeBuffer()))
  })

  app.get('/api/v1/calendar/export.pdf', async (request, reply) => {
    const user = requireUser(request)
    const { db } = requireCenterScope(request)
    const query = parseWith(rangeSchema, request.query)
    const t = (key: string) => translate(request.locale, key)

    const sessions = await publishedSessionsFor(db, user.userId, query.subjectId)
    const excluded = await nonTeachingDates(db, query.from, query.to)
    const rows = expand(sessions, query.from, query.to, excluded)

    const document = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    document.on('data', (chunk: Buffer) => chunks.push(chunk))
    const finished = new Promise<Buffer>((resolve) =>
      document.on('end', () => resolve(Buffer.concat(chunks))),
    )

    document.fontSize(18).text(t('calendar.title'))
    document
      .fontSize(10)
      .fillColor('#475569')
      .text(`${user.firstName} ${user.lastName} · ${query.from} – ${query.to}`)
    document.moveDown().fillColor('#0f172a')

    if (rows.length === 0) {
      document.fontSize(11).text(t('calendar.empty'))
    } else {
      let currentDate = ''
      for (const row of rows) {
        if (row.date !== currentDate) {
          currentDate = row.date
          document.moveDown(0.5).fontSize(12).text(row.date, { underline: true })
        }
        document
          .fontSize(10)
          .text(
            `${row.startTime}–${row.endTime}  ${row.subjectCode} ${row.groupCode}  ${
              row.spaceName ?? ''
            }`.trim(),
          )
      }
    }

    document.end()

    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', 'attachment; filename="uacademic-calendar.pdf"')
      .send(await finished)
  })
}

function toIcsSession(session: CalendarSession): IcsSession {
  return {
    id: session.id,
    summary: `${session.subjectCode} ${session.groupCode}`,
    ...(session.spaceName ? { location: session.spaceName } : {}),
    description: session.subjectName,
    weekday: session.weekday as IcsSession['weekday'],
    startTime: session.startTime,
    endTime: session.endTime,
    dateFrom: session.dateFrom,
    dateTo: session.dateTo,
    recurrence: session.recurrence,
  }
}

function expand(
  sessions: readonly CalendarSession[],
  from: string,
  to: string,
  excluded: readonly string[],
) {
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)

  return sessions
    .flatMap((session) =>
      occurrencesBetween(toIcsSession(session), start, end, excluded).map((date) => ({
        ...session,
        date: date.toISOString().slice(0, 10),
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
}

function distinctSubjects(sessions: readonly CalendarSession[]) {
  const subjects = new Map<string, { id: string; code: string; name: string }>()
  for (const session of sessions) {
    subjects.set(session.subjectId, {
      id: session.subjectId,
      code: session.subjectCode,
      name: session.subjectName,
    })
  }
  return [...subjects.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * The teacher's sessions in the published version. Drafts never reach a
 * calendar: publishing is what makes a timetable real.
 */
async function publishedSessionsFor(
  client: PrismaClient,
  userId: string,
  subjectId?: string,
): Promise<CalendarSession[]> {
  const rows = (await client.classSession.findMany({
    where: {
      scheduleVersion: { status: 'published' },
      teacherProfile: { userId },
      ...(subjectId ? { group: { subjectId } } : {}),
    },
    include: {
      group: {
        select: { code: true, subject: { select: { id: true, code: true, nameCa: true } } },
      },
      space: { select: { name: true } },
      teacherProfile: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  })) as unknown as {
    id: string
    weekday: number
    startTime: string
    endTime: string
    dateFrom: Date
    dateTo: Date
    recurrence: 'weekly' | 'biweekly' | 'once'
    group: { code: string; subject: { id: string; code: string; nameCa: string } }
    space: { name: string } | null
    teacherProfile: { user: { firstName: string; lastName: string } } | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    subjectId: row.group.subject.id,
    subjectCode: row.group.subject.code,
    subjectName: row.group.subject.nameCa,
    groupCode: row.group.code,
    spaceName: row.space?.name ?? null,
    teacherName: row.teacherProfile
      ? `${row.teacherProfile.user.firstName} ${row.teacherProfile.user.lastName}`
      : null,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    recurrence: row.recurrence,
  }))
}

/** Holidays and closures: the days a weekly class does not happen. */
async function nonTeachingDates(client: PrismaClient, from: string, to: string): Promise<string[]> {
  const entries = await client.academicCalendarEntry.findMany({
    where: {
      isTeachingDay: false,
      dateTo: { gte: new Date(`${from}T00:00:00Z`) },
      dateFrom: { lte: new Date(`${to}T00:00:00Z`) },
    },
    select: { dateFrom: true, dateTo: true },
  })

  const dates: string[] = []
  for (const entry of entries) {
    const cursor = new Date(entry.dateFrom.getTime())
    while (cursor.getTime() <= entry.dateTo.getTime()) {
      dates.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  return dates
}
