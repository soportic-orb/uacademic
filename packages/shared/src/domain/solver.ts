/**
 * Automatic timetable generation.
 *
 * Two phases, as the product asks for:
 *
 *   1. a greedy construction that always places the most constrained group
 *      first — the one with the fewest legal holes left — because a group with
 *      two options placed last is a group that ends up unplaced;
 *   2. simulated annealing over four moves (move a session, swap two, reassign
 *      the teacher, change the room), which is what turns a legal week into a
 *      liveable one.
 *
 * Everything here is pure and deterministic: the randomness comes from a
 * seeded generator, and time and cancellation are injected. That is what makes
 * a solver testable at all, and it is why the API can run it inside a worker
 * thread with a 60 s budget without the logic knowing anything about threads.
 *
 * Hard constraints are never traded away: an infeasible neighbour is rejected
 * outright rather than penalised, so a returned proposal is always legal for
 * the sessions it did place.
 */
import {
  type PlannedSession,
  type Penalty,
  type ScheduleContext,
  type ScheduleScore,
  type SoftConstraint,
  candidateSlots,
  evaluatePlacement,
  evaluateSoft,
  scoreSchedule,
} from './constraints.js'
import type { Recurrence } from './conflicts.js'
import { type ClockTime, type Weekday, round2 } from './time.js'

/** One session that has to exist somewhere in the week. */
export interface SessionRequirement {
  id: string
  groupId: string
  durationMinutes: number
  /** Teachers who may take it: usually the ones assigned to the group. */
  candidateTeacherIds: readonly string[]
  /** Rooms that could host it; the engine still checks capacity and kit. */
  candidateSpaceIds: readonly string[]
  dateFrom: Date
  dateTo: Date
  recurrence?: Recurrence
}

export interface SolverInput {
  context: ScheduleContext
  requirements: readonly SessionRequirement[]
  /** Sessions the coordinator already fixed; the solver never moves these. */
  fixed?: readonly PlannedSession[]
}

export interface SolverProgress {
  phase: 'construct' | 'improve'
  /** 0…100, for a progress bar that has to mean something. */
  percent: number
  bestCost: number
  placed: number
  unplaced: number
  iterations: number
}

export interface SolverOptions {
  seed?: number
  /** How many proposals to return. Defaults to the center's setting. */
  proposals?: number
  /** Wall-clock budget. The API caps this at 60 s. */
  timeBudgetMs?: number
  maxIterations?: number
  /** Injected so tests can run a deterministic clock. */
  now?: () => number
  onProgress?: (progress: SolverProgress) => void
  /** Cooperative cancellation, checked on every iteration batch. */
  shouldStop?: () => boolean
}

export interface Sacrifice {
  constraint: SoftConstraint
  /** Hours, days or changes, depending on the constraint. */
  amount: number
  cost: number
  occurrences: number
  /** i18n key under `planner.sacrifice.`. */
  messageKey: string
  params: Record<string, string | number>
}

export interface Proposal {
  id: string
  sessions: PlannedSession[]
  /** Requirement ids the solver could not place legally. */
  unplaced: string[]
  score: ScheduleScore
  /** Ranking number: soft cost plus a heavy price for anything unplaced. */
  cost: number
  /** What this proposal gave up, worst first — the natural-language part. */
  sacrifices: Sacrifice[]
}

export interface SolverResult {
  proposals: Proposal[]
  iterations: number
  elapsedMs: number
  /** True when the budget ran out before annealing finished cooling. */
  stoppedEarly: boolean
}

/** Cost of leaving one session unplaced, in soft-cost units. */
const UNPLACED_COST = 1000

/** How many options are enough to tell which requirement is most constrained. */
const PROBE_LIMIT = 16

/** How many of the chosen requirement's options are actually scored. */
const CHOICE_LIMIT = 120

/** Deterministic PRNG (mulberry32): same seed, same timetable, always. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Placement {
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  teacherProfileId: string
  spaceId: string | null
}

function sessionFrom(requirement: SessionRequirement, placement: Placement): PlannedSession {
  return {
    id: requirement.id,
    groupId: requirement.groupId,
    teacherProfileId: placement.teacherProfileId,
    spaceId: placement.spaceId,
    weekday: placement.weekday,
    startTime: placement.startTime,
    endTime: placement.endTime,
    dateFrom: requirement.dateFrom,
    dateTo: requirement.dateTo,
    ...(requirement.recurrence ? { recurrence: requirement.recurrence } : {}),
  }
}

/**
 * Legal placements for one requirement against the sessions already there.
 *
 * `limit` stops the search early: the constructive phase only needs to know
 * "fewer than the other candidate", not the exact size of a domain with
 * thousands of members.
 */
