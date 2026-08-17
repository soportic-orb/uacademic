/**
 * Teaching capacity: contracted hours versus assigned hours.
 *
 * This is the core computation of the product. Everything here is pure and
 * unit-tested (R7/R11); no rounding shortcuts, no floats accumulated blindly.
 */
import { round2, sumHours } from './time.js'

export type AssignmentConcept = 'lecture' | 'tutoring' | 'coordination' | 'tfg' | 'other'

export const ASSIGNMENT_CONCEPTS: readonly AssignmentConcept[] = [
  'lecture',
  'tutoring',
  'coordination',
  'tfg',
  'other',
]

/** Traffic light of CLAUDE.md §4, expressed as percentage boundaries. */
export type LoadStatus = 'under' | 'optimal' | 'limit' | 'over'

export interface LoadThresholds {
  /** Below this percentage the teacher is under-loaded. Default 85. */
  underBelow: number
  /** Up to this percentage (inclusive) the load is optimal. Default 100. */
  optimalUpTo: number
  /** Up to this percentage (inclusive) the teacher is at the limit. Default 110. */
  limitUpTo: number
}

export const DEFAULT_LOAD_THRESHOLDS: LoadThresholds = {
  underBelow: 85,
  optimalUpTo: 100,
  limitUpTo: 110,
}

export interface ReductionInput {
  hours: number
  /** Only approved reductions lower the capacity a teacher must cover. */
  approved: boolean
}

export interface AssignmentInput {
  concept: AssignmentConcept
  hours: number
}

export interface TeacherLoadInput {
  contractedHours: number
  reductions?: readonly ReductionInput[]
  assignments?: readonly AssignmentInput[]
}

export interface TeacherLoad {
  contractedHours: number
  /** Sum of approved reductions. */
  reductionHours: number
  /** Hours the teacher must actually cover: contracted − approved reductions. */
  capacityHours: number
  assignedHours: number
  /** Positive when there is capacity left, negative when overloaded. */
  remainingHours: number
  /**
   * Assigned / capacity as a percentage, or `null` when capacity is zero and
   * the ratio is undefined. Never `Infinity`: this crosses JSON.
   */
  ratioPercent: number | null
  status: LoadStatus
  byConcept: Record<AssignmentConcept, number>
}

/**
 * Boundaries are inclusive on the upper end, so exactly 100 % is optimal and
 * exactly 110 % is at the limit — a teacher whose load lands exactly on the
 * contract should not be shown in amber.
 */
export function loadStatusFromRatio(
  ratioPercent: number | null,
  thresholds: LoadThresholds = DEFAULT_LOAD_THRESHOLDS,
): LoadStatus {
  if (ratioPercent === null) return 'under'
  if (ratioPercent < thresholds.underBelow) return 'under'
  if (ratioPercent <= thresholds.optimalUpTo) return 'optimal'
  if (ratioPercent <= thresholds.limitUpTo) return 'limit'
  return 'over'
}

export function effectiveCapacityHours(input: TeacherLoadInput): number {
  const reductionHours = sumHours(
    (input.reductions ?? []).filter((r) => r.approved).map((r) => r.hours),
  )
  return round2(Math.max(0, round2(input.contractedHours) - reductionHours))
}

export function computeTeacherLoad(
  input: TeacherLoadInput,
  thresholds: LoadThresholds = DEFAULT_LOAD_THRESHOLDS,
): TeacherLoad {
  const contractedHours = round2(input.contractedHours)
  const reductionHours = sumHours(
    (input.reductions ?? []).filter((r) => r.approved).map((r) => r.hours),
  )
  const capacityHours = round2(Math.max(0, contractedHours - reductionHours))

  const assignments = input.assignments ?? []
  const assignedHours = sumHours(assignments.map((a) => a.hours))

  const byConcept = ASSIGNMENT_CONCEPTS.reduce(
    (acc, concept) => {
      acc[concept] = sumHours(assignments.filter((a) => a.concept === concept).map((a) => a.hours))
      return acc
    },
    {} as Record<AssignmentConcept, number>,
  )

  const ratioPercent =
    capacityHours > 0 ? round2((assignedHours / capacityHours) * 100) : assignedHours > 0 ? null : 0

  // A teacher with no capacity but hours assigned is overloaded by definition,
  // even though the percentage cannot be expressed.
  const status =
    capacityHours <= 0 && assignedHours > 0 ? 'over' : loadStatusFromRatio(ratioPercent, thresholds)

  return {
    contractedHours,
    reductionHours,
    capacityHours,
    assignedHours,
    remainingHours: round2(capacityHours - assignedHours),
    ratioPercent,
    status,
    byConcept,
  }
}

export type CoverageStatus = 'uncovered' | 'partial' | 'covered' | 'over'

export interface GroupCoverage {
  plannedHours: number
  assignedHours: number
  remainingHours: number
  status: CoverageStatus
}

/** How much of a group's planned teaching is already assigned to someone. */
export function computeGroupCoverage(
  plannedHours: number,
  assignments: readonly AssignmentInput[],
): GroupCoverage {
  const planned = round2(plannedHours)
  const assigned = sumHours(assignments.map((a) => a.hours))
  const remaining = round2(planned - assigned)

  const status: CoverageStatus =
    assigned <= 0 ? 'uncovered' : remaining > 0 ? 'partial' : remaining === 0 ? 'covered' : 'over'

  return { plannedHours: planned, assignedHours: assigned, remainingHours: remaining, status }
}

export interface CenterLoadSummary {
  teachers: number
  totalCapacityHours: number
  totalAssignedHours: number
  ratioPercent: number | null
  byStatus: Record<LoadStatus, number>
}

/** Aggregate used by the center dashboard. */
export function summarizeLoads(loads: readonly TeacherLoad[]): CenterLoadSummary {
  const totalCapacityHours = sumHours(loads.map((l) => l.capacityHours))
  const totalAssignedHours = sumHours(loads.map((l) => l.assignedHours))

  const byStatus: Record<LoadStatus, number> = { under: 0, optimal: 0, limit: 0, over: 0 }
  for (const load of loads) byStatus[load.status] += 1

  return {
    teachers: loads.length,
    totalCapacityHours,
    totalAssignedHours,
    ratioPercent:
      totalCapacityHours > 0 ? round2((totalAssignedHours / totalCapacityHours) * 100) : null,
    byStatus,
  }
}
