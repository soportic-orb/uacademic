/**
 * Class-change requests: who may move what, and in which order (R7).
 *
 * The machine is the product's escalation ladder:
 *
 *   draft → requested → accepted by the teacher → approved by coordination → applied
 *                  ↘ rejected            ↘ rejected              ↘ cancelled / expired
 *
 * Two rules bend it, and both are center parameters rather than code (R9):
 * a center where coordination only wants to be *informed* skips the approval
 * step entirely, and a request nobody answers expires by itself instead of
 * sitting in a list forever.
 *
 * Nothing here talks to a database or a clock it did not receive: the whole
 * ladder is a pure function of (state, action, who is acting), which is what
 * makes it testable and what stops the rules from being re-implemented, subtly
 * differently, in the API and in the UI.
 */
import type { ClockTime, Weekday } from './time.js'

export type ChangeRequestStatus =
  | 'draft'
  | 'requested'
  | 'accepted_by_teacher'
  | 'approved_by_coordinator'
  | 'applied'
  | 'rejected'
  | 'cancelled'
  | 'expired'

export const CHANGE_REQUEST_STATUSES: readonly ChangeRequestStatus[] = [
  'draft',
  'requested',
  'accepted_by_teacher',
  'approved_by_coordinator',
  'applied',
  'rejected',
  'cancelled',
  'expired',
]

/** States from which the request can still move. Everything else is history. */
export const OPEN_STATUSES: readonly ChangeRequestStatus[] = [
  'draft',
  'requested',
  'accepted_by_teacher',
  'approved_by_coordinator',
]

/**
 * The states in which a request is waiting on coordination.
 *
 * What the badge on the menu counts, so a coordinator can see there is
 * something to do without opening the screen. Not simply "open": a request
 * still waiting on the colleague it names is not the coordinator's to act on,
 * and a badge that counts other people's work is a badge people learn to
 * ignore.
 */
export const AWAITING_COORDINATOR: readonly ChangeRequestStatus[] = [
  // Accepted by the teacher, waiting to be approved — or, where approval is
  // only informative, waiting to be applied.
  'accepted_by_teacher',
  // Approved, and still to be put on the timetable.
  'approved_by_coordinator',
]

export type ChangeRequestAction =
  'submit' | 'accept' | 'reject' | 'approve' | 'apply' | 'cancel' | 'expire'

/**
 * Who is acting, in terms of the request rather than of the platform: the same
 * person can be the requester of one and the counterpart of another.
 */
export type ChangeActor = 'requester' | 'target' | 'coordinator' | 'system'

export type ChangeRequestType =
  | 'session_swap'
  | 'session_move'
  | 'session_cancel'
  | 'space_change'
  | 'substitution'
  | 'availability_change'

export interface ChangeTransitionRules {
  /** `workflow.coordinatorApprovesChanges`. False means "informative". */
  coordinatorApproves: boolean
  /** False when the change has no counterpart to accept it. */
  requiresTeacherAcceptance: boolean
}

export interface ChangeTransitionInput extends ChangeTransitionRules {
  status: ChangeRequestStatus
  action: ChangeRequestAction
  actor: ChangeActor
}

export interface ChangeTransitionDecision {
  allowed: boolean
  status?: ChangeRequestStatus
  /** i18n key under `changes.errors.` when refused. */
  messageKey?: string
}

interface Rule {
  from: ChangeRequestStatus
  action: ChangeRequestAction
  to: ChangeRequestStatus
  actors: readonly ChangeActor[]
}

