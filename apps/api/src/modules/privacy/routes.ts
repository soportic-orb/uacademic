/**
 * What a person may ask about their own data, and who may act on it.
 *
 * Exporting is theirs: it is their data, and asking permission to read it
 * would be the wrong shape. Erasing is not, and deliberately so — a teacher
 * who erases themselves in the middle of a semester would take their own
 * timetable's author with them. So they request it, the request is recorded
 * and audited, and the center's administration carries it out.
 */
import { PROCESSING_ACTIVITIES, parseCenterSettings } from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'
import { erasePersonalData, exportPersonalData } from '../../services/privacy.js'

const ADMINS = ['SUPERADMIN', 'CENTER_ADMIN'] as const

export function registerPrivacyRoutes(app: FastifyInstance): void {
  /**
   * Everything held about the caller, as a file they can keep. Downloaded
   * rather than rendered: this is a document for them, not a screen for us.
   */
  app.get('/api/v1/me/export', async (request, reply) => {
    const user = requireUser(request)
    const data = await exportPersonalData(prisma(), user.userId)

    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="uacademic-personal-data-${user.userId.slice(0, 8)}.json"`,
      )
      .header('cache-control', 'private, no-store')
      .send(JSON.stringify(data, null, 2))
  })

  /**
   * The request itself. It changes nothing yet; it starts a conversation with
   * a person who can weigh what erasing an account in week nine would do.
   */
  app.post('/api/v1/me/erasure-request', async (request) => {
    const user = requireUser(request)
    const centerId = user.memberships[0]?.centerId ?? null

    await writeAuditLog(prisma(), {
      centerId,
      userId: user.userId,
      entity: 'user',
      entityId: user.userId,
      action: 'request_erasure',
      before: null,
      after: { requestedAt: new Date().toISOString() },
      source: 'user',
      ip: request.ip,
    })

    return { requested: true }
  })

  /** The register an institution has to be able to produce (GDPR art. 30). */
  app.get('/api/v1/privacy/processing', async (request) => {
    const { centerId } = requireCenterScope(request)
    const center = await prisma().center.findUnique({ where: { id: centerId } })
    const privacy = parseCenterSettings(center?.settingsJson).privacy

    return {
      activities: PROCESSING_ACTIVITIES.map((activity) => ({
        ...activity,
        retentionDays: activity.retentionKey ? (privacy[activity.retentionKey] as number) : null,
      })),
      contact: privacy.dataProtectionContact,
    }
  })

  /**
   * Carrying out an erasure. The administration's, and audited as theirs: a
   * record that says who decided is part of what makes it lawful.
   */
  app.post(
    '/api/v1/admin/users/:id/erase',
    { config: { roles: [...ADMINS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const actor = requireUser(request)
      const { centerId } = requireCenterScope(request)

      // Only somebody who belongs to this center, so an administrator cannot
      // reach across the platform through this door (R2).
      const membership = await prisma().userCenterRole.findFirst({
        where: { userId: request.params.id, centerId },
      })
      if (!membership) throw AppError.notFound()

      return erasePersonalData(prisma(), {
        userId: request.params.id,
        requestedBy: actor.userId,
        ip: request.ip,
      })
    },
  )
}
