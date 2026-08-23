/**
 * The planner API: versions, the sessions inside them, live validation and the
 * automatic generation.
 *
 * Two rules run through all of it. A version that is not a draft or in review
 * cannot be touched — publication is a snapshot, not a mutable state. And every
 * placement is judged by the shared engine (R7) against the center's own
 * settings (R9), never by ad-hoc checks written here.
 */
import {
  type PlannedSession,
  type ScheduleVersionStatus,
  type SessionSnapshot,
  evaluateCell,
  evaluateTransition,
  groupPlanState,
  isEditable,
  scoreSchedule,
  summarizePlan,
  toMinutes,
  diffSchedules,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import type { RealtimeTransport } from '../../lib/realtime.js'
import { parseWith } from '../../lib/validate.js'
import {
  type PlannerContext,
  plannerContext,
  sessionInclude,
  sessionRequirements,
  toPlannedSession,
  toSnapshot,
} from './context.js'
import { publishVersion, readSnapshot } from './publish.js'

const COORDINATION = ['CENTER_ADMIN', 'COORDINATOR'] as const

const versionSchema = z.object({
  name: z.string().trim().min(3).max(150),
})

const createVersionSchema = versionSchema.extend({
  /** Copy the sessions of an existing version into the new draft. */
  fromVersionId: z.uuid().optional(),
})

const statusSchema = z.object({
  status: z.enum(['draft', 'in_review', 'published', 'archived']),
})

/**
 * One class, on one day.
 *
 * The date is the session. Nothing repeats it: a week is planned by placing
 * the classes of that week, and the following week is placed again. The
 * weekday still travels with it because everything downstream reads timetables
 * in weekdays — it is derived from the date rather than chosen.
 */
const sessionSchema = z.object({
  groupId: z.uuid(),
  teacherProfileId: z.uuid().nullable().default(null),
  spaceId: z.uuid().nullable().default(null),
  /** The day it happens, `YYYY-MM-DD`. */
  date: z.iso.date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** What the class is about, typed on the block itself. */
  topic: z.string().trim().max(200).nullable().optional(),
})

/**
 * A patch is not a partial create: `sessionSchema` defaults the nullable
 * fields to `null`, so reusing it here would let a drag that only moves a
 * session to a new slot quietly erase its teacher and its room.
 */
const sessionPatchSchema = z.object({
  groupId: z.uuid().optional(),
  teacherProfileId: z.uuid().nullable().optional(),
  spaceId: z.uuid().nullable().optional(),
  /** Moving it to another day, which is the only way a session moves. */
  date: z.iso.date().optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  topic: z.string().trim().max(200).nullable().optional(),
})

const validateSchema = sessionSchema.extend({
  /** The session being moved, excluded from the comparison. */
  sessionId: z.uuid().optional(),
})

export function registerPlannerRoutes(app: FastifyInstance, bus: RealtimeTransport): void {
  app.get('/api/v1/planner/versions', { config: { roles: [...COORDINATION] } }, async (request) => {
    const context = await plannerContext(request)
    const versions = await context.db.scheduleVersion.findMany({
      where: { academicYearId: context.academicYearId },
      include: {
        _count: { select: { sessions: true } },
        publisher: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    })

    return {
      academicYearId: context.academicYearId,
      items: versions.map((version) => ({
        id: version.id,
        name: version.name,
        status: version.status,
        sessions: version._count.sessions,
        publishedAt: version.publishedAt?.toISOString() ?? null,
        publishedBy: version.publisher
          ? `${version.publisher.firstName} ${version.publisher.lastName}`
          : null,
        parentVersionId: version.parentVersionId,
        editable: isEditable(version.status),
      })),
    }
  })

  app.post(
    '/api/v1/planner/versions',
    { config: { roles: [...COORDINATION] } },
    async (request, reply) => {
      const context = await plannerContext(request)
      const input = parseWith(createVersionSchema, request.body)

      const created = await context.db.scheduleVersion.create({
        data: {
          centerId: context.centerId,
          academicYearId: context.academicYearId,
          name: input.name,
          status: 'draft',
          ...(input.fromVersionId ? { parentVersionId: input.fromVersionId } : {}),
        },
      })

      if (input.fromVersionId) {
        const source = await context.db.classSession.findMany({
          where: { scheduleVersionId: input.fromVersionId },
        })
        if (source.length > 0) {
          await context.db.classSession.createMany({
            data: source.map((session) => ({
              centerId: context.centerId,
              scheduleVersionId: created.id,
              groupId: session.groupId,
              teacherProfileId: session.teacherProfileId,
              spaceId: session.spaceId,
              weekday: session.weekday,
              startTime: session.startTime,
              endTime: session.endTime,
              dateFrom: session.dateFrom,
              dateTo: session.dateTo,
              recurrence: session.recurrence,
            })),
          })
        }
      }

      await audit(request, context, created.id, 'create', null, {
        name: input.name,
        fromVersionId: input.fromVersionId ?? null,
      })

      return reply.code(201).send(await versionDetail(context, created.id))
    },
  )

  app.get(
    '/api/v1/planner/versions/:id',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) =>
      versionDetail(await plannerContext(request), request.params.id),
  )

  /**
   * Renaming one.
   *
   * A published version can be renamed too. The name is a label a person put
   * on a draft — "Provisional", "Amb els canvis del departament" — and the
   * moment it is published is exactly when it stops being accurate. Nothing
   * downstream reads it: the snapshot, the diff and the notifications are
   * keyed on the version's id.
   */
  app.patch(
    '/api/v1/planner/versions/:id',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await plannerContext(request)
      const input = parseWith(versionSchema, request.body)
      const version = await findVersion(context, request.params.id)

      await context.db.scheduleVersion.update({
        where: { id: version.id },
        data: { name: input.name },
      })

      await audit(request, context, version.id, 'rename', { name: version.name }, input)
      return versionDetail(context, version.id)
    },
  )

  app.patch(
    '/api/v1/planner/versions/:id/status',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await plannerContext(request)
      const input = parseWith(statusSchema, request.body)
      const version = await findVersion(context, request.params.id)

      const sessions = await loadSessions(context, version.id)
      const score = scoreSchedule(sessions.map(toPlannedSession), context.schedule)

      const decision = evaluateTransition({
        from: version.status as ScheduleVersionStatus,
        to: input.status,
        requiresReview: context.settings.workflow.coordinatorApprovesChanges,
        blockingViolations: score.violations.length,
      })
      if (!decision.allowed) {
        throw new AppError(409, 'CONFLICT', decision.messageKey ?? 'errors.conflict')
      }

      if (input.status !== 'published') {
        await context.db.scheduleVersion.update({
          where: { id: version.id },
          data: { status: input.status },
        })
        await audit(request, context, version.id, 'status', { status: version.status }, input)

        return { ...(await versionDetail(context, version.id)), notified: 0 }
      }

      const result = await publishVersion({
        client: prisma(),
        centerId: context.centerId,
        academicYearId: context.academicYearId,
        versionId: version.id,
        versionName: version.name,
        sessions: sessions.map(toSnapshot),
        userId: context.user.userId,
        bus,
        ip: request.ip,
      })

      return {
        ...(await versionDetail(context, version.id)),
        notified: result.notified,
        diff: result.diff.summary,
      }
    },
  )

  /** The version comparator: what changes between any two versions. */
  app.get(
    '/api/v1/planner/versions/:id/compare',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { with?: string } }>) => {
      const context = await plannerContext(request)
      const targetId = request.query.with
      if (!targetId) {
        throw AppError.validation([{ path: 'with', messageKey: 'validation.required' }])
      }

      const [base, target] = await Promise.all([
        versionSnapshot(context, request.params.id),
        versionSnapshot(context, targetId),
      ])

      const diff = diffSchedules(base.sessions, target.sessions)
      return {
        base: base.version,
        target: target.version,
        summary: diff.summary,
        changes: diff.changes,
        byTeacher: diff.byTeacher,
      }
    },
  )

  app.delete(
    '/api/v1/planner/versions/:id',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const context = await plannerContext(request)
      const version = await findVersion(context, request.params.id)
      if (!isEditable(version.status as ScheduleVersionStatus)) {
        throw new AppError(409, 'CONFLICT', 'planner.version.errors.notEditable')
      }

      await context.db.scheduleVersion.delete({ where: { id: version.id } })
      await audit(request, context, version.id, 'delete', { name: version.name }, null)
      return reply.code(204).send()
    },
  )

  registerSessionRoutes(app)
}

function registerSessionRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/planner/versions/:id/sessions',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const context = await plannerContext(request)
      const version = await requireEditable(context, request.params.id)
      const input = parseWith(sessionSchema, request.body)
      const day = dayOf(input.date)

      const created = await context.db.classSession.create({
        data: {
          centerId: context.centerId,
          scheduleVersionId: version.id,
          groupId: input.groupId,
          teacherProfileId: input.teacherProfileId,
          spaceId: input.spaceId,
          weekday: day.weekday,
          startTime: input.startTime,
          endTime: input.endTime,
          // The same day at both ends, happening once: a class is placed on a
          // date and is never repeated onto another by the platform.
          dateFrom: day.date,
          dateTo: day.date,
          recurrence: 'once',
          topic: input.topic ?? null,
        },
      })

      await audit(request, context, created.id, 'session.create', null, input, 'class_session')
      return reply.code(201).send(await versionDetail(context, version.id))
    },
  )

  app.patch(
    '/api/v1/planner/versions/:id/sessions/:sessionId',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string; sessionId: string } }>) => {
      const context = await plannerContext(request)
      const version = await requireEditable(context, request.params.id)
      const input = parseWith(sessionPatchSchema, request.body)

      const before = await context.db.classSession.findFirst({
        where: { id: request.params.sessionId, scheduleVersionId: version.id },
      })
      if (!before) throw AppError.notFound()

      await context.db.classSession.update({
        where: { id: before.id },
        data: {
          ...(input.groupId ? { groupId: input.groupId } : {}),
          ...(input.teacherProfileId !== undefined
            ? { teacherProfileId: input.teacherProfileId }
            : {}),
          ...(input.spaceId !== undefined ? { spaceId: input.spaceId } : {}),
          ...(input.date
            ? {
                weekday: dayOf(input.date).weekday,
                dateFrom: dayOf(input.date).date,
                dateTo: dayOf(input.date).date,
                recurrence: 'once' as const,
              }
            : {}),
          ...(input.startTime ? { startTime: input.startTime } : {}),
          ...(input.endTime ? { endTime: input.endTime } : {}),
          // `undefined` is "leave it"; `null` is "clear what was written".
          ...(input.topic !== undefined ? { topic: input.topic } : {}),
        },
      })

      await audit(
        request,
        context,
        before.id,
        'session.update',
        {
          weekday: before.weekday,
          startTime: before.startTime,
          endTime: before.endTime,
          teacherProfileId: before.teacherProfileId,
          spaceId: before.spaceId,
        },
        input,
        'class_session',
      )

      return versionDetail(context, version.id)
    },
  )

  app.delete(
    '/api/v1/planner/versions/:id/sessions/:sessionId',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string; sessionId: string } }>) => {
      const context = await plannerContext(request)
      const version = await requireEditable(context, request.params.id)

      const before = await context.db.classSession.findFirst({
        where: { id: request.params.sessionId, scheduleVersionId: version.id },
      })
      if (!before) throw AppError.notFound()

      await context.db.classSession.delete({ where: { id: before.id } })
      await audit(
        request,
        context,
        before.id,
        'session.delete',
        { groupId: before.groupId, weekday: before.weekday, startTime: before.startTime },
        null,
        'class_session',
      )

      return versionDetail(context, version.id)
    },
  )

  /**
   * What the planner asks on every drag: is this cell green, amber or red, and
   * why. The answer is the engine's, so the tooltip and the refusal to save
   * cannot disagree.
   */
  app.post(
    '/api/v1/planner/versions/:id/validate',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await plannerContext(request)
      const version = await findVersion(context, request.params.id)
      const input = parseWith(validateSchema, request.body)

      const sessions = (await loadSessions(context, version.id)).map(toPlannedSession)
      const others = sessions.filter((session) => session.id !== input.sessionId)
      const day = dayOf(input.date)

      // One day, once: the candidate is checked against the classes that
      // actually happen on it, which is the only comparison worth making now
      // that nothing repeats.
      const candidate: PlannedSession = {
        id: input.sessionId ?? 'candidate',
        groupId: input.groupId,
        teacherProfileId: input.teacherProfileId,
        spaceId: input.spaceId,
        weekday: day.weekday as PlannedSession['weekday'],
        startTime: input.startTime,
        endTime: input.endTime,
        dateFrom: day.date,
        dateTo: day.date,
        recurrence: 'once',
      }

      return evaluateCell(candidate, others, context.schedule)
    },
  )
}

