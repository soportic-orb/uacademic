/**
 * The platform panel: what is installed, what is available, and the button.
 *
 * SUPERADMIN only, and not by convention — this is the one role that crosses
 * centers, and an update touches every one of them at once.
 */
import type { FastifyInstance } from 'fastify'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { requireUser } from '../../plugins/context.js'
import {
  applyUpdate,
  latestRelease,
  updateStatus,
  updatesConfigured,
} from '../../services/updates.js'

const SUPERADMIN = ['SUPERADMIN'] as const

export function registerPlatformRoutes(app: FastifyInstance): void {
  app.get('/api/v1/platform/version', { config: { roles: [...SUPERADMIN] } }, async () =>
    updateStatus(prisma()),
  )

  /**
   * Installs the release currently published. Runs inline rather than as a
   * job: the worker is one of the processes being reloaded, and a job that
   * restarts its own runtime halfway through is not a job.
   */
  app.post('/api/v1/platform/update', { config: { roles: [...SUPERADMIN] } }, async (request) => {
    const user = requireUser(request)

    if (!updatesConfigured()) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'platform.errors.notConfigured')
    }

    const release = await latestRelease()
    if (!release) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'platform.errors.noRelease')

    const running = await prisma().appVersion.findFirst({ where: { status: 'applying' } })
    if (running) {
      throw new AppError(409, 'CONFLICT', 'platform.errors.alreadyRunning')
    }

    return applyUpdate(prisma(), { release, userId: user.userId, ip: request.ip })
  })
}