export function feasiblePlacements(
  requirement: SessionRequirement,
  placed: readonly PlannedSession[],
  context: ScheduleContext,
  limit = Number.POSITIVE_INFINITY,
): Placement[] {
  const options: Placement[] = []
  const others = placed.filter((session) => session.id !== requirement.id)
  const spaces: (string | null)[] =
    requirement.candidateSpaceIds.length > 0 ? [...requirement.candidateSpaceIds] : [null]

  for (const slot of candidateSlots(context.settings, requirement.durationMinutes)) {
    for (const teacherProfileId of requirement.candidateTeacherIds) {
      for (const spaceId of spaces) {
        const candidate = sessionFrom(requirement, { ...slot, teacherProfileId, spaceId })
        if (evaluatePlacement(candidate, others, context).length > 0) continue
        options.push({ ...slot, teacherProfileId, spaceId })
        if (options.length >= limit) return options
      }
    }
  }

  return options
}

function softCostOf(sessions: readonly PlannedSession[], context: ScheduleContext): number {
  return round2(evaluateSoft(sessions, context).reduce((total, entry) => total + entry.cost, 0))
}

/**
 * Phase 1: greedy construction, most constrained first.
 *
 * The domain size is recomputed after every placement, because placing one
 * session is exactly what shrinks everyone else's options — an ordering fixed
 * up front would be measuring a week that no longer exists.
 */
function construct(
  input: SolverInput,
  random: () => number,
  report: (placed: number, unplaced: number) => void,
): { sessions: PlannedSession[]; unplaced: string[] } {
  const context = input.context
  const sessions: PlannedSession[] = [...(input.fixed ?? [])]
  const pending = [...input.requirements]
  const unplaced: string[] = []

  while (pending.length > 0) {
    // Ranking how constrained a requirement is does not need the exact size of
    // its domain: it needs to know which one runs out first. Probing with a
    // small cap turns a quadratic sweep into something a shared host can run.
    let chosenIndex = 0
    let smallest = Number.POSITIVE_INFINITY

    for (const [index, requirement] of pending.entries()) {
      const probe = feasiblePlacements(requirement, sessions, context, PROBE_LIMIT)
      if (probe.length < smallest) {
        smallest = probe.length
        chosenIndex = index
        if (smallest === 0) break
      }
    }

    const requirement = pending.splice(chosenIndex, 1)[0]!
    const chosenOptions = feasiblePlacements(requirement, sessions, context, CHOICE_LIMIT)

    if (chosenOptions.length === 0) {
      unplaced.push(requirement.id)
      report(sessions.length, unplaced.length)
      continue
    }

    // Among the legal options, take the cheapest; ties break on the seeded
    // generator so two runs with the same seed agree and different seeds
    // explore different corners.
    let best: Placement | null = null
    let bestCost = Number.POSITIVE_INFINITY
    for (const option of chosenOptions) {
      const cost = softCostOf([...sessions, sessionFrom(requirement, option)], context)
      const jitter = random() * 0.001
      if (cost + jitter < bestCost) {
        bestCost = cost + jitter
        best = option
      }
    }

    sessions.push(sessionFrom(requirement, best!))
    report(sessions.length, unplaced.length)
  }

  return { sessions, unplaced }
}

interface Solution {
  sessions: PlannedSession[]
  unplaced: string[]
  cost: number
}

function costOf(solution: Omit<Solution, 'cost'>, context: ScheduleContext): number {
  return round2(softCostOf(solution.sessions, context) + solution.unplaced.length * UNPLACED_COST)
}

function signatureOf(solution: Solution): string {
  return [...solution.sessions]
    .map(
      (session) =>
        `${session.id}@${session.weekday}#${session.startTime}#${session.teacherProfileId ?? ''}#${session.spaceId ?? ''}`,
    )
    .sort()
    .join('|')
}

type MoveKind = 'move' | 'swap' | 'reassignTeacher' | 'changeSpace'

