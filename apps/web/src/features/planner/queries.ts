/**
 * Server state for the planner.
 *
 * Every mutation returns the whole version — sessions, violations, penalties
 * and the summary — because moving one class changes the state of the week,
 * not of that class. The screen therefore always draws a coherent picture
 * rather than a locally patched one.
 */
import type { Penalty, PlannerSummary, ScheduleChange, Violation, Weekday } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../../lib/api'
import type { PlannerContextDto } from './use-planner'
import { useSessionStore } from '../../stores/session'

export interface PlannerSessionDto {
  id: string
  groupId: string
  groupCode: string
  subjectId: string
  subjectCode: string
  subjectName: string
  /** The colour the center chose for the subject, if it chose one. */
  subjectColor: string | null
  teacherProfileId: string | null
  teacherName: string | null
  /** Everyone giving the class, the one above first. */
  teachers: { teacherProfileId: string; name: string }[]
  spaceId: string | null
  spaceName: string | null
  building: string | null
  weekday: Weekday
  startTime: string
  endTime: string
  recurrence: 'weekly' | 'biweekly' | 'once'
  dateFrom: string
  dateTo: string
  topic: string | null
}

export interface PendingGroupDto {
  requirementId: string
  groupId: string
  groupCode: string
  subjectCode: string
  subjectName: string
  durationMinutes: number
  candidateTeacherIds: string[]
  candidateSpaceIds: string[]
}

/** A group of the year, and how much of its week is placed. */
export interface GroupPlanDto {
  groupId: string
  groupCode: string
  subjectId: string
  subjectCode: string
  subjectName: string
  /** Teaching hours across the year. */
  plannedHours: number
  durationMinutes: number
  /** The year's teaching for this group, in minutes. */
  targetMinutes: number
  placedMinutes: number
  remainingMinutes: number
  overplannedMinutes: number
  sessionsRemaining: number
  complete: boolean
  candidateTeacherIds: string[]
  candidateSpaceIds: string[]
}

export interface VersionDetailDto {
  id: string
  name: string
  status: 'draft' | 'in_review' | 'published' | 'archived'
  editable: boolean
  publishedAt: string | null
  parentVersionId: string | null
  grid: { dayStart: string; dayEnd: string; slotMinutes: number; weekdays: number[] }
  sessions: PlannerSessionDto[]
  violations: Violation[]
  penalties: Penalty[]
  summary: PlannerSummary
  pending: PendingGroupDto[]
  /** Every group of the year, with what is still to place for each. */
  groups: GroupPlanDto[]
  /** The dates the academic year runs between, as `YYYY-MM-DD`. */
  range: { from: string; to: string }
  /** The engine's own inputs, so the browser can colour cells without asking. */
  context: PlannerContextDto
  notified?: number
}

export interface VersionListItem {
  id: string
  name: string
  status: VersionDetailDto['status']
  sessions: number
  publishedAt: string | null
  publishedBy: string | null
  parentVersionId: string | null
  editable: boolean
}

export interface CompareResult {
  base: { id: string; name: string; status: string }
  target: { id: string; name: string; status: string }
  summary: {
    added: number
    removed: number
    changed: number
    unchanged: number
    teachersAffected: number
  }
  changes: ScheduleChange[]
  byTeacher: { teacherProfileId: string; teacherName: string | null; changes: ScheduleChange[] }[]
}

function useRequestContext() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const centerId = useSessionStore((state) => state.centerId)
  return { mockUserEmail, centerId }
}

export function useVersions() {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['planner-versions', context.mockUserEmail, context.centerId],
    queryFn: () =>
      apiFetch<{ academicYearId: string; items: VersionListItem[] }>('/api/v1/planner/versions'),
    enabled: Boolean(context.centerId),
  })
}

export function useVersion(versionId: string | null) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['planner-version', context.mockUserEmail, context.centerId, versionId],
    queryFn: () => apiFetch<VersionDetailDto>(`/api/v1/planner/versions/${versionId}`),
    enabled: Boolean(context.centerId) && Boolean(versionId),
  })
}

export function useCompare(baseId: string | null, targetId: string | null) {
  const context = useRequestContext()

  return useQuery({
    queryKey: ['planner-compare', context.mockUserEmail, context.centerId, baseId, targetId],
    queryFn: () =>
      apiFetch<CompareResult>(`/api/v1/planner/versions/${baseId}/compare?with=${targetId}`),
    enabled:
      Boolean(context.centerId) && Boolean(baseId) && Boolean(targetId) && baseId !== targetId,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all(
      ['planner-versions', 'planner-version', 'planner-compare', 'calendar'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
}

export function useCreateVersion() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: { name: string; fromVersionId?: string }) =>
      apiJson<VersionDetailDto>('/api/v1/planner/versions', 'POST', input),
    onSuccess: invalidate,
  })
}

/** Renaming the version on screen, published or not. */
export function useRenameVersion(versionId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (name: string) =>
      apiJson<VersionDetailDto>(`/api/v1/planner/versions/${versionId}`, 'PATCH', { name }),
    onSuccess: invalidate,
  })
}

export function useVersionStatus(versionId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (status: VersionDetailDto['status']) =>
      apiJson<VersionDetailDto>(`/api/v1/planner/versions/${versionId}/status`, 'PATCH', {
        status,
      }),
    onSuccess: invalidate,
  })
}

export interface SessionInput {
  groupId: string
  teacherProfileId?: string | null
  /** Everyone giving the class. Sending this replaces `teacherProfileId`. */
  teacherProfileIds?: string[]
  spaceId?: string | null
  /** The day it happens, `YYYY-MM-DD`. A class is placed on a date. */
  date: string
  startTime: string
  endTime: string
  /** What the class is about. Null clears what was written. */
  topic?: string | null
}

export function useCreateSession(versionId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: SessionInput) =>
      apiJson<VersionDetailDto>(`/api/v1/planner/versions/${versionId}/sessions`, 'POST', input),
    onSuccess: invalidate,
  })
}

export function useUpdateSession(versionId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: { sessionId: string; values: Partial<SessionInput> }) =>
      apiJson<VersionDetailDto>(
        `/api/v1/planner/versions/${versionId}/sessions/${input.sessionId}`,
        'PATCH',
        input.values,
      ),
    onSuccess: invalidate,
  })
}

/**
 * Repeating one class across the term.
 *
 * The platform never repeats anything by itself; this is a person saying "and
 * every Tuesday until December", and what it writes is ordinary sessions —
 * each on its own date, each editable and removable on its own.
 */
export function useDuplicateSession(versionId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (input: {
      sessionId: string
      weekdays: number[]
      startTime?: string
      endTime?: string
      until: string
    }) =>
      apiJson<VersionDetailDto & { created: number; skipped: number }>(
        `/api/v1/planner/versions/${versionId}/sessions/${input.sessionId}/duplicate`,
        'POST',
        {
          weekdays: input.weekdays,
          until: input.until,
          ...(input.startTime ? { startTime: input.startTime } : {}),
          ...(input.endTime ? { endTime: input.endTime } : {}),
        },
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteSession(versionId: string) {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<VersionDetailDto>(`/api/v1/planner/versions/${versionId}/sessions/${sessionId}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  })
}
