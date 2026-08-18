/**
 * Absences and substitutions.
 *
 * A teacher reports the days they will be away; the system then answers the
 * only question that follows — who can take those classes. Eligibility is the
 * planner's own engine (a substitute that breaks a hard constraint is not a
 * substitute) and the ranking is the pure scoring in `@uacademic/shared`, so
 * the order a coordinator sees can be explained candidate by candidate.
 *
 * Asking somebody to cover a class is a *request*, not an order: it creates a
 * change request targeted at them, and the timetable only moves when the
 * ladder reaches `applied`.
 */
import {
  type PlannedSession,
  type SubstituteCandidate,
  computeTeacherLoad,
  expiresAt,
  isoWeekday,
  rankSubstitutes,
  statusAfterSubmit,
  weeklyCapacityFrom,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { toJson } from '../../lib/json.js'
import { prisma } from '../../lib/prisma.js'
import type { RealtimeTransport } from '../../lib/realtime.js'
import { parseWith } from '../../lib/validate.js'
import { notify } from '../../services/notify.js'
import { plannerContext } from '../planner/context.js'
import { toPlannedSession } from '../planner/context.js'

const createSchema = z
  .object({
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    type: z.enum(['sick_leave', 'personal_leave', 'conference', 'training', 'other']),
    reason: z.string().trim().max(255).optional(),
  })
  .refine((input) => input.dateTo >= input.dateFrom, {
    message: 'validation.invalidRange',
    path: ['dateTo'],
  })

const statusSchema = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'cancelled']),
})

const substituteSchema = z.object({
  sessionId: z.uuid(),
  teacherProfileId: z.uuid(),
})

