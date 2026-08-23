/**
 * Server state for the capacity screens. Every write invalidates the panels
 * that show the same numbers, because a reduction changes a teacher's capacity
 * and therefore their place in the center table.
 */
import type {
  AvailabilityExceptionInputDto,
  AvailabilityResponseDto,
  CenterLoadSummaryDto,
  ReductionInputDto,
  SaveAvailabilityDto,
  TeacherLoadDto,
  TeacherProfileDto,
  TeacherSkillsInputDto,
  TeacherWorkloadDto,
} from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

function useRequestContext() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const centerId = useSessionStore((state) => state.centerId)
  return { mockUserEmail, centerId }
}

export interface LoadPanelFilters {
  degreeId?: string
  category?: string
  status?: string
  q?: string
  sort?: string
  order?: 'asc' | 'desc'
}

export interface LoadPanelResponse {
  academicYearId: string
  teachers: TeacherLoadDto[]
  summary: CenterLoadSummaryDto
  facets: { categories: string[]; degrees: { id: string; code: string; name: string }[] }
}

export function loadQueryString(filters: LoadPanelFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  return params.toString()
}

export function useCenterLoad(filters: LoadPanelFilters) {
  const context = useRequestContext()
  const query = loadQueryString(filters)

  return useQuery({
    queryKey: ['center-load', context.mockUserEmail, context.centerId, query],
    queryFn: () => apiFetch<LoadPanelResponse>(`/api/v1/teachers/load?${query}`),
    enabled: Boolean(context.centerId),
  })
}

export function useTeacherProfile(teacherId: string) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['teacher-profile', context.mockUserEmail, context.centerId, teacherId],
    queryFn: () => apiFetch<TeacherProfileDto>(`/api/v1/teachers/${teacherId}`),
    enabled: Boolean(context.centerId),
  })
}

export function useTeacherWorkload(teacherId: string) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['teacher-workload', context.mockUserEmail, context.centerId, teacherId],
    queryFn: () => apiFetch<TeacherWorkloadDto>(`/api/v1/teachers/${teacherId}/workload`),
    enabled: Boolean(context.centerId),
  })
}

export function useAvailability(teacherId: string) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['availability', context.mockUserEmail, context.centerId, teacherId],
    queryFn: () => apiFetch<AvailabilityResponseDto>(`/api/v1/teachers/${teacherId}/availability`),
    enabled: Boolean(context.centerId),
  })
}

/** Anything that moves hours around invalidates every view of those hours. */
function useCapacityInvalidation() {
  const queryClient = useQueryClient()

  return async () => {
    await Promise.all(
      ['center-load', 'teacher-profile', 'teacher-workload', 'own-load', 'availability'].map(
        (key) => queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
}

/** The contract itself: category, dedication, hours and the note beside them. */
export function useSaveContract(teacherId: string) {
  const invalidate = useCapacityInvalidation()

  return useMutation({
    mutationFn: (values: {
      category?: string
      dedication?: string
      contractedHours?: number
      notes?: string | null
    }) => apiJson<TeacherProfileDto>(`/api/v1/teachers/${teacherId}`, 'PATCH', values),
    onSuccess: invalidate,
  })
}

export function useSaveReduction(teacherId: string) {
  const invalidate = useCapacityInvalidation()

  return useMutation({
    mutationFn: (input: { id?: string; values: ReductionInputDto }) =>
      input.id
        ? apiJson<TeacherProfileDto>(
            `/api/v1/teachers/${teacherId}/reductions/${input.id}`,
            'PATCH',
            input.values,
          )
        : apiJson<TeacherProfileDto>(
            `/api/v1/teachers/${teacherId}/reductions`,
            'POST',
            input.values,
          ),
    onSuccess: invalidate,
  })
}

export function useDeleteReduction(teacherId: string) {
  const invalidate = useCapacityInvalidation()

  return useMutation({
    mutationFn: (reductionId: string) =>
      apiFetch<TeacherProfileDto>(`/api/v1/teachers/${teacherId}/reductions/${reductionId}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  })
}

export function useSaveSkills(teacherId: string) {
  const invalidate = useCapacityInvalidation()

  return useMutation({
    mutationFn: (values: TeacherSkillsInputDto) =>
      apiJson<TeacherProfileDto>(`/api/v1/teachers/${teacherId}/skills`, 'PUT', values),
    onSuccess: invalidate,
  })
}

export function useSaveAvailability(teacherId: string) {
  const invalidate = useCapacityInvalidation()

  return useMutation({
    mutationFn: (values: SaveAvailabilityDto) =>
      apiJson<AvailabilityResponseDto>(`/api/v1/teachers/${teacherId}/availability`, 'PUT', values),
    onSuccess: invalidate,
  })
}

export function useSaveException(teacherId: string) {
  const invalidate = useCapacityInvalidation()

  return useMutation({
    mutationFn: (values: AvailabilityExceptionInputDto) =>
      apiJson<AvailabilityResponseDto>(
        `/api/v1/teachers/${teacherId}/availability/exceptions`,
        'POST',
        values,
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteException(teacherId: string) {
  const invalidate = useCapacityInvalidation()

  return useMutation({
    mutationFn: (exceptionId: string) =>
      apiFetch<AvailabilityResponseDto>(
        `/api/v1/teachers/${teacherId}/availability/exceptions/${exceptionId}`,
        { method: 'DELETE' },
      ),
    onSuccess: invalidate,
  })
}
