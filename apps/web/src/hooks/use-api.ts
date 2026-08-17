import type {
  CenterLoadSummaryDto,
  CenterSettings,
  CurrentUser,
  SubjectDto,
  TeacherLoadDto,
} from '@uacademic/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { apiFetch } from '../lib/api'
import { useSessionStore } from '../stores/session'

function useRequestContext() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const centerId = useSessionStore((state) => state.centerId)
  return { mockUserEmail, centerId }
}

export function useCurrentUser() {
  const { mockUserEmail } = useRequestContext()
  const setCenterId = useSessionStore((state) => state.setCenterId)
  const centerId = useSessionStore((state) => state.centerId)

  const query = useQuery({
    queryKey: ['me', mockUserEmail],
    queryFn: () => apiFetch<CurrentUser>('/api/v1/me', { mockUserEmail }),
  })

  // A user with a single center should never have to pick it.
  const firstCenterId = query.data?.memberships[0]?.centerId
  useEffect(() => {
    if (!centerId && firstCenterId) setCenterId(firstCenterId)
  }, [centerId, firstCenterId, setCenterId])

  return query
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
    queryFn: () => apiFetch<TeacherLoadResponse>('/api/v1/teachers/load', context),
    enabled: enabled && Boolean(context.centerId),
  })
}

export function useOwnLoad(enabled = true) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['own-load', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<TeacherLoadDto>('/api/v1/teachers/me/load', context),
    enabled: enabled && Boolean(context.centerId),
  })
}

export function useSubjects() {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['subjects', context.mockUserEmail, context.centerId],
    queryFn: () => apiFetch<{ items: SubjectDto[] }>('/api/v1/subjects', context),
    enabled: Boolean(context.centerId),
  })
}

export interface CenterSettingsResponse {
  centerId: string
  settings: CenterSettings
  provenance: {
    paramKey: string
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
    queryFn: () => apiFetch<CenterSettingsResponse>('/api/v1/centers/settings', context),
    enabled: Boolean(context.centerId),
  })
}
