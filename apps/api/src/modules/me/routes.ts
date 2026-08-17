import type { CurrentUser } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

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
}
