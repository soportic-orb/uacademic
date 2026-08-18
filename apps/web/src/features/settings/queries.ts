/**
 * Server state for reading a regulation into the configuration.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

export type BlockState = 'pending' | 'running' | 'ready' | 'failed'

export interface BlockStatus {
  state: BlockState
  errorKey?: string
  proposals?: number
}

export interface ExtractionRow {
  id: string
  paramKey: string
  block: string
  proposedValue: unknown
  currentValue: unknown
  unit: string | null
  confidence: 'high' | 'medium' | 'low'
  citation: {
    documentId: string
    page: number | null
    section: string | null
    quote: string
  } | null
  reasoning: string | null
  exceptionNote: string | null
  manualOverride: boolean
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'not_found'
  resolvedValue: unknown
}

export interface RunDetail {
  id: string
  documentId: string
  documentTitle: string
  createdAt: string
  appliedAt: string | null
  blocks: Record<string, BlockStatus>
  rows: ExtractionRow[]
  conflicts: string[]
}

export interface RunSummary {
  id: string
  documentId: string
  documentTitle: string
  createdAt: string
  appliedAt: string | null
}

export function useExtractionRuns() {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['extraction-runs', centerId, mockUserEmail],
    queryFn: () => apiFetch<{ items: RunSummary[] }>('/api/v1/settings/extractions'),
    enabled: Boolean(centerId),
  })
}

export function useExtractionRun(id: string | null) {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['extraction-run', mockUserEmail, id],
    queryFn: () => apiFetch<RunDetail>(`/api/v1/settings/extractions/${id}`),
    enabled: Boolean(id),
    // Eight blocks run in the worker; the wizard watches them arrive.
    refetchInterval: (query) => {
      const data = query.state.data as RunDetail | undefined
      if (!data) return false
      const busy = Object.values(data.blocks).some(
        (block) => block.state === 'pending' || block.state === 'running',
      )
      return busy ? 2_000 : false
    },
  })
}

export function useStartExtraction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (documentId: string) =>
      apiJson<{ runId: string }>('/api/v1/settings/extractions', 'POST', { documentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['extraction-runs'] }),
  })
}

export function useResolveRow(runId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      id: string
      status: 'accepted' | 'edited' | 'rejected' | 'pending'
      value?: unknown
    }) =>
      apiJson<ExtractionRow>(
        `/api/v1/settings/extractions/${runId}/rows/${input.id}`,
        'PATCH',
        input.status === 'edited'
          ? { status: input.status, value: input.value }
          : { status: input.status },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['extraction-run'] }),
  })
}

export function useAcceptHighConfidence(runId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (block: string) =>
      apiJson<{ accepted: number }>(`/api/v1/settings/extractions/${runId}/accept-high`, 'POST', {
        block,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['extraction-run'] }),
  })
}

export interface ApplySummary {
  versionId: string | null
  applied: string[]
  rejected: string[]
  pending: string[]
}

export function useApplyRun(runId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiJson<ApplySummary>(`/api/v1/settings/extractions/${runId}/apply`, 'POST', {}),
    onSuccess: async () => {
      // The configuration changed: everything that reasons with it is stale.
      await Promise.all(
        ['center-settings', 'extraction-run', 'settings-versions', 'planner-version'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
  })
}

export interface ParamProvenance {
  paramKey: string
  value: unknown
  documentId: string | null
  documentTitle: string | null
  page: number | null
  section: string | null
  quote: string | null
  chunkId: string | null
}

/** The reverse link: which article put this number here. */
export function useParamProvenance(paramKey: string | null) {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['param-provenance', centerId, mockUserEmail, paramKey],
    queryFn: () => apiFetch<ParamProvenance>(`/api/v1/settings/provenance/${paramKey}`),
    enabled: Boolean(centerId && paramKey),
    staleTime: 60_000,
    retry: false,
  })
}

export interface SettingsVersion {
  id: string
  createdAt: string
  source: string
  documentTitle: string | null
  approver: string | null
  notes: string | null
  current: boolean
}

export function useSettingsVersions() {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['settings-versions', centerId, mockUserEmail],
    queryFn: () => apiFetch<{ items: SettingsVersion[] }>('/api/v1/settings/versions'),
    enabled: Boolean(centerId),
  })
}

export interface VersionDetail {
  id: string
  createdAt: string
  source: string
  notes: string | null
  changes: { key: string; before: unknown; after: unknown }[]
  provenance: {
    paramKey: string
    documentTitle: string | null
    page: number | null
    section: string | null
    quote: string | null
  }[]
}

export function useSettingsVersion(id: string | null) {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['settings-version', mockUserEmail, id],
    queryFn: () => apiFetch<VersionDetail>(`/api/v1/settings/versions/${id}`),
    enabled: Boolean(id),
  })
}
