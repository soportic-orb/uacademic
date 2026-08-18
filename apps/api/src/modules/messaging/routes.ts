/**
 * Messaging: direct conversations, the automatic group per subject, the
 * center channel and the read-only announcements.
 *
 * Who may read and who may post is decided by the pure rules in
 * `@uacademic/shared`, so the API and the UI cannot disagree about what an
 * announcement channel is. Delivery is Server-Sent Events (CLAUDE.md §2 —
 * WebSockets may be blocked on the target host), and the same events are
 * available through the polling endpoint for clients that cannot hold a
 * stream open.
 */
import {
  type ConversationSummary,
  canManageMembers,
  canPost,
  canRead,
  isReadByAll,
  sortConversations,
  unreadCount,
  validateAttachments,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { toJson } from '../../lib/json.js'
import { type PrismaClient, prisma } from '../../lib/prisma.js'
import { type RealtimeTransport, userChannel } from '../../lib/realtime.js'
import { parseWith } from '../../lib/validate.js'
import { notify } from '../../services/notify.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

const createSchema = z
  .object({
    type: z.enum(['direct', 'group']),
    /** For a direct conversation: the other person. */
    userId: z.uuid().optional(),
    title: z.string().trim().max(200).optional(),
    memberIds: z.array(z.uuid()).max(100).default([]),
  })
  .refine((input) => input.type !== 'direct' || Boolean(input.userId), {
    message: 'validation.required',
    path: ['userId'],
  })

const messageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1),
        fileName: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int(),
      }),
    )
    .max(5)
    .default([]),
})

const searchSchema = z.object({
  q: z.string().trim().min(2).max(200),
})

interface AttachmentMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export function registerMessagingRoutes(app: FastifyInstance, bus: RealtimeTransport): void {
  app.get('/api/v1/conversations', async (request) => {
    const user = requireUser(request)
    const { centerId, db } = requireCenterScope(request)

    await ensureStandingConversations(db, centerId, user.userId)

    const memberships = await db.conversationMember.findMany({
      where: { userId: user.userId },
      include: {
        conversation: {
          include: {
            subject: { select: { code: true, nameCa: true } },
            members: {
              include: { user: { select: { id: true, firstName: true, lastName: true } } },
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 30,
              select: { createdAt: true, senderId: true, body: true },
            },
          },
        },
      },
    })

    const summaries: (ConversationSummary & {
      lastMessage: string | null
      members: { id: string; name: string }[]
      canPost: boolean
    })[] = memberships.map((membership) => {
      const conversation = membership.conversation
      const roles = rolesIn(user, centerId)

      return {
        id: conversation.id,
        type: conversation.type,
        title: titleOf(conversation, user.userId),
        subjectCode: conversation.subject?.code ?? null,
        lastMessageAt: conversation.messages[0]?.createdAt ?? null,
        lastMessage: conversation.messages[0]?.body ?? null,
        unread: unreadCount(conversation.messages, {
          userId: user.userId,
          lastReadAt: membership.lastReadAt,
        }),
        members: conversation.members.map((member) => ({
          id: member.user.id,
          name: `${member.user.firstName} ${member.user.lastName}`,
        })),
        canPost: canPost({ type: conversation.type, isMember: true, roles }),
      }
    })

    return { items: sortConversations(summaries) as typeof summaries }
  })

  app.post('/api/v1/conversations', async (request, reply) => {
    const user = requireUser(request)
    const { centerId, db } = requireCenterScope(request)
    const input = parseWith(createSchema, request.body)

    if (input.type === 'direct' && input.userId) {
      const existing = await findDirect(db, user.userId, input.userId)
      if (existing) return reply.code(200).send({ id: existing })
    }

    const members = [
      ...new Set([user.userId, ...(input.userId ? [input.userId] : []), ...input.memberIds]),
    ]

    const conversation = await db.conversation.create({
      data: {
        centerId,
        type: input.type,
        title: input.title ?? null,
        members: { create: members.map((userId) => ({ userId })) },
      },
    })

    return reply.code(201).send({ id: conversation.id })
  })