const RULES: readonly Rule[] = [
  { from: 'draft', action: 'submit', to: 'requested', actors: ['requester'] },
  { from: 'draft', action: 'cancel', to: 'cancelled', actors: ['requester'] },

  // The counterpart answers first: nobody's timetable is changed behind their
  // back, whatever coordination decides afterwards.
  { from: 'requested', action: 'accept', to: 'accepted_by_teacher', actors: ['target'] },
  { from: 'requested', action: 'reject', to: 'rejected', actors: ['target', 'coordinator'] },
  { from: 'requested', action: 'cancel', to: 'cancelled', actors: ['requester'] },
  { from: 'requested', action: 'expire', to: 'expired', actors: ['system'] },

  {
    from: 'accepted_by_teacher',
    action: 'approve',
    to: 'approved_by_coordinator',
    actors: ['coordinator'],
  },
  { from: 'accepted_by_teacher', action: 'reject', to: 'rejected', actors: ['coordinator'] },
  { from: 'accepted_by_teacher', action: 'cancel', to: 'cancelled', actors: ['requester'] },
  { from: 'accepted_by_teacher', action: 'expire', to: 'expired', actors: ['system'] },
  // A center where approval is informative applies straight from acceptance.
  {
    from: 'accepted_by_teacher',
    action: 'apply',
    to: 'applied',
    actors: ['coordinator', 'system'],
  },

  {
    from: 'approved_by_coordinator',
    action: 'apply',
    to: 'applied',
    actors: ['coordinator', 'system'],
  },
  { from: 'approved_by_coordinator', action: 'cancel', to: 'cancelled', actors: ['requester'] },
  { from: 'approved_by_coordinator', action: 'expire', to: 'expired', actors: ['system'] },
]

function isOpen(status: ChangeRequestStatus): boolean {
  return OPEN_STATUSES.includes(status)
}

/**
 * Where a request goes next, or why it cannot. The refusal carries a key
 * rather than a sentence, so the API, the UI and the assistant all say the
 * same thing in the reader's language (R1).
 */
export function evaluateChangeTransition(input: ChangeTransitionInput): ChangeTransitionDecision {
  if (!isOpen(input.status)) {
    return { allowed: false, messageKey: 'changes.errors.closed' }
  }

  // Skipping the approval step is a rule about the center, not about the
  // person: with informative coordination there is no `approve` at all.
  if (input.action === 'approve' && !input.coordinatorApproves) {
    return { allowed: false, messageKey: 'changes.errors.approvalNotRequired' }
  }

  if (
    input.action === 'apply' &&
    input.status === 'accepted_by_teacher' &&
    input.coordinatorApproves
  ) {
    return { allowed: false, messageKey: 'changes.errors.approvalRequired' }
  }

  const rule = RULES.find((entry) => entry.from === input.status && entry.action === input.action)
  if (!rule) return { allowed: false, messageKey: 'changes.errors.invalidTransition' }

  if (!rule.actors.includes(input.actor)) {
    return { allowed: false, messageKey: 'changes.errors.notYours' }
  }

  return { allowed: true, status: rule.to }
}

/**
 * The state a freshly submitted request lands in.
 *
 * A change with no counterpart — moving one's own class to a free room —
 * skips the acceptance step; without an approval step either, it is ready to
 * apply the moment it is asked for.
 */
export function statusAfterSubmit(rules: ChangeTransitionRules): ChangeRequestStatus {
  if (rules.requiresTeacherAcceptance) return 'requested'
  return rules.coordinatorApproves ? 'accepted_by_teacher' : 'applied'
}

const ALL_ACTIONS: readonly ChangeRequestAction[] = [
  'submit',
  'accept',
  'reject',
  'approve',
  'apply',
  'cancel',
]

/** Actions the given actor can take right now. Drives the buttons a user sees. */
export function availableActions(
  status: ChangeRequestStatus,
  actor: ChangeActor,
  rules: ChangeTransitionRules,
): ChangeRequestAction[] {
  return ALL_ACTIONS.filter(
    (action) => evaluateChangeTransition({ ...rules, status, action, actor }).allowed,
  )
}

/**
 * One person often plays more than one part: the coordinator who asks for a
 * room change is the requester *and* the coordination the request has to pass
 * through. Judging them by a single hat would let the ladder refuse a step
 * they are perfectly entitled to take — so the parts are evaluated together,
 * and the audit log records which person acted.
 */
