/**
 * Answering one support question.
 *
 * No tools, no data, no proposals. The corpus goes in whole, the question goes
 * in after it, and what comes back is text — which is the entire reason this
 * is a different module from the coordination assistant rather than a mode of
 * it. There is nothing here that could reach a center's timetable.
 */
import {
  type AppLocale,
  type Role,
  type SupportArticleEntry,
  cadySystemPrompt,
  splitCoverage,
  stripPartialMarker,
  supportCorpus,
} from '@uacademic/shared'

import { anthropic, assistantAvailable, assistantModel } from '../ai/client.js'
import type { SupportSettings } from '../../services/support-settings.js'

export type SupportStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; conversationId: string; messageId: string; covered: boolean }
  | { type: 'error'; messageKey: string }

export interface SupportContext {
  userId: string
  userName: string
  role: Role
  locale: AppLocale
  centerId: string | null
  centerName: string | null
}

export interface AnswerInput {
  context: SupportContext
  settings: SupportSettings
  articles: readonly SupportArticleEntry[]
  history: readonly { role: 'user' | 'assistant'; content: string }[]
  question: string
  emit: (event: SupportStreamEvent) => void
}

export interface AnswerResult {
  text: string
  covered: boolean
  tokensIn: number
  tokensOut: number
}

export function supportAvailable(settings: SupportSettings): boolean {
  return settings.enabled && assistantAvailable()
}

/**
 * The articles as the domain wants them, from the rows as the database keeps
 * them. A row whose stored JSON has drifted is dropped rather than crashing
 * the chat: one bad article must not take the assistant down.
 */
export function toArticleEntries(
  rows: readonly { slug: string; rolesJson: unknown; contentJson: unknown; enabled: boolean }[],
): SupportArticleEntry[] {
  const entries: SupportArticleEntry[] = []

  for (const row of rows) {
    const roles = Array.isArray(row.rolesJson) ? (row.rolesJson as Role[]) : []
    const content = row.contentJson as SupportArticleEntry['content'] | null
    if (roles.length === 0 || !content?.ca || !content.es || !content.en) continue

    entries.push({ slug: row.slug, roles, enabled: row.enabled, content })
  }

  return entries
}

export async function answer(input: AnswerInput): Promise<AnswerResult> {
  const corpus = supportCorpus({
    role: input.context.role,
    locale: input.context.locale,
    articles: input.articles,
  })

  const stream = anthropic().messages.stream({
    model: assistantModel(),
    max_tokens: input.settings.maxOutputTokens,
    system: cadySystemPrompt({
      role: input.context.role,
      locale: input.context.locale,
      userName: input.context.userName,
      centerName: input.context.centerName,
      corpus,
    }),
    messages: [
      ...input.history.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user' as const, content: input.question },
    ],
  })

  // Emitted as it arrives, with anything that could still turn into the
  // coverage marker held back until the next chunk says what it was.
  let raw = ''
  let sent = 0

  stream.on('text', (delta) => {
    raw += delta
    const visible = visibleLength(raw)
    if (visible > sent) {
      input.emit({ type: 'text', text: raw.slice(sent, visible) })
      sent = visible
    }
  })

  const message = await stream.finalMessage()
  const { text, covered } = splitCoverage(raw)

  // Whatever the streaming held back, the stored answer is the whole of it.
  if (text.length > sent) input.emit({ type: 'text', text: text.slice(sent) })

  return {
    text,
    covered,
    tokensIn: message.usage.input_tokens,
    tokensOut: message.usage.output_tokens,
  }
}

/** How much of what has arrived can be shown without leaking half a marker. */
function visibleLength(raw: string): number {
  return stripPartialMarker(raw).length
}
