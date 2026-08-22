/**
 * Server state for phase 4: change requests, absences, messaging,
 * notifications and the audit log.
 *
 * Mutations invalidate what the change can be seen in — accepting a request
 * changes the request, the notification bell and, once applied, the timetable.
 */
import type { Violation } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

export interface ChangeRequestDto {
  id: string
  type: string
  status: string
  reason: string | null
  createdAt: string
  expiresAt: string | null
  appliedAt: string | null
  requesterId: string
  requesterName: string
  targetUserId: string | null
  targetName: string | null
  proposal: Record<string, unknown>
  session: {
    id: string
    weekday: number
    startTime: string
    endTime: string
    label: string
    subjectName: string
  } | null
  actions: string[]
  actors?: string[]
  violations?: Violation[]
}

export interface AbsenceDto {
  id: string
  teacherProfileId: string
  teacherName: string
  substituteProfileId: string | null
  substituteName: string | null
  dateFrom: string
  dateTo: string
  type: string
  status: string
  reason: string | null
  sessions?: AffectedSessionDto[]
}

export interface AffectedSessionDto {
  id: string
  weekday: number
  startTime: string
  endTime: string
  label: string
  subjectName: string
  spaceName: string | null
}

export interface SubstituteDto {
  teacherProfileId: string
  name: string
  eligible: boolean
  score: number
  blockers: string[]
  reasons: { messageKey: string; params: Record<string, string | number> }[]
}

export interface ConversationDto {
  id: string
  type: 'direct' | 'group' | 'subject' | 'announcement'
  title: string | null
  subjectCode?: string | null
  lastMessageAt: string | null
  lastMessage: string | null
  unread: number
  canPost: boolean
  members: { id: string; name: string }[]
}

export interface MessageDto {
  id: string
  body: string
  senderId: string
  senderName: string
  senderAvatarUrl: string | null
  createdAt: string
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[]
  readByAll: boolean
}

export interface ThreadDto {
  id: string
  type: ConversationDto['type']
  title: string | null
  canPost: boolean
  canManageMembers: boolean
  members: { id: string; name: string; lastReadAt: string | null }[]
  items: MessageDto[]
}

export interface NotificationDto {
  id: string
  type: string
  payload: { title?: string; body?: string; url?: string | null }
  readAt: string | null
  createdAt: string
}

export interface PreferenceDto {
  event: string
  inApp: boolean
  push: boolean
  email: boolean
  digest: boolean
  priority: 'high' | 'normal' | 'low'
  mandatory: string[]
}

export interface AuditEntryDto {
  id: string
  entity: string
  entityId: string
  action: string
  source: 'user' | 'ai' | 'system'
  userId: string | null
  userName: string | null
  userEmail: string | null
  ip: string | null
  before: unknown
  after: unknown
  createdAt: string
}

function useRequestContext() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const centerId = useSessionStore((state) => state.centerId)
  return { mockUserEmail, centerId }
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all(
      [
        'changes',
        'absences',
        'conversations',
        'thread',
        'notifications',
        'planner-version',
        // Approving a change or an absence is exactly when the badge on the
        // menu should come down.
        'pending-counts',
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    )
  }
}

export function useChanges(scope: 'all' | 'mine' | 'open') {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['changes', context.mockUserEmail, context.centerId, scope],
    queryFn: () => apiFetch<{ items: ChangeRequestDto[] }>(`/api/v1/changes?scope=${scope}`),
    enabled: Boolean(context.centerId),
  })
}

export function useChange(id: string | null) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['changes', 'detail', context.mockUserEmail, context.centerId, id],
    queryFn: () => apiFetch<ChangeRequestDto>(`/api/v1/changes/${id}`),
    enabled: Boolean(context.centerId) && Boolean(id),
  })
}

export function useTransition(id: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (action: string) =>
      apiJson<ChangeRequestDto>(`/api/v1/changes/${id}/transition`, 'POST', { action }),
    onSuccess: invalidate,
  })
}

export function useCreateChange() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiJson<ChangeRequestDto>('/api/v1/changes', 'POST', input),
    onSuccess: invalidate,
  })
}

