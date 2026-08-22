import {
  canGrantInCenter,
  isSuperadmin,
  listQuerySchema,
  paginate,
  roleSchema,
  toListResult,
  userCreateSchema,
  userInputSchema,
  userRoleInputSchema,
  uuidSchema,
} from '@uacademic/shared'
import type { PrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { enqueueJob } from '../../jobs/worker.js'
import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { type RequestUser, requireCenterScope, requireUser } from '../../plugins/context.js'
import { issueInvitation } from '../../services/invitations.js'
import { mailConfigured } from '../../services/mailer.js'

/**
 * The address in the invitation email: a one-time link to the screen where the
 * person chooses their own password.
 *
 * Minted here rather than in the job so the account and its way in are created
 * together — a queue that never drains would otherwise leave the invitation
 * without one.
 */
async function invitationUrl(client: PrismaClient, userId: string): Promise<string> {
  const { token } = await issueInvitation(client, userId)
  return `${env().APP_URL.replace(/\/$/, '')}/activate?token=${token}`
}

/**
 * Users are global rows with per-center roles, so they cannot go through the
 * generic CRUD factory: a center administrator must see exactly the people who
 * hold a role in their center, and nobody else (R2).
 */
const listQuery = listQuerySchema(['lastName', 'email', 'status', 'createdAt'], {
  status: z.string().trim().min(1).optional(),
  role: roleSchema.optional(),
  /**
   * Which center's people to list. Defaults to the active one.
   *
   * An administrator of two faculties has to be able to look at either without
   * changing what the whole application is pointed at — and, more to the point,
   * somebody they have just placed in the other one has to be findable. It was
   * not: the row simply did not appear, with nothing saying where it went.
   */
  centerId: uuidSchema.optional(),
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

/**
 * The centers this person may staff, grouped by university, for the picker on
 * the users screen.
 *
 * The superadmin sees the platform. A center administrator sees the centers
 * they administer and nothing else — not the other faculties of the same
 * university, and not the ones where they merely teach (R2).
 */
async function grantableCenters(actor: RequestUser) {
  const administered = actor.memberships
    .filter((membership) => membership.role === 'CENTER_ADMIN')
    .map((membership) => membership.centerId)

  const centers = await prisma().center.findMany({
    where: isSuperadmin(actor) ? {} : { id: { in: administered } },
    orderBy: [{ university: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      code: true,
      university: { select: { id: true, name: true } },
    },
  })

  const universities = new Map<
    string,
    { id: string; name: string; centers: { id: string; name: string; code: string }[] }
  >()
  for (const center of centers) {
    const entry = universities.get(center.university.id) ?? {
      id: center.university.id,
      name: center.university.name,
      centers: [],
    }
    entry.centers.push({ id: center.id, name: center.name, code: center.code })
    universities.set(center.university.id, entry)
  }

  return [...universities.values()]
}

/**
 * Refuses a grant into a center this person does not administer.
 *
 * The route guard only proves they administer *some* center; without this, a
 * center administrator could name any center id in the payload and staff a
 * faculty that is nothing to do with them (R2).
 */
function assertMayGrant(actor: RequestUser, centerId: string, role: string): void {
  if (!canGrantInCenter(actor, centerId)) throw AppError.forbidden()
  // Only a platform administrator hands out platform administration.
  if (role === 'SUPERADMIN' && !isSuperadmin(actor)) throw AppError.forbidden()
}

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/api/v1/users', { config: { roles: CENTER_MANAGER_ROLES } }, async (request) => {
    const actor = requireUser(request)
    const activeCenterId = requireCenterScope(request).centerId
    const query = parseWith(listQuery, request.query)
    const client = prisma()

    // Asking about another center is allowed only for one this person
    // administers; the check is the same one that governs writing (R2).
    const centerId = query.centerId ?? activeCenterId
    if (centerId !== activeCenterId) assertMayGrant(actor, centerId, 'TEACHER')

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

    const visibleCenterIds = (await grantableCenters(actor)).flatMap((university) =>
      university.centers.map((center) => center.id),
    )
    // The selected center is always among them: a center administrator manages
    // it, and the list itself is already filtered to its people.
    if (!visibleCenterIds.includes(centerId)) visibleCenterIds.push(centerId)

    const { skip, take } = paginate(query.page, query.pageSize)
    const [users, total] = await Promise.all([
      client.user.findMany({
        where,
        orderBy: { [query.sort ?? 'lastName']: query.order },
        skip,
        take,
        include: {
          // Every grant the person asking is entitled to see, not just the
          // ones in the center they happen to have selected: an administrator
          // of two faculties needs to know somebody is already in both before
          // adding them again. Centers they do not administer stay invisible
          // to them (R2).
          centerRoles: {
            where: { centerId: { in: visibleCenterIds } },
            select: {
              id: true,
              role: true,
              centerId: true,
              center: {
                select: { name: true, university: { select: { id: true, name: true } } },
              },
            },
          },
        },
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
        roles: user.centerRoles
          .filter((membership) => membership.centerId === centerId)
          .map((membership) => membership.role),
        // The grants themselves, because revoking one needs its id and a
        // screen that can only name roles cannot offer to take one away.
        grants: user.centerRoles.map((membership) => ({
          id: membership.id,
          role: membership.role,
          centerId: membership.centerId,
          centerName: membership.center.name,
          universityId: membership.center.university.id,
          universityName: membership.center.university.name,
        })),
      })),
      total,
      query.page,
      query.pageSize,
    )
  })

  /**
   * The universities and centers this person may put somebody into. The picker
   * on the users screen is built from it, and every write re-checks it.
   */
  app.get(
    '/api/v1/users/grantable-centers',
    { config: { roles: CENTER_MANAGER_ROLES } },
    async (request) => ({ universities: await grantableCenters(requireUser(request)) }),
  )

  /**
   * Creating a user does not create a password: the invitation does that
   * (`services/invitations.ts`), and somebody signing in through their
   * organization is linked on first sign-in by `oid` instead.
   *
   * The account is global; what belongs to a center is the role it is given —
   * and one account can be given several. The same person coordinating at one
   * faculty and teaching at another is one identity, not two, and asking them
   * to keep two passwords for it would be our filing showing through.
   */
  app.post('/api/v1/users', { config: { roles: CENTER_MANAGER_ROLES } }, async (request, reply) => {
    const actor = requireUser(request)
    const input = parseWith(userCreateSchema, request.body)

    for (const grant of input.grants) assertMayGrant(actor, grant.centerId, grant.role)

    const client = prisma()
    // The audit trail hangs off a center being granted rather than whichever
    // one happened to be selected in the header when the form was submitted.
    const primaryCenterId = input.grants[0]?.centerId ?? requireCenterScope(request).centerId

    const existing = await client.user.findUnique({ where: { email: input.email.toLowerCase() } })
    if (existing) {
      // Already known to the platform: add the roles rather than duplicate the
      // person. Roles they already hold are skipped, so adding somebody to a
      // second center is not refused because of the first.
      const held = await client.userCenterRole.findMany({ where: { userId: existing.id } })
      const fresh = input.grants.filter(
        (grant) =>
          !held.some(
            (membership) =>
              membership.centerId === grant.centerId && membership.role === grant.role,
          ),
      )
      if (fresh.length === 0) {
        // "The action conflicts with the current state" tells nobody anything.
        // This person is already where you are trying to put them.
        throw new AppError(409, 'CONFLICT', 'admin.errors.alreadyHasAccess')
      }

      await client.userCenterRole.createMany({
        data: fresh.map((grant) => ({
          userId: existing.id,
          centerId: grant.centerId,
          role: grant.role,
        })),
      })
      for (const grant of fresh) {
        await writeAuditLog(client, {
          centerId: grant.centerId,
          userId: actor.userId,
          entity: 'user_center_role',
          entityId: existing.id,
          action: 'grant',
          after: { role: grant.role },
          source: 'user',
          ip: request.ip,
        })
      }

      /*
        And an invitation, if it was asked for and they still have no way in.

        Two conditions, not one. Somebody who already signs in — with Microsoft
        or with a password they have set — needs no invitation and would only
        be confused by one. And whoever is adding them decides when they are
        written to: a batch of accounts prepared in July should not put fifty
        "your account is ready" messages into inboxes in July.
      */
      const canAlreadySignIn =
        existing.entraOid !== null ||
        (await client.localCredential.findUnique({ where: { userId: existing.id } })) !== null

      const invite = input.sendInvitation && !canAlreadySignIn

      if (invite) {
        const center = await client.center.findUnique({ where: { id: fresh[0]!.centerId } })
        await enqueueJob(client, 'user.invite', {
          email: existing.email,
          locale: existing.locale,
          firstName: existing.firstName,
          centerName: center?.name ?? '',
          url: await invitationUrl(client, existing.id),
        })
      }

      void reply.status(201)
      return {
        id: existing.id,
        email: existing.email,
        created: false,
        grantsAdded: fresh.length,
        // Always present, so the screen never has to guess from a missing
        // field — which is how it came to report a working mail server as
        // unconfigured.
        invitationSent: invite && mailConfigured(),
        alreadyCouldSignIn: canAlreadySignIn,
      }
    }

    const created = await client.user.create({
      data: {
        email: input.email.toLowerCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        locale: input.locale,
        status: input.status,
        centerRoles: {
          create: input.grants.map((grant) => ({ centerId: grant.centerId, role: grant.role })),
        },
      },
    })

    await writeAuditLog(client, {
      centerId: primaryCenterId,
      userId: actor.userId,
      entity: 'user',
      entityId: created.id,
      action: 'create',
      after: { email: created.email, grants: input.grants, status: created.status },
      source: 'user',
      ip: request.ip,
    })

    // The invitation, only if it was asked for. Queued rather than sent
    // inline: an SMTP server that hangs must not hang the request that created
    // the account.
    if (input.sendInvitation) {
      const center = await client.center.findUnique({ where: { id: primaryCenterId } })
      await enqueueJob(client, 'user.invite', {
        email: created.email,
        locale: created.locale,
        firstName: created.firstName,
        centerName: center?.name ?? '',
        url: await invitationUrl(client, created.id),
      })
    }

    void reply.status(201)
    // Whether anybody will actually receive it. With no SMTP host the queue
    // writes the message to the log, and the screen must not claim otherwise.
    return {
      id: created.id,
      email: created.email,
      created: true,
      grantsAdded: input.grants.length,
      invitationSent: input.sendInvitation && mailConfigured(),
      alreadyCouldSignIn: false,
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
        url: await invitationUrl(client, user.id),
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
      const actor = requireUser(request)
      const { id } = request.params as { id: string }
      const input = parseWith(
        // The center is optional so the existing screens keep working; naming
        // one is how somebody is added to a second center of their own.
        userRoleInputSchema.omit({ userId: true }).extend({ centerId: uuidSchema.optional() }),
        request.body,
      )
      const client = prisma()

      const centerId = input.centerId ?? requireCenterScope(request).centerId
      assertMayGrant(actor, centerId, input.role)
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
      const actor = requireUser(request)
      const { id, roleId } = request.params as { id: string; roleId: string }
      const client = prisma()

      // Found by its own id, then checked: an administrator of two centers
      // takes a role away from either, and from no third one.
      const membership = await client.userCenterRole.findFirst({
        where: { id: roleId, userId: id },
      })
      if (!membership) throw AppError.notFound()
      assertMayGrant(actor, membership.centerId, membership.role)

      await client.userCenterRole.delete({ where: { id: roleId } })

      await writeAuditLog(client, {
        centerId: membership.centerId,
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
