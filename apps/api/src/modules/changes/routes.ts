/**
 * Class-change requests.
 *
 * Every transition does the same three things, in this order: it asks the
 * shared ladder whether the move is legal for this actor, it re-checks the
 * change against the published week with the planner's engine, and it records
 * what happened (R4) before telling the people the step concerns (R1, in their
 * own language).
 */
import {
  type ChangeRequestAction,
  type ChangeRequestStatus,
  type NotificationEvent,
  audienceFor,
  availableActionsFor,
  evaluateChangeTransitionAs,
  expiresAt,
  statusAfterSubmit,
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
import {
  type ChangeRow,
  actorsFor,
  applyChange,
  evaluateChange,
  recipientsFor,
  refreshSnapshot,
  rulesFor,
} from './service.js'

const proposalSchema = z.object({
  weekday: z.number().int().min(1).max(7).optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  spaceId: z.uuid().nullable().optional(),
  teacherProfileId: z.uuid().nullable().optional(),
  swapWithSessionId: z.uuid().optional(),
  note: z.string().trim().max(500).optional(),
})

const createSchema = z.object({
  type: z.enum([
    'session_swap',
    'session_move',
    'session_cancel',
    'space_change',
    'substitution',
    'availability_change',
  ]),
  sessionId: z.uuid().optional(),
  targetUserId: z.uuid().optional(),
  reason: z.string().trim().max(1000).optional(),
  proposal: proposalSchema,
  /** False leaves it as a draft the requester can still edit. */
  submit: z.boolean().default(true),
})

const listSchema = z.object({
  status: z
    .enum([
      'draft',
      'requested',
      'accepted_by_teacher',
      'approved_by_coordinator',
      'applied',
      'rejected',
      'cancelled',
      'expired',
    ])
    .optional(),
  /** `mine` filters to what the caller has to answer. */
  scope: z.enum(['all', 'mine', 'open']).default('all'),
})

const actionSchema = z.object({
  action: z.enum(['submit', 'accept', 'reject', 'approve', 'apply', 'cancel']),
  reason: z.string().trim().max(1000).optional(),
})

/** The event each landing state raises. */
const EVENT_BY_STATUS: Partial<Record<ChangeRequestStatus, NotificationEvent>> = {
  requested: 'change.requested',
  accepted_by_teacher: 'change.accepted',
  approved_by_coordinator: 'change.approved',
  applied: 'change.applied',
  rejected: 'change.rejected',
  expired: 'change.expired',
}

export function registerChangeRoutes(app: FastifyInstance, bus: RealtimeTransport): void {
  app.get('/api/v1/changes', async (request) => {
    const context = await plannerContext(request)
    const query = parseWith(listSchema, request.query)
    const user = context.user

    const rows = await context.db.changeRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.scope === 'open'
          ? {
              status: {
                in: ['draft', 'requested', 'accepted_by_teacher', 'approved_by_coordinator'],
              },
            }
          : {}),
        ...(query.scope === 'mine'
          ? { OR: [{ requesterId: user.userId }, { targetUserId: user.userId }] }
          : {}),
      },
      include: {
        requester: { select: { firstName: true, lastName: true } },
        targetUser: { select: { firstName: true, lastName: true } },
        session: {
          select: {
            id: true,
            weekday: true,
            startTime: true,
            endTime: true,
            group: { select: { code: true, subject: { select: { code: true, nameCa: true } } } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    })

    return {
      items: rows.map((row) => ({
        ...serialize(row),
        actions: availableActionsFor(
          row.status,
          actorsFor(user, row as ChangeRow),
          rulesFor(context.settings, row as ChangeRow),
        ),
      })),
    }
  })

  app.post('/api/v1/changes', async (request, reply) => {
    const context = await plannerContext(request)
    const input = parseWith(createSchema, request.body)

    if (input.sessionId) {
      const session = await context.db.classSession.findFirst({ where: { id: input.sessionId } })
      if (!session) throw AppError.notFound()
    }

    const rules = {
      coordinatorApproves: context.settings.workflow.coordinatorApprovesChanges,
      requiresTeacherAcceptance: Boolean(input.targetUserId),
    }
    const status = input.submit ? statusAfterSubmit(rules) : 'draft'
    const createdAt = new Date()

    const created = await context.db.changeRequest.create({
      data: {
        centerId: context.centerId,
        type: input.type,
        requesterId: context.user.userId,
        targetUserId: input.targetUserId ?? null,
        sessionId: input.sessionId ?? null,
        proposedJson: toJson(input.proposal),
        status,
        reason: input.reason ?? null,
        expiresAt: expiresAt({
          createdAt,
          expiryHours: context.settings.workflow.changeRequestExpiryHours,
        }),
      },
    })

    await audit(request, context.centerId, context.user.userId, created.id, 'create', null, {
      type: input.type,
      status,
      proposal: input.proposal,
    })

    // A change that needs nobody's word is already the timetable's business.
    if (status === 'applied') {
      await applyAndRecord(request, context, created as ChangeRow, bus)
    } else if (status !== 'draft') {
      await announce(context, created as ChangeRow, status, bus)
    }

    return reply.code(201).send(await detail(context, created.id))
  })

  /**
   * The classes the caller may propose a change for: their own, as published.
   * A draft timetable is nobody's to swap — the ladder only ever moves what is
   * already live.
   */
  app.get('/api/v1/changes/sessions', async (request) => {
    const context = await plannerContext(request)

    const sessions = await context.db.classSession.findMany({
      where: {
        scheduleVersion: { status: 'published' },
        teacherProfile: { userId: context.user.userId },
      },
      include: {
        group: { select: { code: true, subject: { select: { code: true, nameCa: true } } } },
        space: { select: { id: true, name: true } },
      },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    })

    return {
      items: sessions.map((session) => ({
        id: session.id,
        weekday: session.weekday,
        startTime: session.startTime,
        endTime: session.endTime,
        label: `${session.group.subject.code} ${session.group.code}`,
        subjectName: session.group.subject.nameCa,
        spaceId: session.space?.id ?? null,
        spaceName: session.space?.name ?? null,
      })),
    }
  })

  app.get('/api/v1/changes/:id', async (request: FastifyRequest<{ Params: { id: string } }>) =>
    detail(await plannerContext(request), request.params.id),
  )

  /**
   * One route for every step of the ladder: the machine decides, not the URL.
   */
  app.post(
    '/api/v1/changes/:id/transition',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await plannerContext(request)
      const input = parseWith(actionSchema, request.body)
      const row = await find(context, request.params.id)

      const actors = actorsFor(context.user, row)
      if (actors.length === 0) throw AppError.forbidden()

      const rules = rulesFor(context.settings, row)
      const decision = evaluateChangeTransitionAs({
        ...rules,
        status: row.status,
        action: input.action as ChangeRequestAction,
        actors,
      })
      if (!decision.allowed || !decision.status) {
        throw new AppError(409, 'CONFLICT', decision.messageKey ?? 'errors.conflict')
      }

      // Nothing is written into a live timetable that the engine refuses —
      // including through the auto-apply that follows an approval, which would
      // otherwise slip past the guard and leave the request silently stuck.
      const willApply =
        decision.status === 'applied' ||
        (decision.status === 'approved_by_coordinator' &&
          context.settings.workflow.autoApplyApprovedChanges)

      if (willApply) {
        const effect = await evaluateChange(prisma(), row, context.schedule)
        if (effect.violations.length > 0) {
          throw new AppError(409, 'CONFLICT', 'changes.errors.conflicts')
        }
      }

      const updated = await context.db.changeRequest.update({
        where: { id: row.id },
        data: {
          status: decision.status,
          ...(input.reason ? { reason: input.reason } : {}),
          ...(decision.status === 'applied' ? { appliedAt: new Date() } : {}),
          ...(['rejected', 'cancelled', 'applied', 'approved_by_coordinator'].includes(
            decision.status,
          )
            ? { resolvedBy: context.user.userId, resolvedAt: new Date() }
            : {}),
        },
      })

      await audit(
        request,
        context.centerId,
        context.user.userId,
        row.id,
        input.action,
        { status: row.status },
        { status: decision.status },
      )

      if (decision.status === 'applied') {
        await applyAndRecord(request, context, updated as ChangeRow, bus)
      } else {
        await announce(context, updated as ChangeRow, decision.status, bus)

        // With approval given and auto-apply on, the change lands by itself:
        // a coordinator should not have to click twice to mean one thing.
        if (
          decision.status === 'approved_by_coordinator' &&
          context.settings.workflow.autoApplyApprovedChanges
        ) {
          const applied = await context.db.changeRequest.update({
            where: { id: row.id },
            data: { status: 'applied', appliedAt: new Date() },
          })
          await applyAndRecord(request, context, applied as ChangeRow, bus)
        }
      }

      return detail(context, row.id)
    },
  )
}

