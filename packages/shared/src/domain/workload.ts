/**
 * The teaching-load model, in one place (R7).
 *
 *   capacity = contracted hours − approved reductions
 *   workload = Σ assignments, by concept (lecture, tutoring, coordination, tfg, other)
 *   ratio    = workload / capacity → traffic light
 *
 * `capacity.ts` computes the totals; this module adds the breakdowns the
 * screens need — per subject and per concept — and the center-level filtering.
 * Everything is pure, so the same numbers appear in the personal panel, the
 * center table and the Excel export.
 */
import {
  type AssignmentConcept,
  type LoadStatus,
  type LoadThresholds,
  type TeacherLoad,
  ASSIGNMENT_CONCEPTS,
  DEFAULT_LOAD_THRESHOLDS,
  computeTeacherLoad,
} from './capacity.js'
import { round2, sumHours } from './time.js'

/** One assignment, with the context the breakdown needs. */
export interface AssignmentDetail {
  subjectId: string
  subjectCode: string
  subjectName: string
  groupId: string | null
  groupCode: string | null
  concept: AssignmentConcept
  hours: number
}

/** Classes somebody is on in the published timetable, for one group. */
export interface TimetabledGroup {
  subjectId: string
  subjectCode: string
  subjectName: string
  groupId: string
  groupCode: string
  /** Minutes of class, added up across the year. */
  minutes: number
}

/**
 * The teaching somebody has, from both places it can be written down.
 *
 * A center records the teaching order as assignments — "you have 60 hours of
 * this group" — and coordination then places those hours on the timetable.
 * Where both exist the assignment is what counts: it is what the center
 * decided the person is owed, and the timetable is a term still being drawn.
 *
 * But a center that plans straight into the planner without writing the order
 * down first is a center whose teachers had no load at all: their week was
 * full and their own screen said zero. So a group somebody is timetabled for
 * and holds no assignment on counts as the hours they are actually teaching.
 */
export function withTimetabledTeaching(
  assignments: readonly AssignmentDetail[],
  timetabled: readonly TimetabledGroup[],
): AssignmentDetail[] {
  const ordered = new Set(
    assignments.map((assignment) => assignment.groupId).filter((id): id is string => Boolean(id)),
  )

  return [
    ...assignments,
    ...timetabled
      .filter((group) => !ordered.has(group.groupId) && group.minutes > 0)
      .map((group) => ({
        subjectId: group.subjectId,
        subjectCode: group.subjectCode,
        subjectName: group.subjectName,
        groupId: group.groupId,
        groupCode: group.groupCode,
        // Classes in front of a group are teaching; nothing else about them is
        // known here, and inventing a finer concept would be inventing.
        concept: 'lecture' as AssignmentConcept,
        hours: round2(group.minutes / 60),
      })),
  ]
}

export interface ConceptTotals {
  concept: AssignmentConcept
  hours: number
  /** Share of the teacher's workload, as a percentage. */
  percent: number
}

export interface SubjectWorkload {
  subjectId: string
  subjectCode: string
  subjectName: string
  hours: number
  percent: number
  byConcept: ConceptTotals[]
  groups: { groupId: string | null; groupCode: string | null; hours: number }[]
}

export interface TeacherWorkload extends TeacherLoad {
  bySubject: SubjectWorkload[]
  conceptTotals: ConceptTotals[]
}

function percentOf(part: number, total: number): number {
  return total > 0 ? round2((part / total) * 100) : 0
}

/** Totals per concept, always in the canonical order and including zeros. */
export function conceptTotals(
  assignments: readonly AssignmentDetail[],
  total?: number,
): ConceptTotals[] {
  const assigned = total ?? sumHours(assignments.map((assignment) => assignment.hours))

  return ASSIGNMENT_CONCEPTS.map((concept) => {
    const hours = sumHours(
      assignments.filter((assignment) => assignment.concept === concept).map((a) => a.hours),
    )
    return { concept, hours, percent: percentOf(hours, assigned) }
  })
}

/**
 * Groups a teacher's assignments by subject, ordered by hours descending so the
 * heaviest commitment is the first thing anyone reads.
 */