/** The dates a group's sessions run between, from its subject's term. */
/**
 * A date, as the two things the database keeps: the day itself and its ISO
 * weekday. Read in UTC, because the column is a `DATE` and a local reading
 * shifts it by one for half the world.
 */
function dayOf(date: string): { date: Date; weekday: number } {
  const day = new Date(`${date}T00:00:00Z`)
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay()
  return { date: day, weekday }
}

async function findVersion(context: PlannerContext, id: string) {
  const version = await context.db.scheduleVersion.findFirst({
    where: { id, academicYearId: context.academicYearId },
  })
  if (!version) throw AppError.notFound()
  return version
}

async function requireEditable(context: PlannerContext, id: string) {
  const version = await findVersion(context, id)
  if (!isEditable(version.status as ScheduleVersionStatus)) {
    throw new AppError(409, 'CONFLICT', 'planner.version.errors.notEditable')
  }
  return version
}

async function loadSessions(context: PlannerContext, versionId: string) {
  return context.db.classSession.findMany({
    where: { scheduleVersionId: versionId },
    include: sessionInclude(),
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  })
}

/**
 * A published version is read from its snapshot rather than its rows: the
 * snapshot is what people were told, and it must not drift.
 */
async function versionSnapshot(
  context: PlannerContext,
  versionId: string,
): Promise<{ version: { id: string; name: string; status: string }; sessions: SessionSnapshot[] }> {
  const version = await findVersion(context, versionId)
  const stored = readSnapshot(version.snapshotJson)

  const sessions =
    stored.length > 0 ? stored : (await loadSessions(context, versionId)).map(toSnapshot)

  return {
    version: { id: version.id, name: version.name, status: version.status },
    sessions,
  }
}