  app.get(
    '/api/v1/conversations/:id/messages',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { before?: string } }>,
    ) => {
      const user = requireUser(request)
      const { centerId, db } = requireCenterScope(request)
      const conversation = await requireMembership(db, request.params.id, user.userId, centerId)

      const messages = await db.message.findMany({
        where: {
          conversationId: conversation.id,
          deletedAt: null,
          ...(request.query.before ? { createdAt: { lt: new Date(request.query.before) } } : {}),
        },
        include: { sender: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      const members = await db.conversationMember.findMany({
        where: { conversationId: conversation.id },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      })

      return {
        id: conversation.id,
        type: conversation.type,
        title: titleOf(conversation, user.userId),
        canPost: canPost({
          type: conversation.type,
          isMember: true,
          roles: rolesIn(user, centerId),
        }),
        canManageMembers: canManageMembers({
          type: conversation.type,
          isMember: true,
          roles: rolesIn(user, centerId),
        }),
        members: members.map((member) => ({
          id: member.user.id,
          name: `${member.user.firstName} ${member.user.lastName}`,
          lastReadAt: member.lastReadAt?.toISOString() ?? null,
        })),
        items: messages
          .map((message) => ({
            id: message.id,
            body: message.body,
            senderId: message.senderId,
            senderName: `${message.sender.firstName} ${message.sender.lastName}`,
            createdAt: message.createdAt.toISOString(),
            attachments: readAttachments(message.attachmentsJson),
            // The tick a sender looks for: everybody else has caught up.
            readByAll: isReadByAll(message, members),
          }))
          .reverse(),
      }
    },
  )

  app.post(
    '/api/v1/conversations/:id/messages',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = requireUser(request)
      const { centerId, db } = requireCenterScope(request)
      const conversation = await requireMembership(db, request.params.id, user.userId, centerId)
      const input = parseWith(messageSchema, request.body)

      if (!canPost({ type: conversation.type, isMember: true, roles: rolesIn(user, centerId) })) {
        throw AppError.forbidden()
      }

      const check = validateAttachments(input.attachments)
      if (!check.ok) {
        throw AppError.validation(
          check.rejections.map((rejection) => ({
            path: 'attachments',
            messageKey: `messages.attachments.${rejection.reason}`,
          })),
        )
      }

      const message = await db.message.create({
        data: {
          centerId,
          conversationId: conversation.id,
          senderId: user.userId,
          body: input.body,
          attachmentsJson: input.attachments.length > 0 ? toJson(input.attachments) : undefined,
        },
      })

      // The sender has obviously read their own message.
      await db.conversationMember.update({
        where: { conversationId_userId: { conversationId: conversation.id, userId: user.userId } },
        data: { lastReadAt: new Date() },
      })

      const payload = {
        conversationId: conversation.id,
        messageId: message.id,
        senderId: user.userId,
        senderName: `${user.firstName} ${user.lastName}`,
        body: input.body,
        createdAt: message.createdAt.toISOString(),
      }

      const members = await db.conversationMember.findMany({
        where: { conversationId: conversation.id, NOT: { userId: user.userId } },
        select: { userId: true },
      })

      // Realtime for whoever is looking, a notification for whoever is not.
      // Only the members' own channels: a message body has no business on the
      // center-wide channel, which everybody in the center is subscribed to.
      bus.publish(userChannel(user.userId), 'message', payload)
      for (const member of members) bus.publish(userChannel(member.userId), 'message', payload)

      await notify({
        client: prisma(),
        bus,
        centerId,
        event: conversation.type === 'announcement' ? 'message.announcement' : 'message.received',
        url: `/messages/${conversation.id}`,
        recipients: members.map((member) => ({ userId: member.userId })),
        params: {
          sender: `${user.firstName} ${user.lastName}`,
          conversation: titleOf(conversation, user.userId) ?? '',
        },
      })

      return reply.code(201).send({ id: message.id })
    },
  )

  app.post(
    '/api/v1/conversations/:id/read',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = requireUser(request)
      const { centerId, db } = requireCenterScope(request)
      await requireMembership(db, request.params.id, user.userId, centerId)

      await db.conversationMember.update({
        where: {
          conversationId_userId: { conversationId: request.params.id, userId: user.userId },
        },
        data: { lastReadAt: new Date() },
      })

      return reply.code(204).send()
    },
  )

  /** Full-text search across the conversations the caller belongs to. */
  app.get('/api/v1/messages/search', async (request) => {
    const user = requireUser(request)
    const { centerId, db } = requireCenterScope(request)
    const query = parseWith(searchSchema, request.query)

    const memberships = await db.conversationMember.findMany({
      where: { userId: user.userId },
      select: { conversationId: true },
    })
    const conversationIds = memberships.map((membership) => membership.conversationId)
    if (conversationIds.length === 0) return { items: [] }

    const messages = await db.message.findMany({
      where: {
        centerId,
        conversationId: { in: conversationIds },
        deletedAt: null,
        body: { search: query.q },
      },
      include: {
        sender: { select: { firstName: true, lastName: true } },
        conversation: { select: { id: true, type: true, title: true } },
      },
      take: 50,
    })

    return {
      items: messages.map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        conversationTitle: message.conversation.title,
        body: message.body,
        senderName: `${message.sender.firstName} ${message.sender.lastName}`,
        createdAt: message.createdAt.toISOString(),
      })),
    }
  })

  registerAttachmentRoutes(app)
}