type PlannerContext = Awaited<ReturnType<typeof plannerContext>>

async function find(context: PlannerContext, id: string): Promise<ChangeRow> {
  const row = await context.db.changeRequest.findFirst({ where: { id } })
  if (!row) throw AppError.notFound()
  return row as ChangeRow
}

async function detail(context: PlannerContext, id: string) {
  const row = await context.db.changeRequest.findFirst({
    where: { id },
    include: {
      requester: { select: { firstName: true, lastName: true } },
      targetUser: { select: { firstName: true, lastName: true } },
      session: {
        select: {
          id: true,
          weekday: true,
          startTime: true,
          endTime: true,
          group: { select: { code: true, subject: { select: { code: true, nameCa: true } } } },
        },
      },
    },
  })
  if (!row) throw AppError.notFound()

  const actors = actorsFor(context.user, row as ChangeRow)
  const effect = await evaluateChange(prisma(), row as ChangeRow, context.schedule)

  return {
    ...serialize(row),
    actors,
    actions: availableActionsFor(row.status, actors, rulesFor(context.settings, row as ChangeRow)),
    // The conflicts travel with the request so every screen shows the same
    // reasons, in the reader's language.
    violations: effect.violations,
    proposedSessions: effect.sessions.map((session) => ({
      id: session.id,
      weekday: session.weekday,
      startTime: session.startTime,
      endTime: session.endTime,
      spaceId: session.spaceId,
      teacherProfileId: session.teacherProfileId,
    })),
  }
}

