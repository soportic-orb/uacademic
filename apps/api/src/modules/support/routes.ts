/**
 * Cady's HTTP surface.
 *
 * Open to every role, because everybody using the platform has questions about
 * it — which is the difference from `/api/v1/ai`, coordination's tool, closed
 * to everybody else.
 *
 * Two audiences, two halves. Anybody signed in may ask, and read their own
 * conversations and nobody else's. The platform administrator switches her on
 * and off, reads every conversation, and writes the help articles she answers
 * from — which is the loop: what people asked, what she could not answer, and
 * the article that fixes it.
 */
import {
  type AppLocale,
  type Role,
  isAppLocale,
  supportArticleInputSchema,
  supportArticleUpdateSchema,
  supportAskSchema,
  supportFeedbackSchema,
  supportSettingsInputSchema,
  supportTitle,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { toJson } from '../../lib/json.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireUser } from '../../plugins/context.js'
import {
  setSupportSettings,
  supportSettings as readSupportSettings,
} from '../../services/support-settings.js'
import { assistantAvailable } from '../ai/client.js'
import {
  type SupportContext,
  type SupportStreamEvent,
  answer,
  supportAvailable,
  toArticleEntries,
} from './service.js'

const EVERYBODY = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'] as const
const SUPERADMIN = ['SUPERADMIN'] as const

/**
 * Who is asking, from the session alone.
 *
 * Deliberately not the coordination assistant's context, which loads the
 * academic year and refuses a center that has none — the very moment somebody
 * most needs to ask why their dashboard is empty.
 */
function supportContext(request: FastifyRequest): SupportContext {
  const user = requireUser(request)
  const centerId = request.centerId ?? null

  const held = user.memberships.filter(
    (membership) => !centerId || membership.centerId === centerId,
  )
  // The most privileged role held here decides which guide she reads from; a
  // person who coordinates and teaches asks a coordinator's questions.
  const order: Role[] = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER']
  const role = order.find((candidate) => held.some((m) => m.role === candidate)) ?? 'TEACHER'

  return {
    userId: user.userId,
    userName: `${user.firstName} ${user.lastName}`.trim(),
    role,
    locale: (isAppLocale(user.locale) ? user.locale : 'ca') as AppLocale,
    centerId,
    centerName: centerId ? (user.centerNames.get(centerId)?.name ?? null) : null,
  }
}

export function registerSupportRoutes(app: FastifyInstance): void {
  /**
   * Whether the button should be there at all.
   *
   * A floating button that opens onto "the assistant is not configured" is
   * worse than no button, so the shell asks first and draws nothing when the
   * answer is no.
   */
  app.get('/api/v1/support/status', { config: { roles: [...EVERYBODY] } }, async (request) => {
    const settings = await readSupportSettings(prisma())
    const context = supportContext(request)

    return {
      available: supportAvailable(settings),
      configured: assistantAvailable(),
      enabled: settings.enabled,
      name: 'Cady',
      role: context.role,
    }
  })

  /** Somebody's own conversations with her, most recent first. */
  app.get(
    '/api/v1/support/conversations',
    { config: { roles: [...EVERYBODY] } },
    async (request) => {
      const user = requireUser(request)

      const rows = await prisma().supportConversation.findMany({
        where: { userId: user.userId },
        orderBy: { lastMessageAt: 'desc' },
        take: 30,
      })

      return {
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          lastMessageAt: row.lastMessageAt.toISOString(),
        })),
      }
    },
  )

  app.get(
    '/api/v1/support/conversations/:id',
    { config: { roles: [...EVERYBODY] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const user = requireUser(request)

      const conversation = await prisma().supportConversation.findFirst({
        // Their own, and nobody else's: reading a colleague's support chat is
        // reading what they could not work out on their own.
        where: { id: request.params.id, userId: user.userId },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
      })
      if (!conversation) throw AppError.notFound()

      return {
        id: conversation.id,
        title: conversation.title,
        messages: conversation.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          helpful: message.helpful,
          createdAt: message.createdAt.toISOString(),
        })),
      }
    },
  )

  /** One question, streamed as it is written. */
  app.post('/api/v1/support/ask', { config: { roles: [...EVERYBODY] } }, async (request, reply) => {
    const input = parseWith(supportAskSchema, request.body)
    const context = supportContext(request)
    const settings = await readSupportSettings(prisma())

    if (!supportAvailable(settings)) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'support.errors.unavailable')
    }

    const conversation = input.conversationId
      ? await prisma().supportConversation.findFirst({
          where: { id: input.conversationId, userId: context.userId },
        })
      : await prisma().supportConversation.create({
          data: {
            centerId: context.centerId,
            userId: context.userId,
            role: context.role,
            locale: context.locale,
            title: supportTitle(input.question),
          },
        })

    if (!conversation) throw AppError.notFound()

    const [history, articles] = await Promise.all([
      prisma().supportMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: settings.historyMessages,
      }),
      prisma().supportArticle.findMany({ where: { enabled: true }, orderBy: { slug: 'asc' } }),
    ])

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (event: SupportStreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      const result = await answer({
        context,
        settings,
        articles: toArticleEntries(articles),
        history: history
          .slice()
          .reverse()
          .map((message) => ({
            role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: message.content,
          })),
        question: input.question,
        emit: send,
      })

      const stored = await prisma().$transaction([
        prisma().supportMessage.create({
          data: { conversationId: conversation.id, role: 'user', content: input.question },
        }),
        prisma().supportMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: result.text,
            // False is a question the help does not answer, which is the list
            // the platform administrator writes the next article from.
            covered: result.covered,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          },
        }),
        prisma().supportConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        }),
      ])

      send({
        type: 'done',
        conversationId: conversation.id,
        messageId: stored[1].id,
        covered: result.covered,
      })
    } catch (error) {
      request.log.error({ err: error }, 'support assistant failed')
      send({ type: 'error', messageKey: 'support.errors.failed' })
    } finally {
      reply.raw.end()
    }

    return reply
  })

  /** The reader's own verdict on an answer. */
  app.post(
    '/api/v1/support/messages/:id/feedback',
    { config: { roles: [...EVERYBODY] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const user = requireUser(request)
      const input = parseWith(supportFeedbackSchema, request.body)

      const message = await prisma().supportMessage.findFirst({
        where: { id: request.params.id, conversation: { userId: user.userId } },
      })
      if (!message || message.role !== 'assistant') throw AppError.notFound()

      await prisma().supportMessage.update({
        where: { id: message.id },
        data: { helpful: input.helpful },
      })

      return { id: message.id, helpful: input.helpful }
    },
  )

  registerAdminRoutes(app)
}

