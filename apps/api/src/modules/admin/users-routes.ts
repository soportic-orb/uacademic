import {
  listQuerySchema,
  paginate,
  roleSchema,
  toListResult,
  userInputSchema,
  userRoleInputSchema,
} from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

/**
 * Users are global rows with per-center roles, so they cannot go through the
 * generic CRUD factory: a center administrator must see exactly the people who
 * hold a role in their center, and nobody else (R2).
 */
const listQuery = listQuerySchema(['lastName', 'email', 'status', 'createdAt'], {
  status: z.string().trim().min(1).optional(),
  role: roleSchema.optional(),
})

const CENTER_MANAGER_ROLES = ['CENTER_ADMIN'] as const

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
        /** Whether this person has ever signed in with Microsoft. */
        linkedToEntra: Boolean(user.entraOid),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        roles: user.centerRoles.map((membership) => membership.role),
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

    void reply.status(201)
    return { id: created.id, email: created.email, created: true }
  })

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

  app.post('/api/v1/users/:id/roles', { config: { roles: CENTER_MANAGER_ROLES } }, async (request) => {
    const { centerId } = requireCenterScope(request)
    const actor = requireUser(request)
    const { id } = request.params as { id: string }
    const input = parseWith(userRoleInputSchema.omit({ userId: true }), request.body)
    const client = prisma()

    // A center administrator cannot mint platform superadmins.
    if (input.role === 'SUPERADMIN') throw AppError.forbidden()
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
  })

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