const MOVES: readonly MoveKind[] = ['move', 'swap', 'reassignTeacher', 'changeSpace']

/**
 * Phase 2: simulated annealing. A neighbour that breaks a hard constraint is
 * discarded rather than accepted with a penalty — the temperature is for
 * trading comfort against comfort, never legality against comfort.
 */
export function generateSchedule(input: SolverInput, options: SolverOptions = {}): SolverResult {
  const context = input.context
  const now = options.now ?? (() => Date.now())
  const started = now()
  const budgetMs = options.timeBudgetMs ?? context.settings.engine.timeBudgetSeconds * 1000
  const wanted = options.proposals ?? context.settings.engine.proposals
  const maxIterations = options.maxIterations ?? 20_000
  const random = createRandom(options.seed ?? 20260817)

  const fixedIds = new Set((input.fixed ?? []).map((session) => session.id))
  const requirementById = new Map(input.requirements.map((entry) => [entry.id, entry]))

  const elapsed = () => now() - started
  const outOfTime = () => elapsed() >= budgetMs || Boolean(options.shouldStop?.())

  const constructed = construct(input, random, (placed, unplacedCount) =>
    options.onProgress?.({
      phase: 'construct',
      percent: Math.min(
        30,
        Math.round(((placed + unplacedCount) / Math.max(1, input.requirements.length)) * 30),
      ),
      bestCost: 0,
      placed,
      unplaced: unplacedCount,
      iterations: 0,
    }),
  )

  let current: Solution = {
    sessions: constructed.sessions,
    unplaced: constructed.unplaced,
    cost: costOf(constructed, context),
  }
  let best = current

  const pool = new Map<string, Solution>([[signatureOf(current), current]])

  let temperature = Math.max(1, current.cost * 0.25 + 1)
  const cooling = 0.9995
  let iterations = 0
  let stoppedEarly = false

  while (iterations < maxIterations) {
    if (outOfTime()) {
      stoppedEarly = true
      break
    }

    iterations += 1
    const neighbour = neighbourOf(current, context, requirementById, fixedIds, random)
    if (neighbour) {
      const delta = neighbour.cost - current.cost
      if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
        current = neighbour
        const signature = signatureOf(neighbour)
        if (!pool.has(signature)) pool.set(signature, neighbour)
        if (neighbour.cost < best.cost) best = neighbour
      }
    }

    temperature = Math.max(0.01, temperature * cooling)

    if (iterations % 200 === 0) {
      options.onProgress?.({
        phase: 'improve',
        percent: Math.min(
          99,
          30 + Math.round((Math.min(elapsed() / budgetMs, iterations / maxIterations) || 0) * 69),
        ),
        bestCost: best.cost,
        placed: best.sessions.length,
        unplaced: best.unplaced.length,
        iterations,
      })
    }
  }

  const proposals = [...pool.values()]
    .sort((a, b) => a.cost - b.cost || signatureOf(a).localeCompare(signatureOf(b)))
    .slice(0, wanted)
    .map((solution, index) => toProposal(solution, index, context))

  options.onProgress?.({
    phase: 'improve',
    percent: 100,
    bestCost: best.cost,
    placed: best.sessions.length,
    unplaced: best.unplaced.length,
    iterations,
  })

  return { proposals, iterations, elapsedMs: elapsed(), stoppedEarly }
}