async function versionDetail(context: PlannerContext, versionId: string) {
  const version = await findVersion(context, versionId)
  const rows = await loadSessions(context, versionId)
  const sessions = rows.map(toPlannedSession)

  /*
    The days the center is shut, for the week on screen.

    The planner is a weekly template — a session on Monday repeats over every
    Monday of the term — and the engine already skips closures when it
    materialises the term. What was missing was saying so on the grid, which is
    where somebody is deciding whether to put a class there at all.
  */
  const calendar = await context.db.academicCalendarEntry.findMany({
    where: { academicYearId: context.academicYearId },
    select: { dateFrom: true, dateTo: true, type: true, nameCa: true, isTeachingDay: true },
    orderBy: { dateFrom: 'asc' },
  })

  const requirements = await sessionRequirements(context)
  const pending = Math.max(0, requirements.length - sessions.length)
  const score = scoreSchedule(sessions, context.schedule)

  // Every group of the year, so the side column can be about the subject
  // somebody is planning rather than only about what is left over.
  const groups = await context.db.group.findMany({
    where: { subject: { academicYearId: context.academicYearId } },
    select: { id: true, plannedHours: true },
    orderBy: { code: 'asc' },
  })

  return {
    id: version.id,
    name: version.name,
    status: version.status,
    editable: isEditable(version.status as ScheduleVersionStatus),
    // The engine travels with the week: the planner runs the very same pure
    // functions in the browser, so a cell turns amber the instant it is
    // dragged over instead of after a round trip. The server still decides —
    // it recomputes the violations on every write.
    context: {
      settings: context.settings,
      teachers: [...context.schedule.teachers.values()],
      spaces: [...context.schedule.spaces.values()],
      groups: [...context.schedule.groups.values()],
      // Names and capacities, for the column of colleagues beside the week.
      directory: context.directory,
      calendar: calendar.map((entry) => ({
        dateFrom: entry.dateFrom.toISOString().slice(0, 10),
        dateTo: entry.dateTo.toISOString().slice(0, 10),
        type: entry.type,
        name: entry.nameCa,
        isTeachingDay: entry.isTeachingDay,
      })),
    },
    publishedAt: version.publishedAt?.toISOString() ?? null,
    parentVersionId: version.parentVersionId,
    grid: {
      dayStart: context.settings.schedule.dayStart,
      dayEnd: context.settings.schedule.dayEnd,
      slotMinutes: context.settings.schedule.slotMinutes,
      weekdays: context.settings.schedule.workingWeekdays,
    },
    sessions: rows.map((row) => ({
      ...toSnapshot(row),
      building: row.space?.building ?? null,
      dateFrom: row.dateFrom.toISOString().slice(0, 10),
      dateTo: row.dateTo.toISOString().slice(0, 10),
      topic: row.topic ?? null,
    })),
    violations: score.violations,
    penalties: score.penalties,
    summary: summarizePlan(sessions, pending, context.schedule),
    pending: pendingGroups(context, requirements, sessions),
    groups: groupPlans(context, requirements, groups, sessions),
    /*
      The dates this year runs between.

      The grid opens on a week inside them rather than on today's: a
      coordinator planning next September in June would otherwise be handed a
      week in which none of the classes they place exist, and watch each one
      vanish as it landed.
    */
    range: {
      from: context.academicYear.startDate.toISOString().slice(0, 10),
      to: context.academicYear.endDate.toISOString().slice(0, 10),
    },
  }
}

/**
 * The side column: every group of the year, with how much of it is placed.
 *
 * Every group, not only the ones still to place and not only the ones with a
 * teacher assigned. A coordinator planning a subject wants to see its groups —
 * the finished ones as much as the empty ones, because "have I done this one?"
 * is the question the column exists to answer — and a group nobody has been
 * assigned to yet is precisely one that needs placing and staffing, so hiding
 * it is hiding the work.
 */
