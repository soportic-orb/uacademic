/**
 * The agent loop.
 *
 * Claude reads with the read tools, which run here against a tenant-scoped
 * client; when it reaches for a write tool the result is a **proposal**, saved
 * as a pending row and handed to the UI to render — never executed (R5). The
 * loop stops when Claude has nothing left to call, when the center's tool
 * budget for one answer runs out, or when the center's monthly token budget
 * does.
 *
 * Everything it spends is recorded in `ai_interactions` (tokens in and out),
 * because "the assistant is expensive" has to be answerable with a number.
 */
import type Anthropic from '@anthropic-ai/sdk'
import {
  AI_TOOLS,
  type AiProposal,
  type Citation,
  budgetStatus,
  isWriteTool,
  minimizeForModel,
} from '@uacademic/shared'
import { z } from 'zod'

import { toJson } from '../../lib/json.js'
import { prisma } from '../../lib/prisma.js'
import { anthropic, assistantAvailable, assistantModel } from './client.js'
import { attachmentBlock } from './attachments.js'
import { buildDocumentContext, extractCitations } from './documents.js'
import type { AiContext } from './context.js'
import { systemPrompt } from './context.js'
import { readTools } from './tools/read.js'
import { writeTools } from './tools/write.js'

export type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; kind: 'read' | 'write' }
  | {
      type: 'documents'
      strategy: 'none' | 'injected' | 'retrieved'
      items: { documentId: string; title: string; scope: string }[]
    }
  | { type: 'citations'; items: Citation[] }
  | { type: 'proposal'; proposalId: string; proposal: AiProposal }
  | { type: 'usage'; tokensIn: number; tokensOut: number; budgetPercent: number }
  | { type: 'done'; messageId: string; conversationId: string }
  | { type: 'error'; messageKey: string }

/** The tool list, as the API wants it: JSON Schema derived from the shared Zod. */
export function toolDefinitions(): Anthropic.Tool[] {
  return AI_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.schema, { io: 'input' }) as Anthropic.Tool['input_schema'],
  }))
}

export interface AskInput {
  context: AiContext
  conversationId: string
  question: string
  /** Called for every event; the route turns them into SSE frames. */
  emit: (event: AiStreamEvent) => void
}

export interface AskResult {
  answer: string
  tokensIn: number
  tokensOut: number
  proposals: string[]
  /** The documents that actually fed this answer (R4: `documents_used_json`). */
  documents: { documentId: string; title: string; scope: string; chunkIds: string[] }[]
  citations: Citation[]
}

/** Tokens this center has spent since the first of the month. */
export async function monthlyTokens(centerId: string): Promise<number> {
  const from = new Date()
  from.setUTCDate(1)
  from.setUTCHours(0, 0, 0, 0)

  const totals = await prisma().aiInteraction.aggregate({
    where: { centerId, createdAt: { gte: from } },
    _sum: { tokensIn: true, tokensOut: true },
  })

  return (totals._sum.tokensIn ?? 0) + (totals._sum.tokensOut ?? 0)
}

export async function assistantStatus(context: AiContext) {
  const used = await monthlyTokens(context.centerId)
  const settings = context.settings.ai

  return {
    available: assistantAvailable() && settings.enabled,
    configured: assistantAvailable(),
    enabled: settings.enabled,
    model: assistantModel(),
    budget: budgetStatus(used, settings.monthlyTokenBudget, settings.alertThresholdPercent),
  }
}

/**
 * One question, answered.
 *
 * The transcript is replayed from the stored conversation so a follow-up
 * ("and Joan?") means what it should, and the answer is streamed as it is
 * produced — a coordinator watching a blank panel for twenty seconds assumes
 * it is broken.
 */
