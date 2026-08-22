import type { CurrentUser, Role } from '@uacademic/shared'
import {
  AWAITING_COORDINATOR,
  menuLayoutSchema,
  roleSchema,
  sortRolesByRank,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { toJson } from '../../lib/json.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireUser } from '../../plugins/context.js'
import { menuDefaultFor } from '../../services/platform-settings.js'

/** The role the menu is drawn for when the request does not name one. */
function activeRole(request: FastifyRequest): Role {
  const user = requireUser(request)
  const held = user.memberships
    .filter((membership) => !request.centerId || membership.centerId === request.centerId)
    .map((membership) => membership.role)

  return sortRolesByRank(held)[0] ?? 'TEACHER'
}

export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/api/v1/me', async (request): Promise<CurrentUser> => {
    const user = requireUser(request)

    return {
      id: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      theme: user.theme,
      avatarUrl: user.avatarUrl,
      memberships: user.memberships.map((membership) => ({
        centerId: membership.centerId,
        centerName: user.centerNames.get(membership.centerId)?.name ?? '',
        centerCode: user.centerNames.get(membership.centerId)?.code ?? '',
        role: membership.role,
      })),
    }
  })

  /**
   * What is waiting for this person, per menu item.
   *
   * Only what *they* have to act on: a request still waiting on the colleague
   * it names is not coordination's to answer, and a badge that counts other
   * people's work is a badge people learn to ignore. Nothing is counted for
   * somebody who does not coordinate here — they have no screen to act on.
   */
  app.get('/api/v1/me/pending', async (request) => {
    const user = requireUser(request)
    const centerId = request.centerId

    const coordinates =
      centerId !== undefined &&
      user.memberships.some(
        (membership) =>
          membership.centerId === centerId &&
          (membership.role === 'COORDINATOR' || membership.role === 'CENTER_ADMIN'),
      )

    if (!coordinates || centerId === undefined) return { changes: 0, absences: 0 }

    const [changes, absences] = await Promise.all([
      prisma().changeRequest.count({
        where: { centerId, status: { in: [...AWAITING_COORDINATOR] } },
      }),
      prisma().absence.count({ where: { centerId, status: 'requested' } }),
    ])

    return { changes, absences }
  })

  /**
   * The order somebody keeps their own menu in.
   *
   * On the account rather than in the browser: it is a thing a person sat down
   * and arranged, and re-arranging it on the office machine because they first
   * did it at home is not a preference, it is losing their work. It carries no
   * permission — what the menu may contain is still decided by the roles, on
   * every request (R3) — so this is theirs to write with no further check.
   */
  app.get(
    '/api/v1/me/menu',
    async (request: FastifyRequest<{ Querystring: { role?: string } }>) => {
      const user = requireUser(request)
      const query = parseWith(z.object({ role: roleSchema.optional() }), request.query)

      const row = await prisma().user.findUnique({
        where: { id: user.userId },
        select: { menuLayoutJson: true },
      })

      const parsed = menuLayoutSchema.safeParse(row?.menuLayoutJson ?? { entries: [] })
      // A layout we cannot read is one nobody can fix from the interface, so it
      // falls back to what everybody else with this role gets, not to an error.
      const personal = parsed.success ? parsed.data.entries : []

      /*
        Which role's default applies. The interface draws one role at a time
        and says which; without that, the most privileged one held in the
        center being looked at, which is what the menu itself is drawn from.
      */
      const role = query.role ?? activeRole(request)
      const fallback = await menuDefaultFor(prisma(), role)

      return {
        // What to draw: their own arrangement, or the role's starting point.
        entries: personal.length > 0 ? personal : fallback,
        // Whether the first of those is what happened, so the screen can offer
        // to put the default back only when there is something to put back.
        personalised: personal.length > 0,
      }
    },
  )

  app.put('/api/v1/me/menu', async (request) => {
    const user = requireUser(request)
    const input = parseWith(menuLayoutSchema, request.body)

    await prisma().user.update({
      where: { id: user.userId },
      data: { menuLayoutJson: toJson(input) },
    })

    return input
  })
}