export function evaluateChangeTransitionAs(
  input: Omit<ChangeTransitionInput, 'actor'> & { actors: readonly ChangeActor[] },
): ChangeTransitionDecision {
  let refusal: ChangeTransitionDecision = {
    allowed: false,
    messageKey: 'changes.errors.notYours',
  }

  for (const actor of input.actors) {
    const decision = evaluateChangeTransition({ ...input, actor })
    if (decision.allowed) return decision
    // A refusal about the request itself is more useful than "not yours".
    if (decision.messageKey !== 'changes.errors.notYours') refusal = decision
  }

  return refusal
}

export function availableActionsFor(
  status: ChangeRequestStatus,
  actors: readonly ChangeActor[],
  rules: ChangeTransitionRules,
): ChangeRequestAction[] {
  return ALL_ACTIONS.filter(
    (action) => evaluateChangeTransitionAs({ ...rules, status, action, actors }).allowed,
  )
}

/** Who has to be told about a transition, in terms of the request's own roles. */
export function audienceFor(status: ChangeRequestStatus): ChangeActor[] {
  switch (status) {
    case 'requested':
      return ['target', 'coordinator']
    case 'accepted_by_teacher':
      return ['requester', 'coordinator']
    case 'approved_by_coordinator':
    case 'applied':
    case 'rejected':
    case 'cancelled':
    case 'expired':
      return ['requester', 'target']
    default:
      return []
  }
}

export interface ExpiryInput {
  createdAt: Date
  /** `workflow.changeRequestExpiryHours`; zero or less disables expiry. */
  expiryHours: number
}

export function expiresAt(input: ExpiryInput): Date | null {
  if (input.expiryHours <= 0) return null
  return new Date(input.createdAt.getTime() + input.expiryHours * 3600_000)
}

export function hasExpired(
  request: { status: ChangeRequestStatus; expiresAt: Date | null },
  now: Date,
): boolean {
  if (!isOpen(request.status) || !request.expiresAt) return false
  return request.expiresAt.getTime() <= now.getTime()
}

/**
 * What a request proposes, in the terms the constraint engine understands.
 * `null` in a field means "leave it as it is", which is how a room change and
 * a slot move can share one shape.
 */
export interface ChangeProposal {
  weekday?: Weekday
  startTime?: ClockTime
  endTime?: ClockTime
  spaceId?: string | null
  teacherProfileId?: string | null
  /** For a swap: the session to exchange slots with. */
  swapWithSessionId?: string
  note?: string
}

export interface ProposedSession {
  id: string
  groupId: string
  teacherProfileId: string | null
  spaceId: string | null
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  dateFrom: Date
  dateTo: Date
  recurrence: 'weekly' | 'biweekly' | 'once'
}

/** Applies a proposal to a session without touching what it does not mention. */
export function applyProposal(session: ProposedSession, proposal: ChangeProposal): ProposedSession {
  return {
    ...session,
    ...(proposal.weekday !== undefined ? { weekday: proposal.weekday } : {}),
    ...(proposal.startTime !== undefined ? { startTime: proposal.startTime } : {}),
    ...(proposal.endTime !== undefined ? { endTime: proposal.endTime } : {}),
    ...(proposal.spaceId !== undefined ? { spaceId: proposal.spaceId } : {}),
    ...(proposal.teacherProfileId !== undefined
      ? { teacherProfileId: proposal.teacherProfileId }
      : {}),
  }
}

/** The two sessions of a swap, with their slots exchanged. */
export function swapSlots(
  first: ProposedSession,
  second: ProposedSession,
): [ProposedSession, ProposedSession] {
  return [
    { ...first, weekday: second.weekday, startTime: second.startTime, endTime: second.endTime },
    { ...second, weekday: first.weekday, startTime: first.startTime, endTime: first.endTime },
  ]
}