export function useAbsences() {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['absences', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<{ items: AbsenceDto[]; canManage: boolean }>('/api/v1/absences'),
    enabled: Boolean(context.centerId),
  })
}

export function useAbsenceSessions(absenceId: string | null) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['absences', 'sessions', context.mockUserEmail, absenceId],
    queryFn: () =>
      apiFetch<{ items: AffectedSessionDto[] }>(`/api/v1/absences/${absenceId}/sessions`),
    enabled: Boolean(absenceId),
  })
}

export function useCandidates(absenceId: string | null, sessionId: string | null) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['absences', 'candidates', context.mockUserEmail, absenceId, sessionId],
    queryFn: () =>
      apiFetch<{ sessionId: string; items: SubstituteDto[] }>(
        `/api/v1/absences/${absenceId}/candidates?sessionId=${sessionId}`,
      ),
    enabled: Boolean(absenceId) && Boolean(sessionId),
  })
}

export function useReportAbsence() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiJson<AbsenceDto>('/api/v1/absences', 'POST', input),
    onSuccess: invalidate,
  })
}

export function useAskSubstitute(absenceId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: { sessionId: string; teacherProfileId: string }) =>
      apiJson<AbsenceDto & { changeRequestId: string }>(
        `/api/v1/absences/${absenceId}/substitute`,
        'POST',
        input,
      ),
    onSuccess: invalidate,
  })
}

export function useConversations() {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['conversations', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<{ items: ConversationDto[] }>('/api/v1/conversations'),
    enabled: Boolean(context.centerId),
  })
}

export function useThread(conversationId: string | null) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['thread', context.mockUserEmail, conversationId],
    queryFn: () => apiFetch<ThreadDto>(`/api/v1/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
  })
}

export function useSendMessage(conversationId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: { body: string; attachments?: MessageDto['attachments'] }) =>
      apiJson<{ id: string }>(`/api/v1/conversations/${conversationId}/messages`, 'POST', input),
    onSuccess: invalidate,
  })
}

export function useMarkRead() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch(`/api/v1/conversations/${conversationId}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  })
}

export function useMessageSearch(query: string) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['messages-search', context.mockUserEmail, query],
    queryFn: () =>
      apiFetch<{
        items: {
          id: string
          conversationId: string
          conversationTitle: string | null
          body: string
          senderName: string
          createdAt: string
        }[]
      }>(`/api/v1/messages/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
  })
}

export function useNotifications(unreadOnly = false) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['notifications', context.mockUserEmail, unreadOnly],
    queryFn: () =>
      apiFetch<{ unread: number; items: NotificationDto[] }>(
        `/api/v1/notifications?unreadOnly=${unreadOnly}`,
      ),
    // The bell also updates itself from the realtime channel; this is the
    // floor, not the mechanism.
    refetchInterval: 60_000,
  })
}

export function useReadNotification() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (id: string | 'all') =>
      apiFetch(
        id === 'all' ? '/api/v1/notifications/read-all' : `/api/v1/notifications/${id}/read`,
        {
          method: 'POST',
        },
      ),
    onSuccess: invalidate,
  })
}

export function usePreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () =>
      apiFetch<{
        push: { available: boolean; publicKey: string | null }
        items: PreferenceDto[]
      }>('/api/v1/notifications/preferences'),
  })
}

export function useSavePreferences() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (items: PreferenceDto[]) =>
      apiJson<{ updated: number }>('/api/v1/notifications/preferences', 'PUT', { items }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
  })
}

export interface AuditQuery {
  entity?: string
  source?: string
  userId?: string
  from?: string
  to?: string
  page?: number
}

export function useAudit(query: AuditQuery) {
  const context = useRequestContext()
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) search.set(key, String(value))
  }

  return useQuery({
    queryKey: ['audit', context.mockUserEmail, context.centerId, search.toString()],
    queryFn: () =>
      apiFetch<{
        page: number
        pageSize: number
        total: number
        totalPages: number
        entities: { entity: string; count: number }[]
        items: AuditEntryDto[]
      }>(`/api/v1/audit?${search.toString()}`),
    enabled: Boolean(context.centerId),
  })
}
