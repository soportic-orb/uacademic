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
  isEditable,
  scoreSchedule,
  summarizePlan,
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
  rangeForTerm,
  sessionInclude,
  sessionRequirements,
  termRanges,
  toPlannedSession,
  toSnapshot,
} from './context.js'
import { MAX_TIME_BUDGET_MS, readGeneration, startGeneration } from './generation.js'
import { publishVersion, readSnapshot } from './publish.js'

const COORDINATION = ['CENTER_ADMIN', 'COORDINATOR'] as const

const createVersionSchema = z.object({
  name: z.string().trim().min(3).max(150),
  /** Copy the sessions of an existing version into the new draft. */
  fromVersionId: z.uuid().optional(),
})

const statusSchema = z.object({
  status: z.enum(['draft', 'in_review', 'published', 'archived']),
})

const sessionSchema = z.object({
  groupId: z.uuid(),
  teacherProfileId: z.uuid().nullable().default(null),
  spaceId: z.uuid().nullable().default(null),
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  recurrence: z.enum(['weekly', 'biweekly', 'once']).default('weekly'),
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
  weekday: z.number().int().min(1).max(7).optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  recurrence: z.enum(['weekly', 'biweekly', 'once']).optional(),
})

const validateSchema = sessionSchema.extend({
  /** The session being moved, excluded from the comparison. */
  sessionId: z.uuid().optional(),
})

const generateSchema = z.object({
  seed: z.number().int().optional(),
  proposals: z.number().int().min(1).max(5).optional(),
  timeBudgetSeconds: z.number().int().min(1).max(60).optional(),
})

const applySchema = z.object({
  runId: z.uuid(),
  proposalId: z.string().min(1),
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
  registerGenerationRoutes(app, bus)
}

function registerSessionRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/planner/versions/:id/sessions',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const context = await plannerContext(request)
      const version = await requireEditable(context, request.params.id)
      const input = parseWith(sessionSchema, request.body)
      const range = await groupRange(context, input.groupId)

      const created = await context.db.classSession.create({
        data: {
          centerId: context.centerId,
          scheduleVersionId: version.id,
          groupId: input.groupId,
          teacherProfileId: input.teacherProfileId,
          spaceId: input.spaceId,
          weekday: input.weekday,
          startTime: input.startTime,
          endTime: input.endTime,
          dateFrom: range.from,
          dateTo: range.to,
          recurrence: input.recurrence,
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
          ...(input.weekday ? { weekday: input.weekday } : {}),
          ...(input.startTime ? { startTime: input.startTime } : {}),
          ...(input.endTime ? { endTime: input.endTime } : {}),
          ...(input.recurrence ? { recurrence: input.recurrence } : {}),
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
      const moved = sessions.find((session) => session.id === input.sessionId)
      // The candidate runs when its group runs; anything wider would collide
      // with the other term and refuse a placement that is perfectly legal.
      const range = moved
        ? { from: moved.dateFrom, to: moved.dateTo }
        : await groupRange(context, input.groupId)

      const candidate: PlannedSession = {
        id: input.sessionId ?? 'candidate',
        groupId: input.groupId,
        teacherProfileId: input.teacherProfileId,
        spaceId: input.spaceId,
        weekday: input.weekday as PlannedSession['weekday'],
        startTime: input.startTime,
        endTime: input.endTime,
        dateFrom: range.from,
        dateTo: range.to,
        recurrence: input.recurrence,
      }

      return evaluateCell(candidate, others, context.schedule)
    },
  )
}

function registerGenerationRoutes(app: FastifyInstance, bus: RealtimeTransport): void {
  app.post(
    '/api/v1/planner/versions/:id/generate',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const context = await plannerContext(request)
      const version = await requireEditable(context, request.params.id)
      const input = parseWith(generateSchema, request.body ?? {})

      const requirements = await sessionRequirements(context)
      if (requirements.length === 0) {
        throw AppError.validation([{ path: 'groups', messageKey: 'planner.generate.failed' }])
      }

      const budgetMs = Math.min(
        MAX_TIME_BUDGET_MS,
        (input.timeBudgetSeconds ?? context.settings.engine.timeBudgetSeconds) * 1000,
      )

      const runId = await startGeneration({
        centerId: context.centerId,
        scheduleVersionId: version.id,
        userId: context.user.userId,
        bus,
        input: {
          settings: context.settings,
          teachers: [...context.schedule.teachers.values()],
          spaces: [...context.schedule.spaces.values()],
          groups: [...context.schedule.groups.values()],
          requirements,
          fixed: [],
          seed: input.seed ?? Date.now() % 100_000,
          timeBudgetMs: budgetMs,
          proposals: input.proposals ?? context.settings.engine.proposals,
        },
      })

      return reply.code(202).send({ runId, requirements: requirements.length })
    },
  )

  app.get(
    '/api/v1/planner/runs/:runId',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { runId: string } }>) => {
      const context = await plannerContext(request)
      const run = await readGeneration(request.params.runId, context.centerId)
      if (!run) throw AppError.notFound()
      return run
    },
  )

  /** Applying a proposal replaces the draft's sessions with its own. */
  app.post(
    '/api/v1/planner/versions/:id/apply',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await plannerContext(request)
      const version = await requireEditable(context, request.params.id)
      const input = parseWith(applySchema, request.body)

      const run = await readGeneration(input.runId, context.centerId)
      if (!run || run.status !== 'done') throw AppError.notFound()

      const proposal = run.proposals.find((entry) => entry.id === input.proposalId)
      if (!proposal) throw AppError.notFound()

      await context.db.classSession.deleteMany({ where: { scheduleVersionId: version.id } })
      await context.db.classSession.createMany({
        data: proposal.sessions.map((session) => ({
          centerId: context.centerId,
          scheduleVersionId: version.id,
          groupId: session.groupId,
          teacherProfileId: session.teacherProfileId,
          spaceId: session.spaceId,
          weekday: session.weekday,
          startTime: session.startTime,
          endTime: session.endTime,
          dateFrom: session.dateFrom,
          dateTo: session.dateTo,
          recurrence: session.recurrence ?? 'weekly',
        })),
      })

      await audit(request, context, version.id, 'apply', null, {
        runId: input.runId,
        proposalId: input.proposalId,
        sessions: proposal.sessions.length,
      })

      return versionDetail(context, version.id)
    },
  )
}

/** The dates a group's sessions run between, from its subject's term. */
async function groupRange(context: PlannerContext, groupId: string) {
  const group = await context.db.group.findFirst({
    where: { id: groupId },
    select: { subject: { select: { term: true } } },
  })
  return rangeForTerm(await termRanges(context), group?.subject.term)
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

  const requirements = await sessionRequirements(context)
  const pending = Math.max(0, requirements.length - sessions.length)
  const score = scoreSchedule(sessions, context.schedule)

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
    })),
    violations: score.violations,
    penalties: score.penalties,
    summary: summarizePlan(sessions, pending, context.schedule),
    pending: pendingGroups(context, requirements, sessions),
  }
}

/**
 * The side column: what still has to be placed. Requirements are matched to
 * placed sessions per group, so a group needing three sessions with one placed
 * shows two.
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
