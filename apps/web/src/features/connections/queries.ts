/**
 * Server state for the calendar connections screen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

export interface Latency {
  minMinutes: number
  maxMinutes: number
  clientControlled: boolean
}

export interface ProviderStatus {
  provider: 'microsoft' | 'google'
  configured: boolean
  connected: boolean
  status: 'active' | 'expired' | 'revoked' | 'error' | null
  calendarName: string | null
  lastSyncAt: string | null
  lastBusySyncAt: string | null
  lastError: string | null
  busySyncEnabled: boolean
  consentVersion: number | null
  latency: Latency
}

export interface ConnectionsDto {
  consentVersion: number
  providers: ProviderStatus[]
  consents: { scope: string; version: number; grantedAt: string }[]
  icsLatency: { apple: Latency; outlook: Latency; google: Latency }
}

export interface FeedFilters {
  academicYearId?: string | null
  subjectId?: string | null
  includeColleagues?: boolean
}

export interface FeedStatus {
  active: boolean
  id: string | null
  createdAt: string | null
  lastFetchedAt: string | null
  filters: FeedFilters
  latency: { apple: Latency; outlook: Latency; google: Latency }
}

export function useConnections() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['connections', mockUserEmail],
    queryFn: () => apiFetch<ConnectionsDto>('/api/v1/calendar/connections'),
  })
}

export function useFeed() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['calendar-feed', mockUserEmail],
    queryFn: () => apiFetch<FeedStatus>('/api/v1/calendar/feed'),
  })
}

export function useCreateFeed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (filters: FeedFilters) =>
      apiJson<{ id: string; url: string; filters: FeedFilters }>(
        '/api/v1/calendar/feed',
        'POST',
        filters,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-feed'] }),
  })
}

export function useSaveFilters(feedId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (filters: FeedFilters) =>
      apiJson<{ filters: FeedFilters }>(`/api/v1/calendar/feed/${feedId}`, 'PATCH', filters),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-feed'] }),
  })
}

export function useRevokeFeed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/calendar/feed/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-feed'] }),
  })
}

/** Consent is a full-page trip to the provider, so this only fetches the URL. */
export function useAuthorize() {
  return useMutation({
    mutationFn: (provider: string) =>
      apiJson<{ url: string }>(`/api/v1/calendar/connections/${provider}/authorize`, 'POST', {}),
  })
}

export function useDisconnect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { provider: string; deleteRemote: boolean }) =>
      apiFetch<{ remoteDeleted: boolean }>(
        `/api/v1/calendar/connections/${input.provider}?deleteRemote=${input.deleteRemote}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  })
}

export function useSyncNow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (provider: string) =>
      apiJson<{ queued: boolean }>(`/api/v1/calendar/connections/${provider}/sync`, 'POST', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  })
}

export function useToggleBusySync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { provider: string; enabled: boolean }) =>
      apiJson<{ busySyncEnabled: boolean }>(
        `/api/v1/calendar/connections/${input.provider}`,
        'PATCH',
        { busySyncEnabled: input.enabled },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  })
}
