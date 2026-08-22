import type { CurrentUser } from '@uacademic/shared'
import { menuLayoutSchema } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { toJson } from '../../lib/json.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireUser } from '../../plugins/context.js'

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
   * The order somebody keeps their own menu in.
   *
   * On the account rather than in the browser: it is a thing a person sat down
   * and arranged, and re-arranging it on the office machine because they first
   * did it at home is not a preference, it is losing their work. It carries no
   * permission — what the menu may contain is still decided by the roles, on
   * every request (R3) — so this is theirs to write with no further check.
   */
  app.get('/api/v1/me/menu', async (request) => {
    const user = requireUser(request)
    const row = await prisma().user.findUnique({
      where: { id: user.userId },
      select: { menuLayoutJson: true },
    })

    const parsed = menuLayoutSchema.safeParse(row?.menuLayoutJson ?? { entries: [] })
    // A layout we cannot read is one nobody can fix from the interface, so it
    // falls back to the product's own order rather than to an error.
    return parsed.success ? parsed.data : { entries: [] }
  })

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
