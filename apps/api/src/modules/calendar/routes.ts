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
import {
  type IcsSession,
  buildIcsFeed,
  calendarColor,
  latencyFor,
  occurrencesBetween,
  parseCenterSettings,
  translate,
} from '@uacademic/shared'
import ExcelJS from 'exceljs'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import PDFDocument from 'pdfkit'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { generateFeedToken } from '../../lib/crypto.js'
import { toJson } from '../../lib/json.js'
import { AppError } from '../../lib/errors.js'
import { type PrismaClient, prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import {
  type FeedFilters,
  type TombstonePayload,
  sessionsForUser,
  toIcsSession as sessionToIcs,
  tombstoneToIcsSession,
} from '../../services/calendar/drafts.js'
import { registerCalendarConnectionRoutes } from './connections-routes.js'
import { rangeForView, registerCoordinationCalendarRoutes } from './coordination-routes.js'
import { scheduleMonthlyPdf } from '../../services/schedule-pdf.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

const rangeSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  subjectId: z.uuid().optional(),
})

/**
 * What the screen is showing when somebody presses print.
 *
 * A printed calendar that is not the calendar in front of them is a different
 * document: the period is the one on screen, and the shape of the page is the
 * shape of the view — a month prints as a month, a week as a week, and the
 * agenda as the list it already is.
 */