function registerAttachmentRoutes(app: FastifyInstance): void {
  /** Upload first, then send the message that references the file. */
  app.post(
    '/api/v1/conversations/:id/attachments',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = requireUser(request)
      const { centerId, db } = requireCenterScope(request)
      await requireMembership(db, request.params.id, user.userId, centerId)

      const file = await request.file()
      if (!file) throw AppError.validation([{ path: 'file', messageKey: 'validation.required' }])

      const buffer = await file.toBuffer()
      const meta: AttachmentMeta = {
        id: randomUUID(),
        fileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: buffer.byteLength,
      }

      const check = validateAttachments([meta])
      if (!check.ok) {
        throw AppError.validation(
          check.rejections.map((rejection) => ({
            path: 'file',
            messageKey: `messages.attachments.${rejection.reason}`,
          })),
        )
      }

      const path = attachmentPath(centerId, meta.id)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, buffer)

      return reply.code(201).send(meta)
    },
  )

  /**
   * Downloads are authorised by the message the file travels with: being able
   * to guess an id is not the same as being in the conversation.
   */
  app.get(
    '/api/v1/attachments/:attachmentId',
    async (request: FastifyRequest<{ Params: { attachmentId: string } }>, reply) => {
      const user = requireUser(request)
      const { centerId, db } = requireCenterScope(request)

      const messages = await db.message.findMany({
        where: {
          centerId,
          deletedAt: null,
          conversation: { members: { some: { userId: user.userId } } },
          attachmentsJson: { not: undefined },
        },
        select: { attachmentsJson: true },
        take: 500,
        orderBy: { createdAt: 'desc' },
      })

      const meta = messages
        .flatMap((message) => readAttachments(message.attachmentsJson))
        .find((attachment) => attachment.id === request.params.attachmentId)
      if (!meta) throw AppError.notFound()

      const path = attachmentPath(centerId, meta.id)
      const exists = await stat(path).catch(() => null)
      if (!exists) throw AppError.notFound()

      return reply
        .header('content-type', meta.mimeType)
        .header(
          'content-disposition',
          `attachment; filename="${encodeURIComponent(meta.fileName)}"`,
        )
        .send(createReadStream(path))
    },
  )
}

function attachmentPath(centerId: string, attachmentId: string): string {
  // Both segments are server-generated ids, so nothing user-supplied ever
  // reaches the filesystem path.
  return join(resolve(env().UPLOAD_DIR), centerId, attachmentId)
}

function readAttachments(value: unknown): AttachmentMeta[] {
  return Array.isArray(value) ? (value as AttachmentMeta[]) : []
}

function rolesIn(user: ReturnType<typeof requireUser>, centerId: string) {
  return user.memberships
    .filter((membership) => membership.centerId === centerId)
    .map((membership) => membership.role)
}

interface ConversationRow {
  id: string
  type: 'direct' | 'group' | 'subject' | 'announcement'
  title: string | null
  members?: { user: { id: string; firstName: string; lastName: string } }[]
  subject?: { code: string; nameCa: string } | null
}

function titleOf(conversation: ConversationRow, viewerId: string): string | null {
  if (conversation.title) return conversation.title
  if (conversation.subject) return `${conversation.subject.code} · ${conversation.subject.nameCa}`
  if (conversation.type === 'direct') {
    const other = conversation.members?.find((member) => member.user.id !== viewerId)
    return other ? `${other.user.firstName} ${other.user.lastName}` : null
  }
  return null
}

async function requireMembership(
  db: PrismaClient,
  conversationId: string,
  userId: string,
  centerId: string,
) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, centerId },
    include: {
      members: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      subject: { select: { code: true, nameCa: true } },
    },
  })
  if (!conversation) throw AppError.notFound()

  const isMember = conversation.members.some((member) => member.user.id === userId)
  if (!canRead({ type: conversation.type, isMember, roles: [] })) throw AppError.forbidden()

  return conversation
}

async function findDirect(
  db: PrismaClient,
  userId: string,
  otherId: string,
): Promise<string | null> {
  const conversations = await db.conversation.findMany({
    where: {
      type: 'direct',
      AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }],
    },
    select: { id: true },
  })
  return conversations[0]?.id ?? null
}

/**
 * The conversations nobody creates by hand: the center announcement channel,
 * and one group per subject the person teaches or coordinates. Created on
 * demand — a center with no messaging never accumulates empty threads.
 */
async function ensureStandingConversations(
  db: PrismaClient,
  centerId: string,
  userId: string,
): Promise<void> {
  const announcement =
    (await db.conversation.findFirst({ where: { centerId, type: 'announcement' } })) ??
    (await db.conversation.create({
      data: { centerId, type: 'announcement', title: null },
    }))

  await db.conversationMember.upsert({
    where: { conversationId_userId: { conversationId: announcement.id, userId } },
    create: { conversationId: announcement.id, userId },
    update: {},
  })

  const subjects = await db.subject.findMany({
    where: {
      OR: [
        { coordinators: { some: { userId } } },
        { groups: { some: { assignments: { some: { teacherProfile: { userId } } } } } },
      ],
    },
    select: { id: true },
  })

  for (const subject of subjects) {
    const conversation =
      (await db.conversation.findFirst({
        where: { centerId, type: 'subject', subjectId: subject.id },
      })) ??
      (await db.conversation.create({
        data: { centerId, type: 'subject', subjectId: subject.id },
      }))

    await db.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      create: { conversationId: conversation.id, userId },
      update: {},
    })
  }
}