/* ─────────────────── the platform administrator's half ─────────────────── */

function registerAdminRoutes(app: FastifyInstance): void {
  app.get('/api/v1/support/settings', { config: { roles: [...SUPERADMIN] } }, async () => ({
    ...(await readSupportSettings(prisma())),
    configured: assistantAvailable(),
  }))

  app.patch('/api/v1/support/settings', { config: { roles: [...SUPERADMIN] } }, async (request) => {
    const actor = requireUser(request)
    const input = parseWith(supportSettingsInputSchema, request.body)

    const settings = await setSupportSettings(prisma(), input, actor.userId)

    await writeAuditLog(prisma(), {
      centerId: null,
      userId: actor.userId,
      entity: 'platform_settings',
      entityId: 'support',
      action: 'update',
      after: settings,
      source: 'user',
      ip: request.ip,
    })

    return { ...settings, configured: assistantAvailable() }
  })

  /**
   * Every conversation on the installation.
   *
   * The one place in the product that reads across centers on purpose, and it
   * is the role that is allowed to (R2). It exists so the help can be written
   * from what people actually ask rather than from what somebody imagined they
   * would.
   */
  app.get(
    '/api/v1/support/admin/conversations',
    { config: { roles: [...SUPERADMIN] } },
    async (request) => {
      const query = parseWith(
        z.object({
          /** Only the ones she could not answer: the list to write from. */
          uncoveredOnly: z.coerce.boolean().optional(),
          role: z.enum(['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER']).optional(),
          take: z.coerce.number().int().min(1).max(200).default(50),
        }),
        request.query,
      )

      const rows = await prisma().supportConversation.findMany({
        where: {
          ...(query.role ? { role: query.role } : {}),
          ...(query.uncoveredOnly
            ? { messages: { some: { role: 'assistant', covered: false } } }
            : {}),
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          center: { select: { name: true } },
          messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: query.take,
      })

      return {
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          role: row.role,
          locale: row.locale,
          centerName: row.center?.name ?? null,
          userName: `${row.user.firstName} ${row.user.lastName}`.trim(),
          lastMessageAt: row.lastMessageAt.toISOString(),
          uncovered: row.messages.some(
            (message) => message.role === 'assistant' && !message.covered,
          ),
          unhelpful: row.messages.some((message) => message.helpful === false),
          messages: row.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            covered: message.covered,
            helpful: message.helpful,
            createdAt: message.createdAt.toISOString(),
          })),
        })),
      }
    },
  )

  app.get('/api/v1/support/articles', { config: { roles: [...SUPERADMIN] } }, async () => {
    const rows = await prisma().supportArticle.findMany({ orderBy: { slug: 'asc' } })

    return {
      items: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        roles: row.rolesJson,
        enabled: row.enabled,
        content: row.contentJson,
        updatedAt: row.updatedAt.toISOString(),
      })),
    }
  })

  app.post('/api/v1/support/articles', { config: { roles: [...SUPERADMIN] } }, async (request) => {
    const actor = requireUser(request)
    const input = parseWith(supportArticleInputSchema, request.body)

    const existing = await prisma().supportArticle.findUnique({ where: { slug: input.slug } })
    if (existing) throw new AppError(409, 'CONFLICT', 'support.errors.slugTaken')

    const created = await prisma().supportArticle.create({
      data: {
        slug: input.slug,
        rolesJson: toJson(input.roles),
        contentJson: toJson(input.content),
        enabled: input.enabled,
        updatedBy: actor.userId,
      },
    })

    await writeAuditLog(prisma(), {
      centerId: null,
      userId: actor.userId,
      entity: 'support_articles',
      entityId: created.id,
      action: 'create',
      after: { slug: created.slug, roles: input.roles, enabled: created.enabled },
      source: 'user',
      ip: request.ip,
    })

    return { id: created.id, slug: created.slug }
  })

  app.patch(
    '/api/v1/support/articles/:id',
    { config: { roles: [...SUPERADMIN] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const actor = requireUser(request)
      const input = parseWith(supportArticleUpdateSchema, request.body)

      const article = await prisma().supportArticle.findUnique({
        where: { id: request.params.id },
      })
      if (!article) throw AppError.notFound()

      const updated = await prisma().supportArticle.update({
        where: { id: article.id },
        data: {
          ...(input.slug ? { slug: input.slug } : {}),
          ...(input.roles ? { rolesJson: toJson(input.roles) } : {}),
          ...(input.content ? { contentJson: toJson(input.content) } : {}),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          updatedBy: actor.userId,
        },
      })

      await writeAuditLog(prisma(), {
        centerId: null,
        userId: actor.userId,
        entity: 'support_articles',
        entityId: updated.id,
        action: 'update',
        before: { slug: article.slug, enabled: article.enabled },
        after: { slug: updated.slug, enabled: updated.enabled },
        source: 'user',
        ip: request.ip,
      })

      return { id: updated.id, slug: updated.slug }
    },
  )

  app.delete(
    '/api/v1/support/articles/:id',
    { config: { roles: [...SUPERADMIN] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const actor = requireUser(request)

      const article = await prisma().supportArticle.findUnique({
        where: { id: request.params.id },
      })
      if (!article) throw AppError.notFound()

      await prisma().supportArticle.delete({ where: { id: article.id } })

      await writeAuditLog(prisma(), {
        centerId: null,
        userId: actor.userId,
        entity: 'support_articles',
        entityId: article.id,
        action: 'delete',
        before: { slug: article.slug },
        source: 'user',
        ip: request.ip,
      })

      return reply.status(204).send()
    },
  )
}
