import {
  isSuperadmin,
  listQuerySchema,
  paginate,
  roleSchema,
  toListResult,
  userInputSchema,
  userRoleInputSchema,
} from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { enqueueJob } from '../../jobs/worker.js'
import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'
import { mailConfigured } from '../../services/mailer.js'

/**
 * Users are global rows with per-center roles, so they cannot go through the
 * generic CRUD factory: a center administrator must see exactly the people who
 * hold a role in their center, and nobody else (R2).
 */
const listQuery = listQuerySchema(['lastName', 'email', 'status', 'createdAt'], {
  status: z.string().trim().min(1).optional(),
  role: roleSchema.optional(),
})

/**
 * Who may manage the people in a center.
 *
 * The platform administrator is here for a reason that is easy to miss until
 * it bites: a fresh installation has exactly one account, and it is a
 * SUPERADMIN. Without this they could create universities and centers and
 * then nobody at all — not even the center administrator who would have been
 * allowed to create everybody else. Every query below is still scoped to the
 * active center, so this widens who may act, never what they can see (R2).
 */
const CENTER_MANAGER_ROLES = ['SUPERADMIN', 'CENTER_ADMIN'] as const

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/api/v1/users', { config: { roles: CENTER_MANAGER_ROLES } }, async (request) => {
    const { centerId } = requireCenterScope(request)
    const query = parseWith(listQuery, request.query)
    const client = prisma()

    const where = {
      // The membership filter *is* the tenant boundary for this table.
      centerRoles: {
        some: { centerId, ...(query.role ? { role: query.role } : {}) },
      },
      ...(query.status ? { status: query.status as 'active' } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q } },
              { lastName: { contains: query.q } },
              { email: { contains: query.q } },
            ],
          }
        : {}),
    }

    const { skip, take } = paginate(query.page, query.pageSize)
    const [users, total] = await Promise.all([
      client.user.findMany({
        where,
        orderBy: { [query.sort ?? 'lastName']: query.order },
        skip,
        take,
        include: { centerRoles: { where: { centerId }, select: { id: true, role: true } } },
      }),
      client.user.count({ where }),
    ])

    return toListResult(
      users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: user.locale,
        status: user.status,
        avatarUrl: user.avatarUrl,
        /** Whether this person has ever signed in with Microsoft. */
        linkedToEntra: Boolean(user.entraOid),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        roles: user.centerRoles.map((membership) => membership.role),
        // The grants themselves, because revoking one needs its id and a
        // screen that can only name roles cannot offer to take one away.
        grants: user.centerRoles.map((membership) => ({
          id: membership.id,
          role: membership.role,
        })),
      })),
      total,
      query.page,
      query.pageSize,
    )
  })

  /**
   * Creating a user here does not create a password: they will sign in through
   * their organization, and the account is linked on first sign-in by `oid`.
   */
  app.post('/api/v1/users', { config: { roles: CENTER_MANAGER_ROLES } }, async (request, reply) => {
    const { centerId } = requireCenterScope(request)
    const actor = requireUser(request)
    const input = parseWith(userInputSchema.extend({ role: roleSchema }), request.body)

    // Only a platform administrator hands out platform administration. The
    // sibling route below has always refused this; creating a user did not,
    // so a center administrator could grant it on the way in.
    if (input.role === 'SUPERADMIN' && !isSuperadmin(actor)) throw AppError.forbidden()

    const client = prisma()

    const existing = await client.user.findUnique({ where: { email: input.email.toLowerCase() } })
    if (existing) {
      // Already known to the platform: grant the role instead of duplicating.
      const already = await client.userCenterRole.findFirst({
        where: { userId: existing.id, centerId, role: input.role },
      })
      if (already) throw AppError.conflict()

      await client.userCenterRole.create({
        data: { userId: existing.id, centerId, role: input.role },
      })
      await writeAuditLog(client, {
        centerId,
        userId: actor.userId,
        entity: 'user_center_role',
        entityId: existing.id,
        action: 'grant',
        after: { role: input.role },
        source: 'user',
        ip: request.ip,
      })

      void reply.status(201)
      return { id: existing.id, email: existing.email, created: false }
    }

    const created = await client.user.create({
      data: {
        email: input.email.toLowerCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        locale: input.locale,
        status: input.status,
        centerRoles: { create: { centerId, role: input.role } },
      },
    })

    await writeAuditLog(client, {
      centerId,
      userId: actor.userId,
      entity: 'user',
      entityId: created.id,
      action: 'create',
      after: { email: created.email, role: input.role, status: created.status },
      source: 'user',
      ip: request.ip,
    })

    // The invitation itself. Queued rather than sent inline: an SMTP server
    // that hangs must not hang the request that created the account.
    const center = await client.center.findUnique({ where: { id: centerId } })
    await enqueueJob(client, 'user.invite', {
      email: created.email,
      locale: created.locale,
      firstName: created.firstName,
      centerName: center?.name ?? '',
      url: env().APP_URL,
    })

    void reply.status(201)
    // Whether anybody will actually receive it. With no SMTP host the queue
    // writes the message to the log, and the screen must not claim otherwise.
    return {
      id: created.id,
      email: created.email,
      created: true,
      invitationSent: mailConfigured(),
    }
  })

  /**
   * Sending the invitation again.
   *
   * Needed more often than it looks: the first one goes out the moment the
   * account is created, which is exactly when an installation is most likely
   * to have no working mail server yet.
   */
  app.post(
    '/api/v1/users/:id/invite',
    { config: { roles: CENTER_MANAGER_ROLES } },
    async (request) => {
      const { centerId } = requireCenterScope(request)
      const actor = requireUser(request)
      const { id } = request.params as { id: string }
      const client = prisma()

      const user = await requireMember(id, centerId)
      const center = await client.center.findUnique({ where: { id: centerId } })

      await enqueueJob(client, 'user.invite', {
        email: user.email,
        locale: user.locale,
        firstName: user.firstName,
        centerName: center?.name ?? '',
        url: env().APP_URL,
      })

      await writeAuditLog(client, {
        centerId,
        userId: actor.userId,
        entity: 'user',
        entityId: user.id,
        action: 'invite',
        after: { email: user.email },
        source: 'user',
        ip: request.ip,
      })

      return { sent: mailConfigured() }
    },
  )

  app.patch('/api/v1/users/:id', { config: { roles: CENTER_MANAGER_ROLES } }, async (request) => {
    const { centerId } = requireCenterScope(request)
    const actor = requireUser(request)
    const { id } = request.params as { id: string }
    const input = parseWith(userInputSchema.partial(), request.body)
    const client = prisma()

    const before = await requireMember(id, centerId)

    const after = await client.user.update({
      where: { id },
      data: {
        ...(input.firstName ? { firstName: input.firstName } : {}),
        ...(input.lastName ? { lastName: input.lastName } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    })

    await writeAuditLog(client, {
      centerId,
      userId: actor.userId,
      entity: 'user',
      entityId: id,
      action: 'update',
      before: { status: before.status, firstName: before.firstName, lastName: before.lastName },
      after: { status: after.status, firstName: after.firstName, lastName: after.lastName },
      source: 'user',
      ip: request.ip,
    })

    return { id: after.id, status: after.status }
  })

  /** Approves an account that JIT provisioning left pending (R3). */
  app.post(
    '/api/v1/users/:id/activate',
    { config: { roles: CENTER_MANAGER_ROLES } },
    async (request) => {
      const { centerId } = requireCenterScope(request)
      const actor = requireUser(request)
      const { id } = request.params as { id: string }
      const client = prisma()

      const user = await requireMember(id, centerId)
      if (user.status === 'active') return { id: user.id, status: user.status }

      const activated = await client.user.update({ where: { id }, data: { status: 'active' } })

      await writeAuditLog(client, {
        centerId,
        userId: actor.userId,
        entity: 'user',
        entityId: id,
        action: 'activate',
        before: { status: user.status },
        after: { status: activated.status },
        source: 'user',
        ip: request.ip,
      })

      return { id: activated.id, status: activated.status }
    },
  )

  app.post(
    '/api/v1/users/:id/roles',
    { config: { roles: CENTER_MANAGER_ROLES } },
    async (request) => {
      const { centerId } = requireCenterScope(request)
      const actor = requireUser(request)
      const { id } = request.params as { id: string }
      const input = parseWith(userRoleInputSchema.omit({ userId: true }), request.body)
      const client = prisma()

      // A center administrator cannot mint platform superadmins.
      if (input.role === 'SUPERADMIN' && !isSuperadmin(actor)) throw AppError.forbidden()
      await requireUserExists(id)

      const existing = await client.userCenterRole.findFirst({
        where: { userId: id, centerId, role: input.role },
      })
      if (existing) throw AppError.conflict()

      const created = await client.userCenterRole.create({
        data: {
          userId: id,
          centerId,
          role: input.role,
          ...(input.validFrom ? { validFrom: new Date(input.validFrom) } : {}),
          ...(input.validTo ? { validTo: new Date(input.validTo) } : {}),
        },
      })

      await writeAuditLog(client, {
        centerId,
        userId: actor.userId,
        entity: 'user_center_role',
        entityId: created.id,
        action: 'grant',
        after: { userId: id, role: input.role },
        source: 'user',
        ip: request.ip,
      })

      return { id: created.id, role: created.role }
    },
  )

  app.delete(
    '/api/v1/users/:id/roles/:roleId',
    { config: { roles: CENTER_MANAGER_ROLES } },
    async (request) => {
      const { centerId } = requireCenterScope(request)
      const actor = requireUser(request)
      const { id, roleId } = request.params as { id: string; roleId: string }
      const client = prisma()

      const membership = await client.userCenterRole.findFirst({
        where: { id: roleId, userId: id, centerId },
      })
      if (!membership) throw AppError.notFound()

      await client.userCenterRole.delete({ where: { id: roleId } })

      await writeAuditLog(client, {
        centerId,
        userId: actor.userId,
        entity: 'user_center_role',
        entityId: roleId,
        action: 'revoke',
        before: { userId: id, role: membership.role },
        source: 'user',
        ip: request.ip,
      })

      return { ok: true }
    },
  )

  /**
   * Removing a person.
   *
   * Not one operation but the most that can honestly be done, in order: their
   * roles in this center go, and then the account itself if nothing is left of
   * it anywhere. What usually stops the last step is `audit_log`, which refuses
   * to give up its author (R4) — an account that has ever done anything cannot
   * be erased without erasing the record of it. That account is suspended
   * instead, which is what "cannot sign in any more" actually means here.
   */
  app.delete('/api/v1/users/:id', { config: { roles: CENTER_MANAGER_ROLES } }, async (request) => {
    const { centerId } = requireCenterScope(request)
    const actor = requireUser(request)
    const { id } = request.params as { id: string }
    const client = prisma()

    // Deleting the account you are signed in with locks you out of the screen
    // you are standing on, and on a fresh installation there is no second way in.
    if (id === actor.userId) {
      throw AppError.validation([{ path: 'id', messageKey: 'admin.errors.cannotDeleteSelf' }])
    }

    const user = await requireMember(id, centerId)
    const grants = await client.userCenterRole.findMany({ where: { userId: id } })

    // Platform administration is only ever taken away by platform administration.
    if (grants.some((grant) => grant.role === 'SUPERADMIN') && !isSuperadmin(actor)) {
      throw AppError.forbidden()
    }

    const here = grants.filter((grant) => grant.centerId === centerId)
    await client.userCenterRole.deleteMany({ where: { userId: id, centerId } })

    let outcome: 'unlinked' | 'deleted' | 'suspended' = 'unlinked'

    if (here.length === grants.length) {
      try {
        await client.user.delete({ where: { id } })
        outcome = 'deleted'
      } catch {
        // Referenced by something that outlives them — the audit log, a
        // published timetable. The account stays, unable to sign in.
        await client.user.update({ where: { id }, data: { status: 'suspended' } })
        outcome = 'suspended'
      }
    }

    await writeAuditLog(client, {
      centerId,
      userId: actor.userId,
      entity: 'user',
      entityId: id,
      action: 'delete',
      before: { email: user.email, roles: here.map((grant) => grant.role) },
      after: { outcome },
      source: 'user',
      ip: request.ip,
    })

    return { outcome }
  })
}

/** A center administrator may only touch people who belong to their center. */
async function requireMember(userId: string, centerId: string) {
  const user = await prisma().user.findFirst({
    where: { id: userId, centerRoles: { some: { centerId } } },
  })
  if (!user) throw AppError.notFound()
  return user
}

async function requireUserExists(userId: string) {
  const user = await prisma().user.findUnique({ where: { id: userId } })
  if (!user) throw AppError.notFound()
  return user
}