export async function ask(input: AskInput): Promise<AskResult> {
  const { context, emit } = input
  const settings = context.settings.ai

  const used = await monthlyTokens(context.centerId)
  const budget = budgetStatus(used, settings.monthlyTokenBudget, settings.alertThresholdPercent)
  if (budget.level === 'exceeded') {
    emit({ type: 'error', messageKey: 'assistant.errors.budgetExceeded' })
    throw new Error('AI budget exceeded')
  }

  // The center's own documents, either whole (with a cache breakpoint) or
  // retrieved, depending on how much of them there is.
  const documents = await buildDocumentContext(context, input.question)
  if (documents.used.length > 0) {
    emit({
      type: 'documents',
      strategy: documents.strategy,
      items: documents.used.map((entry) => ({
        documentId: entry.documentId,
        title: entry.title,
        scope: entry.scope,
      })),
    })
  }

  // Whatever was attached to this conversation, ahead of the transcript: the
  // question is almost always about it.
  const attachments = await attachmentBlock(prisma(), input.conversationId)

  const history = await prisma().aiMessage.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { createdAt: 'asc' },
    take: 40,
  })

  const messages: Anthropic.MessageParam[] = [
    // The documents lead, and stay byte-identical between questions about the
    // same subject: that prefix is what the cache is keyed on.
    ...(documents.blocks.length > 0 ? [{ role: 'user' as const, content: documents.blocks }] : []),
    ...(attachments ? [{ role: 'user' as const, content: attachments }] : []),
    ...history.map((message) => ({
      role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: message.content,
    })),
    { role: 'user' as const, content: input.question },
  ]

  const client = anthropic()
  const tools = toolDefinitions()
  const proposals: string[] = []

  let answer = ''
  let tokensIn = 0
  let tokensOut = 0

  for (let iteration = 0; iteration < settings.maxToolIterations; iteration += 1) {
    const stream = client.messages.stream({
      model: assistantModel(),
      max_tokens: settings.maxOutputTokens,
      system: systemPrompt(context),
      // Adaptive thinking: the hard questions here — why a slot is illegal,
      // how to rebalance a department — are exactly what it is for.
      thinking: { type: 'adaptive' },
      tools,
      messages,
    })

    stream.on('text', (delta) => {
      answer += delta
      emit({ type: 'text', text: delta })
    })

    const message = await stream.finalMessage()
    tokensIn += message.usage.input_tokens
    tokensOut += message.usage.output_tokens

    if (message.stop_reason !== 'tool_use') {
      messages.push({ role: 'assistant', content: message.content })
      break
    }

    messages.push({ role: 'assistant', content: message.content })

    const calls = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )

    const results: Anthropic.ToolResultBlockParam[] = []

    for (const call of calls) {
      emit({ type: 'tool', name: call.name, kind: isWriteTool(call.name) ? 'write' : 'read' })

      try {
        if (isWriteTool(call.name)) {
          const build = writeTools[call.name]
          if (!build) throw new Error(`Unknown write tool ${call.name}`)

          const proposal = await build(context, call.input as Record<string, never>)

          // R5: the proposal is stored pending and shown; nothing is applied.
          const stored = await prisma().aiProposal.create({
            data: {
              centerId: context.centerId,
              conversationId: input.conversationId,
              userId: context.userId,
              tool: call.name,
              inputJson: toJson(call.input),
              previewJson: toJson(proposal),
              status: 'pending',
              expiresAt: new Date(Date.now() + 24 * 3600_000),
            },
          })

          proposals.push(stored.id)
          emit({ type: 'proposal', proposalId: stored.id, proposal })

          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify({
              proposalId: stored.id,
              status: 'pending_human_confirmation',
              summary: proposal.summary,
              changes: proposal.changes.length,
              violations: proposal.violations.length,
            }),
          })
          continue
        }

        const run = readTools[call.name]
        if (!run) throw new Error(`Unknown tool ${call.name}`)

        const data = await run(context, call.input as Record<string, never>)
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(minimizeForModel(data)).slice(0, 60_000),
        })
      } catch (error) {
        // A failing tool is reported back to the model, not thrown at the
        // user: it can usually recover by asking differently.
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: error instanceof Error ? error.message : 'tool failed',
        })
      }
    }

    messages.push({ role: 'user', content: results })
  }

  const citations = extractCitations(answer, documents.used)
  if (citations.length > 0) emit({ type: 'citations', items: citations })

  return {
    answer,
    tokensIn,
    tokensOut,
    proposals,
    documents: documents.used,
    citations,
  }
}

/**
 * Records what one question cost, and what it touched. `ai_interactions` is
 * what makes the monthly budget answerable and the usage explainable.
 */
export async function recordInteraction(input: {
  centerId: string
  userId: string
  question: string
  answer: string
  tools: string[]
  documents?: { documentId: string; title: string; chunkIds: string[] }[]
  tokensIn: number
  tokensOut: number
}): Promise<void> {
  await prisma().aiInteraction.create({
    data: {
      centerId: input.centerId,
      userId: input.userId,
      prompt: input.question.slice(0, 5_000),
      response: input.answer.slice(0, 20_000),
      toolsUsedJson: toJson(input.tools),
      // R4/phase 5B: which documents fed this answer, by id and by fragment,
      // so a normative answer can be reconstructed a year later.
      documentsUsedJson: toJson(input.documents ?? []),
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      actionExecuted: false,
    },
  })
}