interface SerializableRow {
  id: string
  type: string
  status: string
  reason: string | null
  createdAt: Date
  expiresAt: Date | null
  appliedAt: Date | null
  requesterId: string
  targetUserId: string | null
  proposedJson: unknown
  requester: { firstName: string; lastName: string }
  targetUser: { firstName: string; lastName: string } | null
  session: {
    id: string
    weekday: number
    startTime: string
    endTime: string
    group: { code: string; subject: { code: string; nameCa: string } }
  } | null
}

function serialize(row: SerializableRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    requesterId: row.requesterId,
    requesterName: `${row.requester.firstName} ${row.requester.lastName}`,
    targetUserId: row.targetUserId,
    targetName: row.targetUser ? `${row.targetUser.firstName} ${row.targetUser.lastName}` : null,
    proposal: row.proposedJson,
    session: row.session
      ? {
          id: row.session.id,
          weekday: row.session.weekday,
          startTime: row.session.startTime,
          endTime: row.session.endTime,
          label: `${row.session.group.subject.code} ${row.session.group.code}`,
          subjectName: row.session.group.subject.nameCa,
        }
      : null,
  }
}

async function applyAndRecord(
  request: FastifyRequest,
  context: PlannerContext,
  row: ChangeRow,
  bus: RealtimeTransport,
): Promise<void> {
  const effect = await evaluateChange(prisma(), row, context.schedule)
  const moved = await applyChange(prisma(), effect)
  await refreshSnapshot(
    prisma(),
    effect.sessions.map((session) => session.id),
  )

  await audit(
    request,
    context.centerId,
    context.user.userId,
    row.id,
    'apply',
    moved.before,
    moved.after,
    'class_session',
  )

  await announce(context, row, 'applied', bus)
}

async function announce(
  context: PlannerContext,
  row: ChangeRow,
  status: ChangeRequestStatus,
  bus: RealtimeTransport,
): Promise<void> {
  const event = EVENT_BY_STATUS[status]
  if (!event) return

  const recipients = await recipientsFor(prisma(), row, audienceFor(status))
  const session = row.sessionId
    ? await prisma().classSession.findUnique({
        where: { id: row.sessionId },
        include: { group: { select: { code: true, subject: { select: { code: true } } } } },
      })
    : null

  await notify({
    client: prisma(),
    bus,
    centerId: row.centerId,
    event,
    url: `/changes/${row.id}`,
    recipients: recipients
      // The person who just acted does not need to be told what they did.
      .filter((userId) => userId !== context.user.userId)
      .map((userId) => ({ userId })),
    params: {
      session: session ? `${session.group.subject.code} ${session.group.code}` : '',
    },
    data: { changeRequestId: row.id, status },
  })
}

async function audit(
  request: FastifyRequest,
  centerId: string,
  userId: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
  entity = 'change_request',
): Promise<void> {
  await writeAuditLog(prisma(), {
    centerId,
    userId,
    entity,
    entityId,
    action,
    before,
    after,
    source: 'user',
    ip: request.ip,
  })
}
