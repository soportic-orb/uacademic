/**
 * The lifecycle of a schedule version.
 *
 * The point of the state machine is that a draft is private: coordinators move
 * sessions around all week and nobody is told anything. Publishing is the
 * single moment the timetable becomes real, and it is the only transition that
 * notifies anyone.
 */
export type ScheduleVersionStatus = 'draft' | 'in_review' | 'published' | 'archived'

export const SCHEDULE_VERSION_STATUSES: readonly ScheduleVersionStatus[] = [
  'draft',
  'in_review',
  'published',
  'archived',
]

const TRANSITIONS: Record<ScheduleVersionStatus, readonly ScheduleVersionStatus[]> = {
  // A draft goes to review, or straight to publication for a center that does
  // not use the review step (R9: `workflow.coordinatorApprovesChanges`).
  draft: ['in_review', 'published', 'archived'],
  // Review can send it back for more work.
  in_review: ['draft', 'published', 'archived'],
  // A published version is history: it is superseded, never edited.
  published: ['archived'],
  archived: [],
}

export function nextStatuses(status: ScheduleVersionStatus): ScheduleVersionStatus[] {
  return [...TRANSITIONS[status]]
}

export function canTransition(from: ScheduleVersionStatus, to: ScheduleVersionStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** True while sessions may still be moved: only a draft or a version in review. */
export function isEditable(status: ScheduleVersionStatus): boolean {
  return status === 'draft' || status === 'in_review'
}

/** Whether reaching this status is what tells teachers about their week. */
export function notifiesTeachers(to: ScheduleVersionStatus): boolean {
  return to === 'published'
}

export interface TransitionRequest {
  from: ScheduleVersionStatus
  to: ScheduleVersionStatus
  /** Whether the center requires the review step before publishing. */
  requiresReview: boolean
  /** Blocking violations still present in the version. */
  blockingViolations: number
}

export interface TransitionDecision {
  allowed: boolean
  /** i18n key under `planner.version.errors.` when refused. */
  messageKey?: string
}

/**
 * Whether a transition may happen, including the two rules that are not about
 * the graph: a center can demand the review step, and nothing illegal gets
 * published — a week with an unresolved hard conflict is not a week.
 */
export function evaluateTransition(request: TransitionRequest): TransitionDecision {
  if (!canTransition(request.from, request.to)) {
    return { allowed: false, messageKey: 'planner.version.errors.invalidTransition' }
  }

  if (request.to === 'published') {
    if (request.requiresReview && request.from !== 'in_review') {
      return { allowed: false, messageKey: 'planner.version.errors.reviewRequired' }
    }
    if (request.blockingViolations > 0) {
      return { allowed: false, messageKey: 'planner.version.errors.blockingViolations' }
    }
  }

  return { allowed: true }
}
