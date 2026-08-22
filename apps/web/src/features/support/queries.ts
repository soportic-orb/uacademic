/**
 * Cady's client side.
 *
 * Same shape as the coordination assistant's: our own API, Server-Sent Events
 * over a POST, and no key in the browser. Separate from it because the two
 * answer to different people and carry different things — this one has no
 * proposals, no citations and no budget.
 */
import type { Role } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { currentLocale } from '../../i18n'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'
import { API_BASE_URL } from '../../lib/api-base'
import { useSessionStore } from '../../stores/session'

const MOCK_AUTH = import.meta.env.VITE_UACADEMIC_AUTH_MODE === 'mock'

export interface SupportStatus {
  available: boolean
  configured: boolean
  enabled: boolean
  name: string
  role: Role
}

export type SupportStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; conversationId: string; messageId: string; covered: boolean }
  | { type: 'error'; messageKey: string }

export interface SupportConversationSummary {
  id: string
  title: string
  lastMessageAt: string
}

export interface SupportConversationDetail {
  id: string
  title: string
  messages: {
    id: string
    role: 'user' | 'assistant'
    content: string
    helpful: boolean | null
    createdAt: string
  }[]
}

export function useSupportStatus() {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['support-status', centerId, mockUserEmail],
    queryFn: () => apiFetch<SupportStatus>('/api/v1/support/status'),
    staleTime: 60_000,
    retry: false,
  })
}

export function useSupportConversations(enabled: boolean) {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['support-conversations', mockUserEmail],
    queryFn: () =>
      apiFetch<{ items: SupportConversationSummary[] }>('/api/v1/support/conversations'),
    enabled,
    retry: false,
  })
}

export function useSupportConversation(id: string | null) {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['support-conversation', mockUserEmail, id],
    queryFn: () => apiFetch<SupportConversationDetail>(`/api/v1/support/conversations/${id}`),
    enabled: Boolean(id),
    retry: false,
  })
}

export function useSupportFeedback() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { messageId: string; helpful: boolean }) =>
      apiJson(`/api/v1/support/messages/${input.messageId}/feedback`, 'POST', {
        helpful: input.helpful,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-conversation'] }),
  })
}

export interface AskCadyInput {
  question: string
  conversationId?: string | undefined
  /** The screen the person is looking at, so "why is this empty" has a this. */
  path?: string | undefined
  onEvent: (event: SupportStreamEvent) => void
  signal?: AbortSignal
}

export async function askCady(input: AskCadyInput): Promise<void> {
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

  const response = await fetch(`${API_BASE_URL}/api/v1/support/ask`, {
    method: 'POST',
    credentials: 'include',
    headers,
    ...(input.signal ? { signal: input.signal } : {}),
    body: JSON.stringify({
      question: input.question,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.path ? { path: input.path } : {}),
    }),
  })

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code: string; message: string }
    } | null
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? 'support.errors.failed',
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      try {
        input.onEvent(JSON.parse(line.slice(5).trim()) as SupportStreamEvent)
      } catch {
        // A frame we cannot parse is not worth taking the chat down for.
      }
    }
  }
}

/* ─────────────────── the platform administrator's half ─────────────────── */

export interface SupportSettingsDto {
  enabled: boolean
  maxOutputTokens: number
  historyMessages: number
  configured: boolean
}

export function useSupportSettings() {
  return useQuery({
    queryKey: ['support-settings'],
    queryFn: () => apiFetch<SupportSettingsDto>('/api/v1/support/settings'),
    retry: false,
  })
}

export function useSaveSupportSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (values: Partial<Omit<SupportSettingsDto, 'configured'>>) =>
      apiJson<SupportSettingsDto>('/api/v1/support/settings', 'PATCH', values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['support-settings'] }),
        // The floating button appears or disappears on the strength of this.
        queryClient.invalidateQueries({ queryKey: ['support-status'] }),
      ])
    },
  })
}

export interface AdminConversation {
  id: string
  title: string
  role: Role
  locale: string
  centerName: string | null
  userName: string
  lastMessageAt: string
  uncovered: boolean
  unhelpful: boolean
  messages: {
    id: string
    role: 'user' | 'assistant'
    content: string
    covered: boolean
    helpful: boolean | null
    createdAt: string
  }[]
}

export function useAdminConversations(uncoveredOnly: boolean) {
  return useQuery({
    queryKey: ['support-admin-conversations', uncoveredOnly],
    queryFn: () =>
      apiFetch<{ items: AdminConversation[] }>(
        `/api/v1/support/admin/conversations${uncoveredOnly ? '?uncoveredOnly=true' : ''}`,
      ),
    retry: false,
  })
}

export interface SupportArticleDto {
  id: string
  slug: string
  roles: Role[]
  enabled: boolean
  content: Record<'ca' | 'es' | 'en', { title: string; body: string }>
  updatedAt: string
}

export function useSupportArticles() {
  return useQuery({
    queryKey: ['support-articles'],
    queryFn: () => apiFetch<{ items: SupportArticleDto[] }>('/api/v1/support/articles'),
    retry: false,
  })
}

export function useSaveSupportArticle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id?: string; values: Record<string, unknown> }) =>
      apiJson<{ id: string }>(
        input.id ? `/api/v1/support/articles/${input.id}` : '/api/v1/support/articles',
        input.id ? 'PATCH' : 'POST',
        input.values,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-articles'] }),
  })
}

export function useDeleteSupportArticle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiJson(`/api/v1/support/articles/${id}`, 'DELETE', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-articles'] }),
  })
}
