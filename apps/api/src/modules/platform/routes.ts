/**
 * The platform panel: what is installed, what is available, and the button.
 *
 * SUPERADMIN only, and not by convention — this is the one role that crosses
 * centers, and an update touches every one of them at once.
 */
import { SUPPORTED_LOCALES, localeSchema, menuDefaultsSchema, translate } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { writeAuditLog } from '../../lib/audit.js'
import { enqueueJob } from '../../jobs/worker.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireUser } from '../../plugins/context.js'
import { mailConfigured, sendMail } from '../../services/mailer.js'
import {
  enabledLocales,
  menuDefaults,
  setEnabledLocales,
  setMenuDefaults,
} from '../../services/platform-settings.js'
import {
  latestRelease,
  releaseIsAlreadyRunning,
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
  /**
   * Which languages the platform offers.
   *
   * Switching one off hides it from the pickers; it does not remove the
   * translations, which always carry all three (R1). That distinction is what
   * keeps a screen from falling back to raw keys the moment somebody's stored
   * preference points at a language that has been turned off.
   */
  app.get('/api/v1/platform/locales', { config: { roles: [...SUPERADMIN] } }, async () => ({
    available: [...SUPPORTED_LOCALES],
    enabled: await enabledLocales(prisma()),
  }))

  app.put('/api/v1/platform/locales', { config: { roles: [...SUPERADMIN] } }, async (request) => {
    const actor = requireUser(request)
    const body = parseWith(z.object({ locales: z.array(localeSchema).min(1) }), request.body)

    const enabled = await setEnabledLocales(prisma(), body.locales, actor.userId)

    await writeAuditLog(prisma(), {
      centerId: null,
      userId: actor.userId,
      entity: 'platform_settings',
      entityId: 'enabledLocales',
      action: 'update',
      after: { enabled },
      source: 'user',
      ip: request.ip,
    })

    return { available: [...SUPPORTED_LOCALES], enabled }
  })

  /**
   * The menu each of the three center roles starts with.
   *
   * Set once for the installation, and a starting point rather than a rule:
   * anybody may arrange their own afterwards, and somebody who has keeps
   * theirs when this changes. That is the whole reason it is a *default* and
   * not a layout imposed on everybody — a menu somebody sat down and arranged
   * must not be rewritten under them by an administrator tidying up.
   */
  app.get('/api/v1/platform/menu-defaults', { config: { roles: [...SUPERADMIN] } }, async () => ({
    defaults: await menuDefaults(prisma()),
  }))

  app.put(
    '/api/v1/platform/menu-defaults',
    { config: { roles: [...SUPERADMIN] } },
    async (request) => {
      const actor = requireUser(request)
      const body = parseWith(menuDefaultsSchema, request.body)

      const defaults = await setMenuDefaults(prisma(), body.defaults, actor.userId)

      await writeAuditLog(prisma(), {
        centerId: null,
        userId: actor.userId,
        entity: 'platform_settings',
        entityId: 'menuDefaults',
        action: 'update',
        after: defaults,
        source: 'user',
        ip: request.ip,
      })

      return { defaults }
    },
  )

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

    if (releaseIsAlreadyRunning(release.version)) {
      throw new AppError(409, 'CONFLICT', 'platform.errors.sameRelease')
    }

    const running = await prisma().appVersion.findFirst({ where: { status: 'applying' } })
    if (running) {
      throw new AppError(409, 'CONFLICT', 'platform.errors.alreadyRunning')
    }

    // Handed to the worker rather than run here, and that is the whole
    // point: the last step of an update is `pm2 reload uacademic`, and this
    // process *is* uacademic. Running it inline meant asking the process
    // manager to kill the procedure halfway through — which it did, taking
    // the `pm2` child with it and leaving "pm2 exited with null" as the
    // explanation. The worker is a separate app; the reload goes straight
    // past it.
    await enqueueJob(prisma(), 'platform.update', {
      release,
      userId: user.userId,
      ip: request.ip,
    })

    return { queued: true, version: release.version }
  })
}
