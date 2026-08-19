import { MAX_IMAGE_BYTES, checkImageUpload, isSuperadmin } from '@uacademic/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { requireUser } from '../../plugins/context.js'
import {
  type ImageOwner,
  avatarUrlFor,
  deleteImage,
  readImage,
  storeImage,
  universityLogoUrlFor,
} from '../../services/images.js'

/**
 * Pictures: the photograph a person puts on their own profile, and the logo of
 * a university.
 *
 * They are served from here rather than from a public directory because a
 * photograph of a person is personal data: the route decides who may look
 * before it opens the file. The URL kept in the database is the URL of one of
 * these routes, so the storage layout never leaks into a column.
 */

/** Read the one file out of a multipart request, or say what was wrong with it. */
async function readUpload(request: FastifyRequest): Promise<{ bytes: Buffer; extension: string }> {
  const file = await request.file()
  if (!file) throw AppError.validation([{ path: 'file', messageKey: 'validation.required' }])

  const bytes = await file.toBuffer()
  const check = checkImageUpload({ bytes, maxBytes: MAX_IMAGE_BYTES })
  if (!check.ok) {
    throw AppError.validation([{ path: 'file', messageKey: `images.errors.${check.reason}` }])
  }

  return { bytes, extension: check.kind.extension }
}

async function sendImage(
  reply: FastifyReply,
  owner: ImageOwner,
  ownerId: string,
): Promise<FastifyReply> {
  const image = await readImage(owner, ownerId)
  if (!image) throw AppError.notFound()

  return (
    reply
      .header('content-type', image.mime)
      // Private: it travels with a session cookie and belongs to one person. The
      // URL carries a checksum, so a change is a different URL and the cache
      // never has to be told to forget the old one.
      .header('cache-control', 'private, max-age=86400')
      .send(image.bytes)
  )
}

export function registerMediaRoutes(app: FastifyInstance): void {
  /** Everyone manages their own photograph; nobody manages anybody else's. */
  app.post('/api/v1/me/avatar', async (request) => {
    const user = requireUser(request)
    const { bytes, extension } = await readUpload(request)

    const { version } = await storeImage('avatars', user.userId, bytes, { mime: '', extension })
    const avatarUrl = avatarUrlFor(user.userId, version)
    await prisma().user.update({ where: { id: user.userId }, data: { avatarUrl } })

    await writeAuditLog(prisma(), {
      centerId: null,
      userId: user.userId,
      entity: 'user_avatar',
      entityId: user.userId,
      action: 'update',
      after: { avatarUrl },
      source: 'user',
      ip: request.ip,
    })

    return { avatarUrl }
  })

  app.delete('/api/v1/me/avatar', async (request) => {
    const user = requireUser(request)

    await deleteImage('avatars', user.userId)
    await prisma().user.update({ where: { id: user.userId }, data: { avatarUrl: null } })

    await writeAuditLog(prisma(), {
      centerId: null,
      userId: user.userId,
      entity: 'user_avatar',
      entityId: user.userId,
      action: 'delete',
      before: { avatarUrl: user.avatarUrl },
      source: 'user',
      ip: request.ip,
    })

    return { avatarUrl: null }
  })

  /**
   * A photograph is visible to the people this person actually works with: the
   * centers they share. Anything else would make the route a directory of
   * faces across every institution on the installation (R2).
   */
  app.get('/api/v1/users/:id/avatar', async (request, reply) => {
    const viewer = requireUser(request)
    const { id } = request.params as { id: string }

    if (id !== viewer.userId && !isSuperadmin(viewer)) {
      const shared = await prisma().userCenterRole.findFirst({
        where: {
          userId: id,
          centerId: { in: viewer.memberships.map((membership) => membership.centerId) },
        },
        select: { id: true },
      })
      if (!shared) throw AppError.notFound()
    }

    return sendImage(reply, 'avatars', id)
  })

  /** The logo is the institution's, so it is the platform administrator's. */
  app.post(
    '/api/v1/admin/universities/:id/logo',
    { config: { roles: ['SUPERADMIN'] } },
    async (request) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }

      const university = await prisma().university.findUnique({ where: { id } })
      if (!university) throw AppError.notFound()

      const { bytes, extension } = await readUpload(request)
      const { version } = await storeImage('universities', id, bytes, { mime: '', extension })
      const logoUrl = universityLogoUrlFor(id, version)
      await prisma().university.update({ where: { id }, data: { logoUrl } })

      await writeAuditLog(prisma(), {
        centerId: null,
        userId: user.userId,
        entity: 'university',
        entityId: id,
        action: 'update',
        before: { logoUrl: university.logoUrl },
        after: { logoUrl },
        source: 'user',
        ip: request.ip,
      })

      return { logoUrl }
    },
  )

  app.delete(
    '/api/v1/admin/universities/:id/logo',
    { config: { roles: ['SUPERADMIN'] } },
    async (request) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }

      const university = await prisma().university.findUnique({ where: { id } })
      if (!university) throw AppError.notFound()

      await deleteImage('universities', id)
      await prisma().university.update({ where: { id }, data: { logoUrl: null } })

      await writeAuditLog(prisma(), {
        centerId: null,
        userId: user.userId,
        entity: 'university',
        entityId: id,
        action: 'update',
        before: { logoUrl: university.logoUrl },
        after: { logoUrl: null },
        source: 'user',
        ip: request.ip,
      })

      return { logoUrl: null }
    },
  )

  /** Anyone signed in may see the logo of an institution on this installation. */
  app.get('/api/v1/universities/:id/logo', async (request, reply) => {
    requireUser(request)
    const { id } = request.params as { id: string }

    return sendImage(reply, 'universities', id)
  })
}