export function registerAbsenceRoutes(app: FastifyInstance, bus: RealtimeTransport): void {
  app.get('/api/v1/absences', async (request) => {
    const context = await plannerContext(request)
    const manages = canManage(context)

    const own = await context.db.teacherProfile.findFirst({
      where: { userId: context.user.userId, academicYearId: context.academicYearId },
      select: { id: true },
    })

    const rows = await context.db.absence.findMany({
      where: manages ? {} : { teacherProfileId: own?.id ?? '—' },
      include: {
        teacher: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        substitute: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: [{ dateFrom: 'desc' }],
      take: 200,
    })

    return { items: rows.map(serialize), canManage: manages }
  })

  app.post('/api/v1/absences', async (request, reply) => {
    const context = await plannerContext(request)
    const input = parseWith(createSchema, request.body)

    const profile = await context.db.teacherProfile.findFirst({
      where: { userId: context.user.userId, academicYearId: context.academicYearId },
    })
    if (!profile) throw AppError.notFound()

    const created = await context.db.absence.create({
      data: {
        centerId: context.centerId,
        teacherProfileId: profile.id,
        dateFrom: new Date(`${input.dateFrom}T00:00:00Z`),
        dateTo: new Date(`${input.dateTo}T00:00:00Z`),
        type: input.type,
        reason: input.reason ?? null,
        status: 'requested',
      },
    })

    await writeAuditLog(prisma(), {
      centerId: context.centerId,
      userId: context.user.userId,
      entity: 'absence',
      entityId: created.id,
      action: 'create',
      before: null,
      after: input,
      source: 'user',
      ip: request.ip,
    })

    // Coordination is told at once: an absence nobody sees is an uncovered class.
    const coordinators = await context.db.userCenterRole.findMany({
      where: { centerId: context.centerId, role: 'COORDINATOR' },
      select: { userId: true },
    })

    await notify({
      client: prisma(),
      bus,
      centerId: context.centerId,
      event: 'absence.reported',
      url: `/absences/${created.id}`,
      recipients: coordinators.map((coordinator) => ({ userId: coordinator.userId })),
      params: {
        teacher: `${context.user.firstName} ${context.user.lastName}`,
        from: input.dateFrom,
        to: input.dateTo,
      },
    })

    return reply.code(201).send(await detail(context, created.id))
  })

  app.patch(
    '/api/v1/absences/:id',
    { config: { roles: ['CENTER_ADMIN', 'COORDINATOR'] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await plannerContext(request)
      const input = parseWith(statusSchema, request.body)
      const before = await find(context, request.params.id)

      await context.db.absence.update({
        where: { id: before.id },
        data: { status: input.status },
      })

      await writeAuditLog(prisma(), {
        centerId: context.centerId,
        userId: context.user.userId,
        entity: 'absence',
        entityId: before.id,
        action: 'status',
        before: { status: before.status },
        after: input,
        source: 'user',
        ip: request.ip,
      })

      return detail(context, before.id)
    },
  )

  /** The classes the absence actually leaves uncovered. */
  app.get(
    '/api/v1/absences/:id/sessions',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await plannerContext(request)
      const absence = await find(context, request.params.id)
      return { items: await affectedSessions(context, absence) }
    },
  )

  /**
   * Who could take one of those classes, best first. Ineligible colleagues are
   * returned too, with the reason: "why can nobody cover Tuesday?" is the
   * question a coordinator actually asks.
   */
  app.get(
    '/api/v1/absences/:id/candidates',
    { config: { roles: ['CENTER_ADMIN', 'COORDINATOR'] } },
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { sessionId?: string } }>,
    ) => {
      const context = await plannerContext(request)
      const absence = await find(context, request.params.id)
      const sessionId = request.query.sessionId
      if (!sessionId) {
        throw AppError.validation([{ path: 'sessionId', messageKey: 'validation.required' }])
      }

      const session = await context.db.classSession.findFirst({
        where: { id: sessionId },
        include: { group: { select: { subjectId: true } } },
      })
      if (!session) throw AppError.notFound()

      const candidates = await buildCandidates(context, absence.teacherProfileId)

      return {
        sessionId,
        items: rankSubstitutes({
          session: toPlannedSession(session),
          subjectId: session.group.subjectId,
          knowledgeArea: null,
          context: context.schedule,
          candidates,
        }),
      }
    },
  )

  /** Asking a colleague to cover: a change request they can still decline. */
  app.post(
    '/api/v1/absences/:id/substitute',
    { config: { roles: ['CENTER_ADMIN', 'COORDINATOR'] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const context = await plannerContext(request)
      const absence = await find(context, request.params.id)
      const input = parseWith(substituteSchema, request.body)

      const substitute = await context.db.teacherProfile.findFirst({
        where: { id: input.teacherProfileId },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      })
      const session = await context.db.classSession.findFirst({
        where: { id: input.sessionId },
        include: { group: { select: { code: true, subject: { select: { code: true } } } } },
      })
      if (!substitute || !session) throw AppError.notFound()

      const rules = {
        coordinatorApproves: context.settings.workflow.coordinatorApprovesChanges,
        requiresTeacherAcceptance: true,
      }
      const createdAt = new Date()

      const changeRequest = await context.db.changeRequest.create({
        data: {
          centerId: context.centerId,
          type: 'substitution',
          requesterId: context.user.userId,
          targetUserId: substitute.user.id,
          sessionId: session.id,
          proposedJson: toJson({ teacherProfileId: substitute.id }),
          status: statusAfterSubmit(rules),
          reason: absence.reason ?? null,
          expiresAt: expiresAt({
            createdAt,
            expiryHours: context.settings.workflow.changeRequestExpiryHours,
          }),
        },
      })

      // The absence records who was asked; the timetable only moves when they
      // accept and the ladder reaches `applied`.
      await context.db.absence.update({
        where: { id: absence.id },
        data: { substituteProfileId: substitute.id },
      })

      await writeAuditLog(prisma(), {
        centerId: context.centerId,
        userId: context.user.userId,
        entity: 'absence',
        entityId: absence.id,
        action: 'substitute',
        before: { substituteProfileId: absence.substituteProfileId },
        after: { substituteProfileId: substitute.id, changeRequestId: changeRequest.id },
        source: 'user',
        ip: request.ip,
      })

      await notify({
        client: prisma(),
        bus,
        centerId: context.centerId,
        event: 'absence.substituteAssigned',
        url: `/changes/${changeRequest.id}`,
        recipients: [{ userId: substitute.user.id }],
        params: {
          session: `${session.group.subject.code} ${session.group.code}`,
          from: absence.dateFrom.toISOString().slice(0, 10),
          to: absence.dateTo.toISOString().slice(0, 10),
        },
      })

      return reply
        .code(201)
        .send({ ...(await detail(context, absence.id)), changeRequestId: changeRequest.id })
    },
  )
}

type PlannerContext = Awaited<ReturnType<typeof plannerContext>>

function canManage(context: PlannerContext): boolean {
  return context.user.memberships.some(
    (membership) =>
      membership.centerId === context.centerId &&
      (membership.role === 'COORDINATOR' ||
        membership.role === 'CENTER_ADMIN' ||
        membership.role === 'SUPERADMIN'),
  )
}

interface AbsenceRow {
  id: string
  teacherProfileId: string
  substituteProfileId: string | null
  dateFrom: Date
  dateTo: Date
  type: string
  status: string
  reason: string | null
  teacher: { id: string; user: { firstName: string; lastName: string } }
  substitute: { id: string; user: { firstName: string; lastName: string } } | null
}

