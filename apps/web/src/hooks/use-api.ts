import type {
  CenterLoadSummaryDto,
  CenterSettings,
  SubjectDto,
  TeacherLoadDto,
} from '@uacademic/shared'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '../lib/api'
import { useSessionStore } from '../stores/session'

/**
 * The session travels in an httpOnly cookie, so the only thing a query key
 * needs is the active center: switching centers must refetch, switching
 * identity clears the whole cache on sign-out.
 */
function useRequestContext() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const centerId = useSessionStore((state) => state.centerId)
  return { mockUserEmail, centerId }
}

export interface TeacherLoadResponse {
  academicYearId: string
  teachers: TeacherLoadDto[]
  summary: CenterLoadSummaryDto
}

export function useTeacherLoad(enabled = true) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['teacher-load', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<TeacherLoadResponse>('/api/v1/teachers/load'),
    enabled: enabled && Boolean(context.centerId),
  })
}

export function useOwnLoad(enabled = true) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['own-load', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<TeacherLoadDto>('/api/v1/teachers/me/load'),
    enabled: enabled && Boolean(context.centerId),
  })
}

export function useSubjects() {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['subjects', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<{ items: SubjectDto[] }>('/api/v1/subjects'),
    enabled: Boolean(context.centerId),
  })
}

export interface CenterSettingsResponse {
  centerId: string
  settings: CenterSettings
  provenance: {
    paramKey: string
    documentId: string | null
    documentTitle: string | null
    page: number | null
    section: string | null
    quote: string | null
  }[]
}

export function useCenterSettings() {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['center-settings', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<CenterSettingsResponse>('/api/v1/centers/settings'),
    enabled: Boolean(context.centerId),
  })
}
