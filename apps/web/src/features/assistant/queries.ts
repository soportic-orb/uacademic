/**
 * The assistant's client side.
 *
 * It talks to our own API and nothing else — the Anthropic key lives on the
 * server, and the browser never sees it. The answer arrives as Server-Sent
 * Events over a POST, so it is read with `fetch` and a stream reader rather
 * than `EventSource`, which cannot POST and cannot carry our headers.
 */
import type { Citation } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { currentLocale } from '../../i18n'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

const BASE_URL = import.meta.env.VITE_UACADEMIC_API_URL ?? 'http://localhost:3001'
const MOCK_AUTH = import.meta.env.VITE_UACADEMIC_AUTH_MODE === 'mock'

export interface ProposalChange {
  entity: 'class_session' | 'assignment' | 'message'
  entityId: string | null
  label: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface AiProposal {
  tool: string
  summary: string
  changes: ProposalChange[]
  violations: { messageKey: string; params: Record<string, string | number> }[]
  warnings: { messageKey: string; params: Record<string, string | number> }[]
}

export interface AssistantStatus {
  available: boolean
  configured: boolean
  enabled: boolean
  model: string
  budget: {
    usedTokens: number
    budgetTokens: number
    percent: number
    level: 'ok' | 'warning' | 'exceeded'
  }
}

export interface DocumentSource {
  documentId: string
  title: string
  scope: string
}

export type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; kind: 'read' | 'write' }
  | {
      type: 'documents'
      /** Whole documents in the prompt, or the fragments retrieval picked. */
      strategy: 'none' | 'injected' | 'retrieved'
      items: DocumentSource[]
    }
  | { type: 'citations'; items: Citation[] }
  | { type: 'proposal'; proposalId: string; proposal: AiProposal }
  | { type: 'usage'; tokensIn: number; tokensOut: number; budgetPercent: number }
  | { type: 'done'; messageId: string; conversationId: string }
  | { type: 'error'; messageKey: string }

export interface ConversationSummary {
  id: string
  title: string | null
  subjectId: string | null
  subjectCode: string | null
  lastMessageAt: string
}

export function useAssistantStatus() {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['ai-status', centerId, mockUserEmail],
    queryFn: () => apiFetch<AssistantStatus>('/api/v1/ai/status'),
    enabled: Boolean(centerId),
    // A key that appears, a budget that moves: worth re-reading now and then,
    // never worth hammering.
    staleTime: 60_000,
    retry: false,
  })
}

export function useConversations(subjectId?: string | null) {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['ai-conversations', centerId, mockUserEmail, subjectId ?? null],
    queryFn: () =>
      apiFetch<{ items: ConversationSummary[] }>(
        `/api/v1/ai/conversations${subjectId ? `?subjectId=${subjectId}` : ''}`,
      ),
    enabled: Boolean(centerId),
    retry: false,
  })
}

export interface ConversationDetail {
  id: string
  title: string | null
  subjectId: string | null
  messages: {
    id: string
    role: 'user' | 'assistant'
    content: string
    citations: Citation[]
    createdAt: string
  }[]
  proposals: {
    id: string
    tool: string
    status: 'pending' | 'confirmed' | 'rejected' | 'expired' | 'failed'
    preview: AiProposal
    createdAt: string
  }[]
}

export function useConversation(id: string | null) {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['ai-conversation', mockUserEmail, id],
    queryFn: () => apiFetch<ConversationDetail>(`/api/v1/ai/conversations/${id}`),
    enabled: Boolean(id),
    retry: false,
  })
}

export interface AskInput {
  question: string
  conversationId?: string | undefined
  subjectId?: string | null
  onEvent: (event: AiStreamEvent) => void
  signal?: AbortSignal
}

/**
 * Asks, and reports every frame as it arrives.
 *
 * Streaming is not decoration: a question that reads three tools takes
 * seconds, and a panel that shows nothing for all of them reads as broken.
 */
export async function askAssistant(input: AskInput): Promise<void> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'accept-language': currentLocale(),
  })

  const centerId = useSessionStore.getState().centerId
  if (centerId) headers.set('x-center-id', centerId)
  if (MOCK_AUTH) {
    const mockUserEmail = useSessionStore.getState().mockUserEmail
    if (mockUserEmail) headers.set('x-mock-user', mockUserEmail)
  }

  const response = await fetch(`${BASE_URL}/api/v1/ai/ask`, {
    method: 'POST',
    credentials: 'include',
    headers,
    ...(input.signal ? { signal: input.signal } : {}),
    body: JSON.stringify({
      question: input.question,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    }),
  })

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code: string; message: string }
    } | null
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? 'assistant.errors.failed',
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Frames are separated by a blank line; a partial one waits for the rest.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      try {
        input.onEvent(JSON.parse(line.slice(5).trim()) as AiStreamEvent)
      } catch {
        // A frame we cannot parse is not worth taking the panel down for.
      }
    }
  }
}

export function useResolveProposal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id: string; action: 'confirm' | 'reject' }) =>
      apiJson<{ status: string; applied?: number }>(
        `/api/v1/ai/proposals/${input.id}/${input.action}`,
        'POST',
        {},
      ),
    onSuccess: async () => {
      // A confirmed proposal changed the timetable: everything that draws it
      // is now stale.
      await Promise.all(
        ['ai-conversation', 'planner-version', 'calendar', 'teachers', 'changes'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
  })
}