async function find(context: PlannerContext, id: string): Promise<AbsenceRow> {
  const row = await context.db.absence.findFirst({
    where: { id },
    include: {
      teacher: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
      substitute: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
    },
  })
  if (!row) throw AppError.notFound()

  // A teacher may only look at their own absences.
  if (!canManage(context)) {
    const own = await context.db.teacherProfile.findFirst({
      where: { userId: context.user.userId, academicYearId: context.academicYearId },
      select: { id: true },
    })
    if (own?.id !== row.teacherProfileId) throw AppError.forbidden()
  }

  return row as AbsenceRow
}

function serialize(row: AbsenceRow) {
  return {
    id: row.id,
    teacherProfileId: row.teacherProfileId,
    teacherName: `${row.teacher.user.firstName} ${row.teacher.user.lastName}`,
    substituteProfileId: row.substituteProfileId,
    substituteName: row.substitute
      ? `${row.substitute.user.firstName} ${row.substitute.user.lastName}`
      : null,
    dateFrom: row.dateFrom.toISOString().slice(0, 10),
    dateTo: row.dateTo.toISOString().slice(0, 10),
    type: row.type,
    status: row.status,
    reason: row.reason,
  }
}

async function detail(context: PlannerContext, id: string) {
  const row = await find(context, id)
  return { ...serialize(row), sessions: await affectedSessions(context, row) }
}

/**
 * The published classes that fall inside the absence. Weekly sessions are
 * matched by weekday, which is what a range of days actually hits.
 */
async function affectedSessions(context: PlannerContext, absence: AbsenceRow) {
  const weekdays = new Set<number>()
  const cursor = new Date(absence.dateFrom.getTime())
  while (cursor.getTime() <= absence.dateTo.getTime()) {
    weekdays.add(isoWeekday(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  const sessions = await context.db.classSession.findMany({
    where: {
      teacherProfileId: absence.teacherProfileId,
      weekday: { in: [...weekdays] },
      scheduleVersion: { status: 'published' },
      dateFrom: { lte: absence.dateTo },
      dateTo: { gte: absence.dateFrom },
    },
    include: {
      group: { select: { code: true, subject: { select: { code: true, nameCa: true } } } },
      space: { select: { name: true } },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  })

  return sessions.map((session) => ({
    id: session.id,
    weekday: session.weekday,
    startTime: session.startTime,
    endTime: session.endTime,
    label: `${session.group.subject.code} ${session.group.code}`,
    subjectName: session.group.subject.nameCa,
    spaceName: session.space?.name ?? null,
  }))
}

/** Every colleague of the center, with what the ranking needs to judge them. */
async function buildCandidates(
  context: PlannerContext,
  absentProfileId: string,
): Promise<SubstituteCandidate[]> {
  const profiles = await context.db.teacherProfile.findMany({
    where: { academicYearId: context.academicYearId, NOT: { id: absentProfileId } },
    include: {
      user: { select: { firstName: true, lastName: true } },
      availability: true,
      reductions: { select: { hours: true, status: true } },
      skills: { select: { subjectId: true, knowledgeArea: true } },
      sessions: { where: { scheduleVersion: { status: 'published' } } },
    },
  })

  return profiles.map((profile) => {
    const load = computeTeacherLoad({
      contractedHours: Number(profile.contractedHours),
      reductions: profile.reductions.map((reduction) => ({
        hours: Number(reduction.hours),
        approved: reduction.status === 'approved',
      })),
    })

    const weeklyCapacity = weeklyCapacityFrom(load.capacityHours, context.settings)
    const sessions: PlannedSession[] = profile.sessions.map(toPlannedSession)
    const scheduled = sessions.reduce((total, session) => total + hoursOf(session), 0)

    return {
      teacherProfileId: profile.id,
      name: `${profile.user.firstName} ${profile.user.lastName}`,
      subjectIds: profile.skills.flatMap((skill) => (skill.subjectId ? [skill.subjectId] : [])),
      knowledgeAreas: profile.skills.flatMap((skill) =>
        skill.knowledgeArea ? [skill.knowledgeArea] : [],
      ),
      availability: profile.availability.map((entry) => ({
        weekday: entry.weekday as PlannedSession['weekday'],
        startTime: entry.startTime,
        endTime: entry.endTime,
        level: entry.level,
      })),
      remainingWeeklyHours: Math.round((weeklyCapacity - scheduled) * 100) / 100,
      sessions,
    }
  })
}

function hoursOf(session: PlannedSession): number {
  const [startHour = 0, startMinute = 0] = session.startTime.split(':').map(Number)
  const [endHour = 0, endMinute = 0] = session.endTime.split(':').map(Number)
  return (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60
}