function neighbourOf(
  current: Solution,
  context: ScheduleContext,
  requirements: ReadonlyMap<string, SessionRequirement>,
  fixedIds: ReadonlySet<string>,
  random: () => number,
): Solution | null {
  const movable = current.sessions.filter((session) => !fixedIds.has(session.id))
  if (movable.length === 0) return null

  const kind = MOVES[Math.floor(random() * MOVES.length)]!
  const session = movable[Math.floor(random() * movable.length)]!
  const requirement = requirements.get(session.id)
  if (!requirement) return null

  const others = current.sessions.filter((entry) => entry.id !== session.id)

  switch (kind) {
    case 'move': {
      // An unplaced requirement is the most valuable thing to try to fit, so
      // half the moves aim at one when there is any.
      const target =
        current.unplaced.length > 0 && random() < 0.5
          ? requirements.get(current.unplaced[Math.floor(random() * current.unplaced.length)]!)
          : requirement

      if (!target) return null
      const isUnplaced = current.unplaced.includes(target.id)
      const base = isUnplaced ? current.sessions : others
      const options = feasiblePlacements(target, base, context, 60)
      if (options.length === 0) return null

      const placement = options[Math.floor(random() * options.length)]!
      const sessions = [...base, sessionFrom(target, placement)]
      const unplaced = current.unplaced.filter((id) => id !== target.id)
      return withCost({ sessions, unplaced }, context)
    }

    case 'swap': {
      const partner = movable[Math.floor(random() * movable.length)]!
      if (partner.id === session.id) return null
      const partnerRequirement = requirements.get(partner.id)
      if (!partnerRequirement) return null
      // Swapping only makes sense between sessions of the same length.
      if (
        requirement.durationMinutes !== partnerRequirement.durationMinutes ||
        !partnerRequirement.candidateTeacherIds.includes(session.teacherProfileId ?? '') ||
        !requirement.candidateTeacherIds.includes(partner.teacherProfileId ?? '')
      ) {
        return null
      }

      const rest = current.sessions.filter(
        (entry) => entry.id !== session.id && entry.id !== partner.id,
      )
      const first = {
        ...session,
        weekday: partner.weekday,
        startTime: partner.startTime,
        endTime: partner.endTime,
      }
      const second = {
        ...partner,
        weekday: session.weekday,
        startTime: session.startTime,
        endTime: session.endTime,
      }

      if (
        evaluatePlacement(first, [...rest, second], context).length > 0 ||
        evaluatePlacement(second, [...rest, first], context).length > 0
      ) {
        return null
      }

      return withCost({ sessions: [...rest, first, second], unplaced: current.unplaced }, context)
    }

    case 'reassignTeacher': {
      const candidates = requirement.candidateTeacherIds.filter(
        (id) => id !== session.teacherProfileId,
      )
      if (candidates.length === 0) return null
      const teacherProfileId = candidates[Math.floor(random() * candidates.length)]!
      const moved = { ...session, teacherProfileId }
      if (evaluatePlacement(moved, others, context).length > 0) return null
      return withCost({ sessions: [...others, moved], unplaced: current.unplaced }, context)
    }

    case 'changeSpace': {
      const candidates = requirement.candidateSpaceIds.filter((id) => id !== session.spaceId)
      if (candidates.length === 0) return null
      const spaceId = candidates[Math.floor(random() * candidates.length)]!
      const moved = { ...session, spaceId }
      if (evaluatePlacement(moved, others, context).length > 0) return null
      return withCost({ sessions: [...others, moved], unplaced: current.unplaced }, context)
    }
  }
}

function withCost(solution: Omit<Solution, 'cost'>, context: ScheduleContext): Solution {
  return { ...solution, cost: costOf(solution, context) }
}

function toProposal(solution: Solution, index: number, context: ScheduleContext): Proposal {
  const score = scoreSchedule(solution.sessions, context)

  return {
    id: `proposal-${index + 1}`,
    sessions: [...solution.sessions].sort(
      (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
    ),
    unplaced: [...solution.unplaced],
    score,
    cost: solution.cost,
    sacrifices: summarizeSacrifices(score.penalties),
  }
}

/**
 * What a proposal gave up, aggregated per constraint and worst first.
 *
 * This is the "explain it in words" part, and it deliberately stops at
 * structured data: the sentence is assembled from the i18n catalogs, so the
 * same proposal explains itself in Catalan, Spanish and English (R1).
 */
export function summarizeSacrifices(penalties: readonly Penalty[]): Sacrifice[] {
  const byConstraint = new Map<SoftConstraint, Sacrifice>()

  for (const entry of penalties) {
    const existing = byConstraint.get(entry.constraint)
    if (existing) {
      existing.amount = round2(existing.amount + entry.amount)
      existing.cost = round2(existing.cost + entry.cost)
      existing.occurrences += 1
      existing.params = { amount: existing.amount, count: existing.occurrences }
    } else {
      byConstraint.set(entry.constraint, {
        constraint: entry.constraint,
        amount: entry.amount,
        cost: entry.cost,
        occurrences: 1,
        messageKey: `planner.sacrifice.${entry.constraint}`,
        params: { amount: entry.amount, count: 1 },
      })
    }
  }

  return [...byConstraint.values()].sort(
    (a, b) => b.cost - a.cost || a.constraint.localeCompare(b.constraint),
  )
}
