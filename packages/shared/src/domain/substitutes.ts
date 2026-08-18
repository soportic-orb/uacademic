/**
 * Finding a substitute.
 *
 * A colleague is *eligible* when they could legally take the class: they can
 * teach the subject, they are free in that slot, the slot is not one they
 * declared unavailable, and they have contract left to cover it. Among the
 * eligible ones, *suitability* is a preference order, not a rule — which is
 * why the two are computed separately and why every candidate carries the
 * reasons behind its score (R1: keys, not sentences).
 *
 * Everything is pure: the API loads the rows, this decides.
 */
import { type AvailabilityEntry, effectiveAvailability } from './availability.js'
import type { PlannedSession, ScheduleContext } from './constraints.js'
import { evaluatePlacement } from './constraints.js'
import { round2 } from './time.js'

export interface SubstituteCandidate {
  teacherProfileId: string
  name: string
  /** Subjects the person is recorded as able to teach. */
  subjectIds: readonly string[]
  knowledgeAreas: readonly string[]
  availability: readonly AvailabilityEntry[]
  /** Weekly hours the contract still leaves free; negative means overloaded. */
  remainingWeeklyHours: number
  /** Sessions already in this person's week, used for the clash check. */
  sessions: readonly PlannedSession[]
}

export type IneligibilityReason =
  'notQualified' | 'busy' | 'unavailable' | 'noCapacity' | 'sameTeacher'

export interface SubstituteScore {
  teacherProfileId: string
  name: string
  eligible: boolean
  /** 0…100. Only meaningful for eligible candidates. */
  score: number
  /** Why not, when not eligible. */
  blockers: IneligibilityReason[]
  /** i18n keys under `substitutes.reasons.`, best first. */
  reasons: { messageKey: string; params: Record<string, string | number> }[]
}

export interface SubstituteSearch {
  /** The session that needs covering. */
  session: PlannedSession
  /** Subject of the session's group, for the qualification check. */
  subjectId: string
  /** Knowledge area of the subject, when the center records one. */
  knowledgeArea?: string | null
  context: ScheduleContext
  candidates: readonly SubstituteCandidate[]
}

const WEIGHTS = {
  /** Teaching the subject itself beats sharing its area. */
  qualification: 40,
  areaMatch: 15,
  preferredSlot: 20,
  availableSlot: 10,
  capacityHeadroom: 25,
}

function qualification(
  candidate: SubstituteCandidate,
  search: SubstituteSearch,
): 'subject' | 'area' | 'none' {
  if (candidate.subjectIds.includes(search.subjectId)) return 'subject'
  if (search.knowledgeArea && candidate.knowledgeAreas.includes(search.knowledgeArea)) return 'area'
  return 'none'
}

/**
 * Whether a candidate could legally take this session, judged by the same
 * engine the planner uses: a substitute that breaks a hard constraint is not a
 * substitute, however convenient.
 */
export function evaluateCandidate(
  candidate: SubstituteCandidate,
  search: SubstituteSearch,
): SubstituteScore {
  const blockers: IneligibilityReason[] = []
  const reasons: SubstituteScore['reasons'] = []
  let score = 0

  if (candidate.teacherProfileId === search.session.teacherProfileId) {
    blockers.push('sameTeacher')
  }

  const match = qualification(candidate, search)
  if (match === 'subject') {
    score += WEIGHTS.qualification
    reasons.push({ messageKey: 'substitutes.reasons.teachesSubject', params: {} })
  } else if (match === 'area') {
    score += WEIGHTS.areaMatch
    reasons.push({
      messageKey: 'substitutes.reasons.sharesArea',
      params: { area: search.knowledgeArea ?? '' },
    })
  } else {
    blockers.push('notQualified')
  }

  const level = effectiveAvailability(
    {
      weekday: search.session.weekday,
      start: search.session.startTime,
      end: search.session.endTime,
    },
    candidate.availability,
  )

  if (level === 'unavailable') {
    blockers.push('unavailable')
  } else if (level === 'preferred') {
    score += WEIGHTS.preferredSlot
    reasons.push({ messageKey: 'substitutes.reasons.preferredSlot', params: {} })
  } else if (level === 'available') {
    score += WEIGHTS.availableSlot
    reasons.push({ messageKey: 'substitutes.reasons.availableSlot', params: {} })
  } else {
    reasons.push({ messageKey: 'substitutes.reasons.avoidSlot', params: {} })
  }

  // The clash check runs the real engine against the candidate's own week.
  const candidateSession: PlannedSession = {
    ...search.session,
    teacherProfileId: candidate.teacherProfileId,
  }
  const violations = evaluatePlacement(candidateSession, candidate.sessions, search.context)
  if (violations.some((violation) => violation.constraint === 'teacherOverlap')) {
    blockers.push('busy')
  }

  const sessionHours = hoursOf(search.session)
  if (candidate.remainingWeeklyHours < sessionHours) {
    blockers.push('noCapacity')
  } else {
    const headroom = Math.min(1, candidate.remainingWeeklyHours / Math.max(sessionHours, 0.5))
    score += WEIGHTS.capacityHeadroom * headroom
    reasons.push({
      messageKey: 'substitutes.reasons.hasCapacity',
      params: { hours: round2(candidate.remainingWeeklyHours) },
    })
  }

  return {
    teacherProfileId: candidate.teacherProfileId,
    name: candidate.name,
    eligible: blockers.length === 0,
    score: blockers.length === 0 ? round2(Math.min(100, score)) : 0,
    blockers,
    reasons: blockers.length === 0 ? reasons : blockerReasons(blockers),
  }
}

function blockerReasons(blockers: readonly IneligibilityReason[]): SubstituteScore['reasons'] {
  return blockers.map((blocker) => ({
    messageKey: `substitutes.blockers.${blocker}`,
    params: {},
  }))
}

function hoursOf(session: PlannedSession): number {
  const [startHour = 0, startMinute = 0] = session.startTime.split(':').map(Number)
  const [endHour = 0, endMinute = 0] = session.endTime.split(':').map(Number)
  return round2((endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60)
}

/**
 * Every candidate, eligible ones first and best-suited at the top. The
 * ineligible ones are kept — with their blockers — because "why can nobody
 * cover this?" is the question a coordinator actually has.
 */
export function rankSubstitutes(search: SubstituteSearch): SubstituteScore[] {
  return search.candidates
    .map((candidate) => evaluateCandidate(candidate, search))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      return b.score - a.score || a.name.localeCompare(b.name)
    })
}