const printSchema = rangeSchema.extend({
  view: z.enum(['day', 'week', 'month', 'agenda']).default('agenda'),
  /** The date the view is centred on. Ignored by `agenda`. */
  date: z.iso.date().optional(),
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

export interface CalendarSession {
  id: string
  subjectId: string
  subjectCode: string
  subjectName: string
  /** The colour the center chose for it, if it chose one. */
  subjectColor: string | null
  groupId: string
  groupCode: string
  spaceId: string | null
  spaceName: string | null
  /** What the class is about, as written on the planner block. */
  topic: string | null
  teacherProfileId: string | null
  teacherName: string | null
  /** Everyone giving the class, the one above first. */
  teachers: { teacherProfileId: string; name: string }[]
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
        subjectColor: session.subjectColor,
        groupCode: session.groupCode,
        spaceName: session.spaceName,
        // What the class is about, written on the block by whoever planned it.
        topic: session.topic,
        // Everyone giving it: a class shared with a colleague says so.
        teachers: session.teachers.map((person) => person.name),
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
  registerCoordinationCalendarRoutes(app)
  registerCalendarConnectionRoutes(app)
}

const filtersSchema = z.object({
  academicYearId: z.uuid().nullable().optional(),
  subjectId: z.uuid().nullable().optional(),
  includeColleagues: z.boolean().optional(),
})

function readFilters(value: unknown): FeedFilters {
  const parsed = filtersSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : {}
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
      filters: readFilters(token?.filtersJson),
      /**
       * A subscription is pull: the client decides when to read, and we
       * cannot hurry it. The screen says so with these numbers rather than
       * implying a change lands instantly.
       */
      latency: {
        apple: latencyFor('ics.apple'),
        outlook: latencyFor('ics.outlook'),
        google: latencyFor('ics.google'),
      },
    }
  })

  /** Creating an address revokes the previous one: one live URL per person. */
  app.post('/api/v1/calendar/feed', async (request, reply) => {
    const user = requireUser(request)
    const token = generateFeedToken()
    const filters = readFilters(request.body)

    await prisma().calendarFeedToken.updateMany({
      where: { userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    const created = await prisma().calendarFeedToken.create({
      data: { userId: user.userId, token: hashFeedToken(token), filtersJson: toJson(filters) },
    })

    return reply.code(201).send({
      id: created.id,
      url: `${feedBaseUrl(request)}/api/v1/calendar/feed/${token}.ics`,
      token,
      filters,
    })
  })

  /**
   * What the feed carries. Changing it does not change the address: a
   * subscription that has to be re-added in four clients is a subscription
   * nobody updates.
   */
  app.patch(
    '/api/v1/calendar/feed/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const user = requireUser(request)
      const filters = readFilters(request.body)

      const updated = await prisma().calendarFeedToken.updateMany({
        where: { id: request.params.id, userId: user.userId, revokedAt: null },
        data: { filtersJson: toJson(filters) },
      })
      if (updated.count === 0) throw AppError.notFound()

      return { id: request.params.id, filters }
    },
  )

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
   *
   * It is also the one endpoint strangers can reach, so it gets its own, much
   * tighter rate limit — a calendar client that reads every hour is nowhere
   * near it, and a scanner walking token space is.
   */
  app.get(
    '/api/v1/calendar/feed/:token.ics',
    {
      config: {
        public: true,
        rateLimit: { max: 60, timeWindow: 60_000 },
      },
    },
    async (request: FastifyRequest<{ Params: { token: string } }>, reply) => {
      const raw = request.params.token.replace(/\.ics$/, '')
      const feed = await prisma().calendarFeedToken.findFirst({
        where: { token: hashFeedToken(raw), revokedAt: null },
        include: { user: { select: { id: true, firstName: true, lastName: true, locale: true } } },
      })
      if (!feed) throw AppError.notFound()

      const membership = await prisma().userCenterRole.findFirst({
        where: { userId: feed.user.id },
        include: { center: true },
        orderBy: { createdAt: 'asc' },
      })
      const settings = parseCenterSettings(membership?.center.settingsJson)
      const context = {
        timezone: membership?.center.timezone ?? 'Europe/Madrid',
        centerName: membership?.center.name ?? '',
        settings: settings.calendar,
        appUrl: env().APP_URL,
      }

      const filters = readFilters(feed.filtersJson)
      const sessions = await sessionsForUser(prisma(), feed.user.id, filters)
      const excluded = await nonTeachingDates(prisma(), '2000-01-01', '2100-01-01')

      // Classes that stopped existing still travel, as cancellations. A client
      // can only remove an event it is told about.
      const tombstones = await prisma().calendarTombstone.findMany({
        where: { userId: feed.user.id, expiresAt: { gt: new Date() } },
      })

      await prisma().calendarFeedToken.update({
        where: { id: feed.id },
        data: { lastFetchedAt: new Date() },
      })

      const events: IcsSession[] = [
        ...sessions.map((session) => sessionToIcs(session, context)),
        ...tombstones.map((tombstone) =>
          tombstoneToIcsSession(
            tombstone.sessionId,
            tombstone.payloadJson as unknown as TombstonePayload,
            tombstone.cancelledAt,
          ),
        ),
      ]

      const body = buildIcsFeed(events, {
        calendarName: `UAcademic · ${feed.user.firstName} ${feed.user.lastName}`,
        timezone: context.timezone,
        excludedDates: excluded,
        refreshMinutes: settings.calendar.feedRefreshMinutes,
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
    const { centerId, db } = requireCenterScope(request)
    const query = parseWith(printSchema, request.query)
    const t = (key: string) => translate(request.locale, key)

    // The period on screen, not the window the browser happened to fetch.
    const range = rangeForView(query)
    const sessions = await publishedSessionsFor(db, user.userId, query.subjectId)
    const excluded = await nonTeachingDates(db, range.from, range.to)
    const rows = expand(sessions, range.from, range.to, excluded)

    // A month and a week are drawn as a calendar page, which is what the
    // screen shows; a day and the agenda are a list, which is also what the
    // screen shows.
    if (query.view === 'month' || query.view === 'week') {
      const center = await prisma().center.findUnique({
        where: { id: centerId },
        select: { name: true },
      })

      const grid = await scheduleMonthlyPdf({
        teacherName: `${user.firstName} ${user.lastName}`,
        centerName: center?.name ?? '',
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
        .header('content-disposition', 'attachment; filename="uacademic-calendar.pdf"')
        .send(grid)
    }

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
      .text(`${user.firstName} ${user.lastName} · ${range.from} – ${range.to}`)
    document.moveDown().fillColor('#0f172a')

    if (rows.length === 0) {
      document.fontSize(11).text(t('calendar.empty'))
    } else {
      /*
        The colours and what each of them is. A page of coloured rules is
        only readable to somebody who already knows the timetable.
      */
      const left = document.page.margins.left
      const subjects = new Map<string, (typeof rows)[number]>()
      for (const row of rows) if (!subjects.has(row.subjectId)) subjects.set(row.subjectId, row)

      let legendX = left
      const legendY = document.y

      for (const row of subjects.values()) {
        const colour = calendarColor(row.subjectId, row.subjectColor)
        const label = `${row.subjectCode} ${row.subjectName}`
        const width = Math.min(170, 14 + document.fontSize(8).widthOfString(label))
        if (legendX + width > document.page.width - document.page.margins.right) break

        document.rect(legendX, legendY + 2, 7, 7).fill(colour.accent)
        document
          .fillColor('#475569')
          .fontSize(8)
          .text(label, legendX + 11, legendY, {
            width: width - 11,
            lineBreak: false,
            ellipsis: true,
          })

        legendX += width + 8
      }

      document.x = left
      document.y = legendY + 16

      let currentDate = ''
      for (const row of rows) {
        if (row.date !== currentDate) {
          currentDate = row.date
          document.x = left
          document
            .moveDown(0.5)
            .fillColor('#0f172a')
            .fontSize(12)
            .text(row.date, { underline: true })
        }

        const colour = calendarColor(row.subjectId, row.subjectColor)
        const top = document.y

        // The subject's colour as a rule down the left of the line: ink on
        // paper rather than a pale block, which is expensive to print.
        document.rect(left, top + 1, 4, 11).fill(colour.accent)

        document
          .fillColor('#0f172a')
          .fontSize(10)
          .text(
            [
              `${row.startTime}–${row.endTime}`,
              `${row.subjectCode} ${row.groupCode}`,
              // What the class is: the topic where somebody wrote one, the
              // subject in full where they did not.
              row.topic ?? row.subjectName,
              row.spaceName ?? '',
            ]
              .filter(Boolean)
              .join('  '),
            left + 10,
            top,
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

export function toIcsSession(session: CalendarSession): IcsSession {
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

export function expand(
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
export async function publishedSessionsFor(
  client: PrismaClient,
  userId: string,
  subjectId?: string,
): Promise<CalendarSession[]> {
  return publishedSessionsWhere(client, {
    // A class given by two people is on both their calendars, so being the
    // second name on it counts exactly as much as being the first.
    OR: [{ teacherProfile: { userId } }, { coTeachers: { some: { teacherProfile: { userId } } } }],
    ...(subjectId ? { group: { subjectId } } : {}),
  })
}

/** The same, addressed by the contract rather than by the person. */
export async function publishedSessionsForProfile(
  client: PrismaClient,
  teacherProfileId: string,
): Promise<CalendarSession[]> {
  return publishedSessionsWhere(client, {
    OR: [{ teacherProfileId }, { coTeachers: { some: { teacherProfileId } } }],
  })
}

export async function publishedSessionsWhere(
  client: PrismaClient,
  where: Record<string, unknown>,
): Promise<CalendarSession[]> {
  const rows = (await client.classSession.findMany({
    where: {
      scheduleVersion: { status: 'published' },
      ...where,
    },
    include: {
      group: {
        select: {
          id: true,
          code: true,
          subject: { select: { id: true, code: true, nameCa: true, color: true } },
        },
      },
      space: { select: { id: true, name: true } },
      teacherProfile: {
        select: { id: true, user: { select: { firstName: true, lastName: true } } },
      },
      coTeachers: {
        select: {
          teacherProfileId: true,
          teacherProfile: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
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
    topic: string | null
    group: {
      id: string
      code: string
      subject: { id: string; code: string; nameCa: string; color: string | null }
    }
    space: { id: string; name: string } | null
    teacherProfile: { id: string; user: { firstName: string; lastName: string } } | null
    coTeachers: {
      teacherProfileId: string
      teacherProfile: { user: { firstName: string; lastName: string } }
    }[]
  }[]

  return rows.map((row) => ({
    id: row.id,
    subjectId: row.group.subject.id,
    subjectCode: row.group.subject.code,
    subjectName: row.group.subject.nameCa,
    subjectColor: row.group.subject.color,
    groupId: row.group.id,
    groupCode: row.group.code,
    spaceId: row.space?.id ?? null,
    spaceName: row.space?.name ?? null,
    topic: row.topic,
    teacherProfileId: row.teacherProfile?.id ?? null,
    teacherName: row.teacherProfile
      ? `${row.teacherProfile.user.firstName} ${row.teacherProfile.user.lastName}`
      : null,
    teachers: [
      ...(row.teacherProfile
        ? [
            {
              teacherProfileId: row.teacherProfile.id,
              name: `${row.teacherProfile.user.firstName} ${row.teacherProfile.user.lastName}`,
            },
          ]
        : []),
      ...row.coTeachers.map((entry) => ({
        teacherProfileId: entry.teacherProfileId,
        name: `${entry.teacherProfile.user.firstName} ${entry.teacherProfile.user.lastName}`,
      })),
    ],
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    recurrence: row.recurrence,
  }))
}

/** Holidays and closures: the days a weekly class does not happen. */
export async function nonTeachingDates(
  client: PrismaClient,
  from: string,
  to: string,
): Promise<string[]> {
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
