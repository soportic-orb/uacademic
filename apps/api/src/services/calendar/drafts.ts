/**
 * One description of "the classes this person's calendar should show", used by
 * every surface that exports them: the ICS feed, Microsoft Graph and Google.
 *
 * Keeping it in one place is what stops the three from drifting — a title that
 * reads one way in Outlook and another in a subscription is the kind of bug
 * nobody reports and everybody notices.
 */
import {
  type CalendarEventDraft,
  type CalendarSettings,
  type IcsSession,
  type Weekday,
  renderTemplate,
  sequenceFor,
} from '@uacademic/shared'

import type { PrismaClient } from '../../lib/prisma.js'

export interface FeedFilters {
  academicYearId?: string | null
  subjectId?: string | null
  /** Also show the classes colleagues teach on the subjects this person owns. */
  includeColleagues?: boolean
}

export interface DraftContext {
  timezone: string
  centerName: string
  settings: CalendarSettings
  /** Base URL of the web app, for the deep link on every event. */
  appUrl: string
}

interface SessionRow {
  id: string
  weekday: number
  startTime: string
  endTime: string
  dateFrom: Date
  dateTo: Date
  recurrence: 'weekly' | 'biweekly' | 'once'
  updatedAt: Date
  group: {
    code: string
    type: string
    subject: { id: string; code: string; nameCa: string; academicYearId: string }
  }
  space: { name: string; building: string | null } | null
  teacherProfile: { user: { firstName: string; lastName: string } } | null
  coTeachers: { teacherProfile: { user: { firstName: string; lastName: string } } }[]
}

/**
 * The published sessions of one person.
 *
 * Only ever the published version: a draft timetable is nobody's Tuesday, and
 * it must never reach a phone.
 */
export async function sessionsForUser(
  client: PrismaClient,
  userId: string,
  filters: FeedFilters = {},
): Promise<SessionRow[]> {
  const own = {
    scheduleVersion: { status: 'published' as const },
    // Their own classes: the ones they give alone and the ones they share.
    OR: [{ teacherProfile: { userId } }, { coTeachers: { some: { teacherProfile: { userId } } } }],
    ...(filters.subjectId ? { group: { subjectId: filters.subjectId } } : {}),
    ...(filters.academicYearId
      ? { group: { subject: { academicYearId: filters.academicYearId } } }
      : {}),
  }

  const where = filters.includeColleagues
    ? {
        scheduleVersion: { status: 'published' as const },
        ...(filters.subjectId ? { group: { subjectId: filters.subjectId } } : {}),
        group: {
          ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
          subject: {
            ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
            OR: [
              { coordinators: { some: { userId } } },
              { groups: { some: { sessions: { some: { teacherProfile: { userId } } } } } },
            ],
          },
        },
      }
    : own

  return (await client.classSession.findMany({
    where,
    include: {
      group: {
        select: {
          code: true,
          type: true,
          subject: { select: { id: true, code: true, nameCa: true, academicYearId: true } },
        },
      },
      space: { select: { name: true, building: true } },
      teacherProfile: { select: { user: { select: { firstName: true, lastName: true } } } },
      coTeachers: {
        select: {
          teacherProfile: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    take: 1_000,
  })) as unknown as SessionRow[]
}

function values(row: SessionRow, context: DraftContext): Record<string, string> {
  return {
    subjectCode: row.group.subject.code,
    subjectName: row.group.subject.nameCa,
    groupCode: row.group.code,
    groupType: row.group.type,
    spaceName: row.space?.name ?? '',
    building: row.space?.building ?? '',
    // Everyone giving it, so a shared class does not reach a phone under one
    // person's name.
    teacherName: [
      ...(row.teacherProfile ? [row.teacherProfile.user] : []),
      ...row.coTeachers.map((entry) => entry.teacherProfile.user),
    ]
      .map((user) => `${user.firstName} ${user.lastName}`.trim())
      .join(', '),
    centerName: context.centerName,
  }
}

export function toIcsSession(row: SessionRow, context: DraftContext): IcsSession {
  const fields = values(row, context)

  return {
    id: row.id,
    summary: renderTemplate(context.settings.summaryTemplate, fields),
    location: renderTemplate(context.settings.locationTemplate, fields) || undefined,
    description: fields.teacherName || undefined,
    url: `${context.appUrl.replace(/\/$/, '')}/calendar?session=${row.id}`,
    weekday: row.weekday as Weekday,
    startTime: row.startTime as IcsSession['startTime'],
    endTime: row.endTime as IcsSession['endTime'],
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    recurrence: row.recurrence,
    sequence: sequenceFor(row.updatedAt),
    status: 'confirmed',
  }
}

export function toEventDraft(row: SessionRow, context: DraftContext): CalendarEventDraft {
  const session = toIcsSession(row, context)

  return {
    sessionId: row.id,
    summary: session.summary,
    ...(session.description ? { description: session.description } : {}),
    ...(session.location ? { location: session.location } : {}),
    ...(session.url ? { url: session.url } : {}),
    weekday: session.weekday,
    startTime: session.startTime,
    endTime: session.endTime,
    dateFrom: session.dateFrom,
    dateTo: session.dateTo,
    recurrence: session.recurrence,
    timezone: context.timezone,
    sequence: session.sequence ?? 0,
  }
}

export interface TombstonePayload {
  summary: string
  location?: string
  weekday: number
  startTime: string
  endTime: string
  dateFrom: string
  dateTo: string
  recurrence: 'weekly' | 'biweekly' | 'once'
}

/**
 * A cancelled class, still as a VEVENT. The sequence is stamped from the
 * moment of cancellation so it always outranks whatever the client holds —
 * otherwise the tombstone is quietly ignored and the class stays on screen.
 */
export function tombstoneToIcsSession(
  sessionId: string,
  payload: TombstonePayload,
  cancelledAt: Date,
): IcsSession {
  return {
    id: sessionId,
    summary: payload.summary,
    ...(payload.location ? { location: payload.location } : {}),
    weekday: payload.weekday as Weekday,
    startTime: payload.startTime as IcsSession['startTime'],
    endTime: payload.endTime as IcsSession['endTime'],
    dateFrom: new Date(payload.dateFrom),
    dateTo: new Date(payload.dateTo),
    recurrence: payload.recurrence,
    sequence: sequenceFor(cancelledAt),
    status: 'cancelled',
  }
}

export function tombstonePayload(row: SessionRow, context: DraftContext): TombstonePayload {
  const session = toIcsSession(row, context)
  return {
    summary: session.summary,
    ...(session.location ? { location: session.location } : {}),
    weekday: session.weekday,
    startTime: session.startTime,
    endTime: session.endTime,
    dateFrom: session.dateFrom.toISOString().slice(0, 10),
    dateTo: session.dateTo.toISOString().slice(0, 10),
    recurrence: session.recurrence,
  }
}