function groupPlans(
  context: PlannerContext,
  requirements: {
    id: string
    groupId: string
    durationMinutes: number
    candidateTeacherIds: readonly string[]
    candidateSpaceIds: readonly string[]
  }[],
  groups: readonly { id: string; plannedHours: unknown }[],
  sessions: readonly PlannedSession[],
) {
  const { teachingWeeks, defaultSessionMinutes } = context.settings.schedule

  const placedByGroup = new Map<string, number>()
  for (const session of sessions) {
    const minutes = toMinutes(session.endTime) - toMinutes(session.startTime)
    placedByGroup.set(session.groupId, (placedByGroup.get(session.groupId) ?? 0) + minutes)
  }

  // The first requirement of a group carries the candidates the engine worked
  // out — who may teach it and where it fits — which is what a drag from this
  // column needs to start with.
  const requirementByGroup = new Map<string, (typeof requirements)[number]>()
  for (const requirement of requirements) {
    if (!requirementByGroup.has(requirement.groupId)) {
      requirementByGroup.set(requirement.groupId, requirement)
    }
  }

  return groups.map((row) => {
    const resource = context.schedule.groups.get(row.id)
    const requirement = requirementByGroup.get(row.id)
    const plannedHours = Number(row.plannedHours)

    const state = groupPlanState({
      plannedHours,
      teachingWeeks,
      sessionMinutes: requirement?.durationMinutes ?? defaultSessionMinutes,
      placedMinutes: placedByGroup.get(row.id) ?? 0,
    })

    return {
      groupId: row.id,
      groupCode: resource?.code ?? '',
      subjectId: resource?.subjectId ?? '',
      subjectCode: resource?.subjectCode ?? '',
      subjectName: resource?.subjectName ?? '',
      plannedHours,
      durationMinutes: requirement?.durationMinutes ?? defaultSessionMinutes,
      weeklyTargetMinutes: state.weeklyTargetMinutes,
      placedMinutes: state.placedMinutes,
      remainingMinutes: state.remainingMinutes,
      overplannedMinutes: state.overplannedMinutes,
      sessionsRemaining: state.sessionsRemaining,
      complete: state.complete,
      // Empty for a group nobody has been assigned to: it can still be placed,
      // and the teacher chosen on the card afterwards.
      candidateTeacherIds: [...(requirement?.candidateTeacherIds ?? [])],
      candidateSpaceIds: [...(requirement?.candidateSpaceIds ?? [])],
    }
  })
}

/**
 * How many sessions are still unplaced, for the status bar. Requirements are
 * matched to placed sessions per group, so a group needing three sessions with
 * one placed contributes two.
 */
function pendingGroups(
  context: PlannerContext,
  requirements: {
    id: string
    groupId: string
    durationMinutes: number
    candidateTeacherIds: readonly string[]
    candidateSpaceIds: readonly string[]
  }[],
  sessions: readonly PlannedSession[],
) {
  const placedByGroup = new Map<string, number>()
  for (const session of sessions) {
    placedByGroup.set(session.groupId, (placedByGroup.get(session.groupId) ?? 0) + 1)
  }

  const pending: {
    requirementId: string
    groupId: string
    groupCode: string
    subjectCode: string
    subjectName: string
    durationMinutes: number
    candidateTeacherIds: string[]
    candidateSpaceIds: string[]
  }[] = []

  for (const requirement of requirements) {
    const remaining = placedByGroup.get(requirement.groupId) ?? 0
    if (remaining > 0) {
      placedByGroup.set(requirement.groupId, remaining - 1)
      continue
    }

    const group = context.schedule.groups.get(requirement.groupId)
    pending.push({
      requirementId: requirement.id,
      groupId: requirement.groupId,
      groupCode: group?.code ?? '',
      subjectCode: group?.subjectCode ?? '',
      subjectName: group?.subjectName ?? '',
      durationMinutes: requirement.durationMinutes,
      candidateTeacherIds: [...requirement.candidateTeacherIds],
      candidateSpaceIds: [...requirement.candidateSpaceIds],
    })
  }

  return pending
}

async function audit(
  request: FastifyRequest,
  context: PlannerContext,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
  entity = 'schedule_version',
): Promise<void> {
  await writeAuditLog(prisma(), {
    centerId: context.centerId,
    userId: context.user.userId,
    entity,
    entityId,
    action,
    before,
    after,
    source: 'user',
    ip: request.ip,
  })
}
