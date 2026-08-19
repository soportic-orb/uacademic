/**
 * Server state for the document library.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson, apiUpload } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

export interface DocumentDto {
  id: string
  title: string
  scope: 'university' | 'center' | 'degree' | 'subject'
  scopeId: string | null
  type: string
  status: 'uploaded' | 'processing' | 'indexed' | 'failed' | 'archived'
  errorKey: string | null
  errorDetail: string | null
  language: string
  visibility: 'ai_only' | 'center'
  academicYearId: string | null
  validFrom: string | null
  validTo: string | null
  sizeBytes: number
  mime: string
  pageCount: number | null
  chunkCount: number | null
  tokenCount: number | null
  extractedWith: string | null
  createdAt: string
  processedAt: string | null
  uploadedBy?: string | null
  expired?: boolean
  expiringSoon?: boolean
}

export interface DocumentListDto {
  items: DocumentDto[]
  quota: { usedBytes: number; quotaBytes: number; maxFileBytes: number }
}

export interface DocumentChunkDto {
  id: string
  ordinal: number
  headingPath: string | null
  pageFrom: number | null
  pageTo: number | null
  content: string
}

export interface DocumentFilters {
  scope?: string
  type?: string
  validity?: 'all' | 'current' | 'expired'
  q?: string
}

export function useDocuments(filters: DocumentFilters = {}) {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, String(value))
  }

  return useQuery({
    queryKey: ['documents', centerId, mockUserEmail, query.toString()],
    queryFn: () => apiFetch<DocumentListDto>(`/api/v1/documents?${query.toString()}`),
    enabled: Boolean(centerId),
  })
}

export function useDocument(id: string | null) {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['document', mockUserEmail, id],
    queryFn: () =>
      apiFetch<DocumentDto & { chunks: DocumentChunkDto[] }>(`/api/v1/documents/${id}`),
    enabled: Boolean(id),
  })
}

export function useUploadDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (form: FormData) => apiUpload<DocumentDto>('/api/v1/documents', form),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  })
}

export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Partial<DocumentDto>) =>
      apiJson<DocumentDto>(`/api/v1/documents/${id}`, 'PATCH', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents'] })
      await queryClient.invalidateQueries({ queryKey: ['document'] })
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  })
}

export function useReprocessDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id: string; useOcr?: boolean }) =>
      apiJson<{ queued: boolean }>(`/api/v1/documents/${input.id}/reprocess`, 'POST', {
        useOcr: Boolean(input.useOcr),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  })
}

export interface OcrEstimateDto {
  pages: number
  estimatedTokens: number
  tooLong: boolean
  allowed: boolean
  maxPages: number
}

export function useOcrEstimate(id: string | null) {
  return useQuery({
    queryKey: ['ocr-estimate', id],
    queryFn: () => apiFetch<OcrEstimateDto>(`/api/v1/documents/${id}/ocr-estimate`),
    enabled: Boolean(id),
  })
}