export function groupBySubject(assignments: readonly AssignmentDetail[]): SubjectWorkload[] {
  const total = sumHours(assignments.map((assignment) => assignment.hours))
  const bySubject = new Map<string, AssignmentDetail[]>()

  for (const assignment of assignments) {
    const existing = bySubject.get(assignment.subjectId)
    if (existing) existing.push(assignment)
    else bySubject.set(assignment.subjectId, [assignment])
  }

  return [...bySubject.values()]
    .map((rows) => {
      const first = rows[0]!
      const hours = sumHours(rows.map((row) => row.hours))

      const groups = new Map<
        string,
        { groupId: string | null; groupCode: string | null; hours: number }
      >()
      for (const row of rows) {
        const key = row.groupId ?? '—'
        const current = groups.get(key)
        if (current) current.hours = round2(current.hours + row.hours)
        else groups.set(key, { groupId: row.groupId, groupCode: row.groupCode, hours: row.hours })
      }

      return {
        subjectId: first.subjectId,
        subjectCode: first.subjectCode,
        subjectName: first.subjectName,
        hours,
        percent: percentOf(hours, total),
        byConcept: conceptTotals(rows, hours).filter((entry) => entry.hours > 0),
        groups: [...groups.values()].sort((a, b) => b.hours - a.hours),
      }
    })
    .sort((a, b) => b.hours - a.hours || a.subjectCode.localeCompare(b.subjectCode))
}

export interface WorkloadInput {
  contractedHours: number
  reductions?: readonly { hours: number; approved: boolean }[]
  assignments?: readonly AssignmentDetail[]
}

/** The full picture for one teacher: totals, traffic light and breakdowns. */
export function computeWorkload(
  input: WorkloadInput,
  thresholds: LoadThresholds = DEFAULT_LOAD_THRESHOLDS,
): TeacherWorkload {
  const assignments = input.assignments ?? []

  const load = computeTeacherLoad(
    {
      contractedHours: input.contractedHours,
      reductions: input.reductions ?? [],
      assignments: assignments.map((assignment) => ({
        concept: assignment.concept,
        hours: assignment.hours,
      })),
    },
    thresholds,
  )

  return {
    ...load,
    bySubject: groupBySubject(assignments),
    conceptTotals: conceptTotals(assignments, load.assignedHours),
  }
}

/** A row of the center load table, as the filters see it. */
export interface CenterLoadRow {
  teacherProfileId: string
  userId: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  category: string
  dedication: string
  contractedHours: number
  reductionHours: number
  capacityHours: number
  assignedHours: number
  remainingHours: number
  ratioPercent: number | null
  status: LoadStatus
  /** Degrees this teacher has assignments in, for the degree filter. */
  degreeIds: string[]
}

export interface LoadFilters {
  degreeId?: string | undefined
  category?: string | undefined
  status?: LoadStatus | undefined
  /** Free text over the teacher's name. */
  search?: string | undefined
}

/**
 * Filtering lives here rather than in the table component: the Excel export
 * must produce exactly what the screen shows, and duplicating the predicate is
 * how those two drift apart.
 */
export function filterLoadRows(
  rows: readonly CenterLoadRow[],
  filters: LoadFilters,
): CenterLoadRow[] {
  const search = filters.search?.trim().toLowerCase() ?? ''

  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false
    if (filters.category && row.category !== filters.category) return false
    if (filters.degreeId && !row.degreeIds.includes(filters.degreeId)) return false
    if (search.length > 0) {
      const name = `${row.firstName} ${row.lastName}`.toLowerCase()
      if (!name.includes(search)) return false
    }
    return true
  })
}

export type LoadSortKey = 'name' | 'capacity' | 'assigned' | 'ratio' | 'status'

const STATUS_ORDER: Record<LoadStatus, number> = { over: 0, limit: 1, under: 2, optimal: 3 }

/** Sorting the table. `status` puts the problems first, which is the point. */
export function sortLoadRows(
  rows: readonly CenterLoadRow[],
  key: LoadSortKey,
  order: 'asc' | 'desc' = 'asc',
): CenterLoadRow[] {
  const direction = order === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    switch (key) {
      case 'capacity':
        return (a.capacityHours - b.capacityHours) * direction
      case 'assigned':
        return (a.assignedHours - b.assignedHours) * direction
      case 'ratio':
        // A teacher with no capacity has no ratio; keep them at the end.
        return ((a.ratioPercent ?? -1) - (b.ratioPercent ?? -1)) * direction
      case 'status':
        return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * direction
      case 'name':
      default:
        return (
          `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`) * direction
        )
    }
  })
}
