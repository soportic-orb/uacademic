/**
 * The assistant's HTTP surface.
 *
 * The browser talks only to these routes; the Anthropic API is reached from
 * the server and nowhere else. Only coordination gets in — the assistant is a
 * coordination tool, and the role is checked here as well as in the UI.
 *
 * The answer is streamed as Server-Sent Events rather than returned whole: a
 * question that reads three tools takes seconds, and a panel that shows
 * nothing for all of them looks broken.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { assistantAvailable } from './client.js'
import { buildAiContext } from './context.js'
import { executeProposal } from './execute.js'
import {
  type AiStreamEvent,
  ask,
  assistantStatus,
  monthlyTokens,
  recordInteraction,
} from './service.js'

const COORDINATION = ['COORDINATOR', 'CENTER_ADMIN'] as const

const askSchema = z.object({
  question: z.string().trim().min(2).max(4_000),
  conversationId: z.uuid().optional(),
  /** What the panel is looking at, so "this subject" means something. */
  subjectId: z.uuid().nullable().optional(),
})

export function registerAiRoutes(app: FastifyInstance): void {
  /**
   * Whether the assistant can answer at all, and how much of the month's
   * budget is left. The panel asks before it renders: no key, no panel — and
   * every other screen carries on exactly as before.
   */
  app.get('/api/v1/ai/status', { config: { roles: [...COORDINATION] } }, async (request) => {
    const context = await buildAiContext(request)
    return assistantStatus(context)
  })

  app.get('/api/v1/ai/conversations', { config: { roles: [...COORDINATION] } }, async (request) => {
    const context = await buildAiContext(request)
    const query = parseWith(z.object({ subjectId: z.uuid().optional() }), request.query)

    const rows = await prisma().aiConversation.findMany({
      where: {
        centerId: context.centerId,
        userId: context.userId,
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      },
      include: { subject: { select: { code: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
    })

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        subjectId: row.subjectId,
        subjectCode: row.subject?.code ?? null,
        lastMessageAt: row.lastMessageAt.toISOString(),
      })),
    }
  })

  app.get(
    '/api/v1/ai/conversations/:id',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await buildAiContext(request)

      const conversation = await prisma().aiConversation.findFirst({
        where: { id: request.params.id, centerId: context.centerId, userId: context.userId },
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 200 },
          proposals: { orderBy: { createdAt: 'asc' } },
        },
      })
      if (!conversation) throw AppError.notFound()

      return {
        id: conversation.id,
        title: conversation.title,
        subjectId: conversation.subjectId,
        messages: conversation.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
        proposals: conversation.proposals.map((proposal) => ({
          id: proposal.id,
          tool: proposal.tool,
          status: proposal.status,
          preview: proposal.previewJson,
          createdAt: proposal.createdAt.toISOString(),
        })),
      }
    },
  )

  /** One question, streamed. */
  app.post('/api/v1/ai/ask', { config: { roles: [...COORDINATION] } }, async (request, reply) => {
    const input = parseWith(askSchema, request.body)
    const context = await buildAiContext(request, { subjectId: input.subjectId ?? null })

    if (!assistantAvailable() || !context.settings.ai.enabled) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'assistant.errors.unavailable')
    }

    const conversation = input.conversationId
      ? await prisma().aiConversation.findFirst({
          where: {
            id: input.conversationId,
            centerId: context.centerId,
            userId: context.userId,
          },
        })
      : await prisma().aiConversation.create({
          data: {
            centerId: context.centerId,
            userId: context.userId,
            subjectId: input.subjectId ?? null,
            // The first question is the title: nobody names a conversation.
            title: input.question.slice(0, 120),
          },
        })

    if (!conversation) throw AppError.notFound()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (event: AiStreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const tools: string[] = []

    try {
      const result = await ask({
        context,
        conversationId: conversation.id,
        question: input.question,
        emit: (event) => {
          if (event.type === 'tool') tools.push(event.name)
          send(event)
        },
      })

      const stored = await prisma().$transaction([
        prisma().aiMessage.create({
          data: { conversationId: conversation.id, role: 'user', content: input.question },
        }),
        prisma().aiMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: result.answer,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          },
        }),
        prisma().aiConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        }),
      ])

      await recordInteraction({
        centerId: context.centerId,
        userId: context.userId,
        question: input.question,
        answer: result.answer,
        tools,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })

      const used = await monthlyTokens(context.centerId)
      const budget = context.settings.ai.monthlyTokenBudget
      send({
        type: 'usage',
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        budgetPercent: budget > 0 ? Math.round((used / budget) * 1000) / 10 : 0,
      })
      send({ type: 'done', messageId: stored[1].id, conversationId: conversation.id })
    } catch (error) {
      request.log.error({ err: error }, 'assistant failed')
      // The panel degrades; nothing else does.
      send({ type: 'error', messageKey: 'assistant.errors.failed' })
    } finally {
      reply.raw.end()
    }

    return reply
  })

  /**
   * R5: this is where a proposal becomes a change — and only here, with a
   * person's explicit confirmation, recorded as `source = 'ai'`.
   */
  app.post(
    '/api/v1/ai/proposals/:id/confirm',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await buildAiContext(request)

      const proposal = await prisma().aiProposal.findFirst({
        where: { id: request.params.id, centerId: context.centerId },
      })
      if (!proposal) throw AppError.notFound()
      if (proposal.status !== 'pending') {
        throw new AppError(409, 'CONFLICT', 'assistant.errors.alreadyResolved')
      }

      // Claimed before it is applied: two clicks cannot apply it twice.
      const claimed = await prisma().aiProposal.updateMany({
        where: { id: proposal.id, status: 'pending' },
        data: { status: 'confirmed', resolvedBy: context.userId, resolvedAt: new Date() },
      })
      if (claimed.count === 0) {
        throw new AppError(409, 'CONFLICT', 'assistant.errors.alreadyResolved')
      }

      try {
        const result = await executeProposal(context, proposal, { ip: request.ip })

        await writeAuditLog(prisma(), {
          centerId: context.centerId,
          userId: context.userId,
          entity: 'ai_proposal',
          entityId: proposal.id,
          action: 'confirm',
          before: { status: 'pending' },
          after: { status: 'confirmed', applied: result.applied, tool: proposal.tool },
          source: 'user',
          ip: request.ip,
        })

        return { status: 'confirmed', ...result }
      } catch (error) {
        await prisma().aiProposal.update({
          where: { id: proposal.id },
          data: {
            status: 'failed',
            error: error instanceof Error ? error.message.slice(0, 1_000) : 'failed',
          },
        })
        throw error
      }
    },
  )

  app.post(
    '/api/v1/ai/proposals/:id/reject',
    { config: { roles: [...COORDINATION] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const context = await buildAiContext(request)

      const rejected = await prisma().aiProposal.updateMany({
        where: { id: request.params.id, centerId: context.centerId, status: 'pending' },
        data: { status: 'rejected', resolvedBy: context.userId, resolvedAt: new Date() },
      })
      if (rejected.count === 0) throw AppError.notFound()

      await writeAuditLog(prisma(), {
        centerId: context.centerId,
        userId: context.userId,
        entity: 'ai_proposal',
        entityId: request.params.id,
        action: 'reject',
        before: { status: 'pending' },
        after: { status: 'rejected' },
        source: 'user',
        ip: request.ip,
      })

      return { status: 'rejected' }
    },
  )
}
