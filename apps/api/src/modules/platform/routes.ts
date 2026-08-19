/**
 * The platform panel: what is installed, what is available, and the button.
 *
 * SUPERADMIN only, and not by convention — this is the one role that crosses
 * centers, and an update touches every one of them at once.
 */
import { translate } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { requireUser } from '../../plugins/context.js'
import { mailConfigured, sendMail } from '../../services/mailer.js'
import {
  applyUpdate,
  latestRelease,
  updateStatus,
  updateWouldTakeEffect,
  updatesConfigured,
} from '../../services/updates.js'

const SUPERADMIN = ['SUPERADMIN'] as const

export function registerPlatformRoutes(app: FastifyInstance): void {
  app.get('/api/v1/platform/version', { config: { roles: [...SUPERADMIN] } }, async () =>
    updateStatus(prisma()),
  )

  /**
   * Can this installation send email, and does it actually work?
   *
   * Two different questions, and the panel used to answer neither. The first
   * is configuration and is free to ask; the second needs a real message to
   * leave the building, so it is a separate, deliberate action.
   */
  app.get('/api/v1/platform/mail', { config: { roles: [...SUPERADMIN] } }, async () => {
    const configuration = env()

    return {
      configured: mailConfigured(),
      // Enough to recognise a wrong server and a wrong account, and no
      // credential. The user is where the mistakes are: a provider that wants
      // the whole address given a bare name, or the sender address given
      // instead of the login, both come back as the same 535.
      host: configuration.SMTP_HOST ?? null,
      port: configuration.SMTP_PORT,
      secure: configuration.SMTP_SECURE,
      user: configuration.SMTP_USER ?? null,
      from: configuration.SMTP_FROM,
    }
  })

  /** Sends one real message, to the person who asked. */
  app.post(
    '/api/v1/platform/mail/test',
    { config: { roles: [...SUPERADMIN] } },
    async (request) => {
      const user = requireUser(request)

      if (!mailConfigured()) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'platform.errors.mailNotConfigured')
      }

      try {
        const result = await sendMail({
          to: user.email,
          locale: user.locale,
          subject: translate(user.locale, 'email.testSubject'),
          blocks: [
            {
              title: translate(user.locale, 'email.testTitle'),
              body: translate(user.locale, 'email.testBody', { host: env().SMTP_HOST ?? '' }),
            },
          ],
        })

        return { ok: true, to: user.email, simulated: result.simulated }
      } catch (error) {
        // The server's own words. An administrator debugging a relay needs
        // "535 authentication failed", not "something went wrong".
        return {
          ok: false,
          to: user.email,
          detail: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        }
      }
    },
  )

  /**
   * Installs the release currently published. Runs inline rather than as a
   * job: the worker is one of the processes being reloaded, and a job that
   * restarts its own runtime halfway through is not a job.
   */
  app.post('/api/v1/platform/update', { config: { roles: [...SUPERADMIN] } }, async (request) => {
    const user = requireUser(request)

    if (!(await updateWouldTakeEffect())) {
      // Checked before anything is downloaded: the alternative is a perfect
      // deployment of code nobody runs, reported as a success.
      throw new AppError(409, 'CONFLICT', 'platform.errors.notLinked')
    }

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
