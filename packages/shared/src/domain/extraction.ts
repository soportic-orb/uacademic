/**
 * Reading a center's teaching regulation into its configuration.
 *
 * The point of this is not saving an administrator twenty minutes at setup.
 * It is that months later, when the planner refuses an assignment because it
 * "exceeds the contracted capacity", somebody can follow that refusal back to
 * the article of their own regulation that imposes it. Everything here exists
 * to keep that chain — parameter → citation → document → page — unbroken.
 *
 * Which is why the rules are the way they are:
 *
 * 1. Nothing is ever applied on its own, however confident the reading.
 * 2. No citation, no proposal. A parameter with no textual support comes back
 *    as `not_found` and keeps its default. Inventing a plausible number would
 *    be the worst possible failure of this feature: it would look right.
 * 3. Contradictions are shown, not resolved. Two articles, two values, two
 *    citations, and a person decides.
 * 4. Exceptions travel as a note. Almost every rule has its "except when…",
 *    and losing that text is losing the reason the rule can be argued with.
 * 5. A parameter somebody edited by hand is proposed as a change, never
 *    overwritten.
 *
 * Confidence is derived here, from whether the quoted text is actually in the
 * document and appears once — never from the model's opinion of itself, which
 * is not a reliable instrument for this.
 */
import { z } from 'zod'
import {
  type ExtractionBlock,
  type SettingParam,
  SETTING_PARAMS,
  isValidSettingValue,
  paramsOfBlock,
  readSettingValue,
  settingParam,
  withSettingValue,
} from './setting-params.js'
import { type CenterSettings, centerSettingsSchema } from './settings.js'

export type ExtractionConfidence = 'high' | 'medium' | 'low'
export type ExtractionStatus = 'pending' | 'accepted' | 'edited' | 'rejected' | 'not_found'

/**
 * What the model is asked to return, in its own vocabulary. Snake case and
 * `document_id` included because that is the shape the tool schema declares;
 * the document is ours to know, so whatever it says there is overwritten.
 */
export const rawProposalSchema = z.object({
  key: z.string().min(1).max(150),
  proposed_value: z.union([z.number(), z.string(), z.boolean(), z.array(z.unknown())]).nullable(),
  unit: z.string().max(50).nullish(),
  citation: z
    .object({
      document_id: z.union([z.string(), z.number()]).nullish(),
      page: z.number().int().min(1).max(5_000).nullish(),
      section: z.string().max(200).nullish(),
      quote: z.string().max(2_000).nullish(),
    })
    .nullish(),
  reasoning: z.string().max(2_000).nullish(),
  exception_note: z.string().max(2_000).nullish(),
})

export type RawProposal = z.infer<typeof rawProposalSchema>

export interface ProposalCitation {
  documentId: string
  page: number | null
  section: string | null
  quote: string
}

export interface ExtractionProposal {
  key: string
  block: ExtractionBlock
  proposedValue: unknown
  unit: string | null
  currentValue: unknown
  confidence: ExtractionConfidence
  citation: ProposalCitation
  reasoning: string | null
  /** Rule 4: the "except when…" text, kept even when it cannot be modelled. */
  exceptionNote: string | null
  /** The proposal repeats what the center already has: only the citation is new. */
  unchanged: boolean
  /** Rule 5: somebody set this by hand, so this is a change to review. */
  manualOverride: boolean
  status: ExtractionStatus
}

/** A parameter the document does not answer. It keeps its default (rule 2). */
export interface NotFoundParam {
  key: string
  block: ExtractionBlock
  /** Why there is no proposal, in a form the UI can translate. */
  reasonKey: string
}

/** Something the model returned that we refuse to show anybody (rule 2). */
export interface DiscardedProposal {
  key: string
  reason: 'unknownKey' | 'invalidValue' | 'quoteNotInDocument' | 'wrongBlock'
}

export interface ReviewInput {
  block: ExtractionBlock
  documentId: string
  /** The document as it was indexed: a quote has to be findable in it. */
  documentText: string
  current: CenterSettings
  /** Parameters a person set by hand; see rule 5. */
  manualKeys?: readonly string[]
}

export interface ReviewResult {
  proposals: ExtractionProposal[]
  notFound: NotFoundParam[]
  discarded: DiscardedProposal[]
}

/* ────────────────────────────── the reading ─────────────────────────────── */

/** Whitespace and case are noise; everything else has to match. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Confidence, decided by the evidence rather than by the model:
 *
 * - the quote is in the document once → `high`
 * - it is there, but more than once → `medium`: the citation does not point
 *   at one place, so a person should look
 * - only its opening survives (the model trimmed or elided the middle) →
 *   `low`
 * - it is not there at all → nothing. The proposal is discarded, because a
 *   citation that cannot be found is not a citation.
 */
export function deriveConfidence(quote: string, documentText: string): ExtractionConfidence | null {
  const haystack = normalize(documentText)
  const needle = normalize(quote)
  if (needle.length < 8) return null

  const hits = occurrences(haystack, needle)
  if (hits === 1) return 'high'
  if (hits > 1) return 'medium'

  // A partial match still points somewhere real, and the reviewer sees the
  // page. It is offered as weak, never as certain.
  const opening = needle.slice(0, Math.max(24, Math.floor(needle.length * 0.4)))
  return haystack.includes(opening) ? 'low' : null
}

/**
 * Turns what the model returned into what a person may be shown.
 *
 * Anything that does not validate is dropped without comment: a malformed
 * proposal is not worth a message, and showing it would put an unverified
 * number in front of somebody who is about to say yes.
 */
export function reviewProposals(raw: readonly unknown[], input: ReviewInput): ReviewResult {
  const expected = paramsOfBlock(input.block)
  const manual = new Set(input.manualKeys ?? [])
  const proposals: ExtractionProposal[] = []
  const discarded: DiscardedProposal[] = []
  const answered = new Set<string>()
  const uncited = new Map<string, string>()

  for (const entry of raw) {
    const parsed = rawProposalSchema.safeParse(entry)
    if (!parsed.success) continue

    const proposal = parsed.data
    const param = settingParam(proposal.key)
    if (!param) {
      discarded.push({ key: proposal.key, reason: 'unknownKey' })
      continue
    }
    if (param.block !== input.block) {
      discarded.push({ key: proposal.key, reason: 'wrongBlock' })
      continue
    }

    const quote = proposal.citation?.quote?.trim() ?? ''

    // Rule 2, first half: told to return null with a reason rather than
    // invent, and this is where that answer is honoured.
    if (proposal.proposed_value === null || quote.length === 0) {
      uncited.set(proposal.key, quote.length === 0 ? 'noCitation' : 'noValue')
      continue
    }

    if (!isValidSettingValue(input.current, param.key, proposal.proposed_value)) {
      discarded.push({ key: proposal.key, reason: 'invalidValue' })
      continue
    }

    const confidence = deriveConfidence(quote, input.documentText)
    if (!confidence) {
      // The quote is not in the document. Whatever produced it, it is not a
      // reading of this regulation.
      discarded.push({ key: proposal.key, reason: 'quoteNotInDocument' })
      continue
    }

    const currentValue = readSettingValue(input.current, param.key)
    answered.add(param.key)

    proposals.push({
      key: param.key,
      block: param.block,
      proposedValue: proposal.proposed_value,
      unit: proposal.unit?.trim() || param.unit,
      currentValue: currentValue ?? null,
      confidence,
      citation: {
        documentId: input.documentId,
        page: proposal.citation?.page ?? null,
        section: proposal.citation?.section?.trim() || null,
        quote,
      },
      reasoning: proposal.reasoning?.trim() || null,
      exceptionNote: proposal.exception_note?.trim() || null,
      unchanged: JSON.stringify(currentValue ?? null) === JSON.stringify(proposal.proposed_value),
      manualOverride: manual.has(param.key),
      status: 'pending',
    })
  }

  const notFound: NotFoundParam[] = expected
    .filter((param) => !answered.has(param.key))
    .map((param) => ({
      key: param.key,
      block: param.block,
      reasonKey: `settings.extraction.notFound.${uncited.get(param.key) ?? 'absent'}`,
    }))

  return { proposals, notFound, discarded }
}

/* ───────────────────────────── contradictions ───────────────────────────── */

export interface ConflictGroup {
  key: string
  proposals: ExtractionProposal[]
}

/**
 * Rule 3. Two articles that disagree, or a second document that says
 * something else, are both put in front of the administrator with their
 * citations. Choosing silently would hide exactly the thing worth knowing.
 */
export function conflictGroups(proposals: readonly ExtractionProposal[]): ConflictGroup[] {
  const byKey = new Map<string, ExtractionProposal[]>()
  for (const proposal of proposals) {
    byKey.set(proposal.key, [...(byKey.get(proposal.key) ?? []), proposal])
  }

  return [...byKey.entries()]
    .filter(([, group]) => {
      const values = new Set(group.map((entry) => JSON.stringify(entry.proposedValue)))
      return values.size > 1
    })
    .map(([key, group]) => ({ key, proposals: group }))
}

export function hasConflict(
  proposal: ExtractionProposal,
  all: readonly ExtractionProposal[],
): boolean {
  return conflictGroups(all).some((group) => group.key === proposal.key)
}

/**
 * What "accept every high-confidence reading of this block" may touch.
 *
 * Not a contradiction — somebody has to choose — and not something edited by
 * hand, which is a decision this run does not get to reverse. Even here a
 * person clicks: rule 1 is about applying without confirmation, not about how
 * many rows one confirmation may cover.
 */
export function bulkAcceptable(
  proposals: readonly ExtractionProposal[],
  block?: ExtractionBlock,
): ExtractionProposal[] {
  const conflicted = new Set(conflictGroups(proposals).map((group) => group.key))

  return proposals.filter(
    (proposal) =>
      (!block || proposal.block === block) &&
      proposal.status === 'pending' &&
      proposal.confidence === 'high' &&
      !proposal.manualOverride &&
      !conflicted.has(proposal.key),
  )
}

/* ─────────────────────────────── applying ───────────────────────────────── */

export interface Resolution {
  key: string
  status: ExtractionStatus
  /** What the administrator actually settled on, edits included. */
  value: unknown
  citation?: ProposalCitation | null
}

export interface ApplyResult {
  settings: CenterSettings
  /** One row per parameter that carries a citation, for `setting_provenance`. */
  provenance: {
    paramKey: string
    documentId: string
    page: number | null
    section: string | null
    quote: string
  }[]
  applied: string[]
  rejected: string[]
  /** Parameters nobody resolved: they stay as they are, flagged for a human. */
  pending: string[]
}

/**
 * Builds the next configuration from what a person confirmed.
 *
 * Only `accepted` and `edited` change anything. A value that fails the schema
 * is skipped rather than parsed loosely: a configuration is not a place to be
 * forgiving.
 */
export function applyResolutions(
  current: CenterSettings,
  resolutions: readonly Resolution[],
): ApplyResult {
  let next: Record<string, unknown> = structuredClone(current) as Record<string, unknown>
  const provenance: ApplyResult['provenance'] = []
  const applied: string[] = []
  const rejected: string[] = []
  const pending: string[] = []

  for (const resolution of resolutions) {
    if (resolution.status === 'rejected') {
      rejected.push(resolution.key)
      continue
    }
    if (resolution.status === 'pending' || resolution.status === 'not_found') {
      pending.push(resolution.key)
      continue
    }
    if (!settingParam(resolution.key)) continue

    const candidate = withSettingValue(next as CenterSettings, resolution.key, resolution.value)
    const parsed = centerSettingsSchema.safeParse(candidate)
    if (!parsed.success) {
      rejected.push(resolution.key)
      continue
    }

    next = parsed.data as unknown as Record<string, unknown>
    applied.push(resolution.key)

    // An edited value keeps the citation that led to it: the article is still
    // why the parameter is roughly this, even if the person adjusted it.
    if (resolution.citation) {
      provenance.push({
        paramKey: resolution.key,
        documentId: resolution.citation.documentId,
        page: resolution.citation.page,
        section: resolution.citation.section,
        quote: resolution.citation.quote,
      })
    }
  }

  return {
    settings: centerSettingsSchema.parse(next),
    provenance,
    applied,
    rejected,
    pending,
  }
}

/* ────────────────────────────────── diff ────────────────────────────────── */

export interface SettingChange {
  key: string
  before: unknown
  after: unknown
}

/**
 * What a new version of the regulation actually changes.
 *
 * Re-reading a document should not produce a form to fill in again. The
 * administrator gets the short list: this article used to say 240, it now
 * says 250.
 */
export function diffSettings(
  before: CenterSettings,
  after: CenterSettings,
  keys: readonly string[] = SETTING_PARAMS.map((param) => param.key),
): SettingChange[] {
  const changes: SettingChange[] = []

  for (const key of keys) {
    const from = readSettingValue(before, key) ?? null
    const to = readSettingValue(after, key) ?? null
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ key, before: from, after: to })
  }

  return changes
}

/** Only the proposals that would actually change something. */
export function changingProposals(proposals: readonly ExtractionProposal[]): ExtractionProposal[] {
  return proposals.filter((proposal) => !proposal.unchanged)
}

export interface ExtractionSummary {
  applied: string[]
  rejected: string[]
  /** Still to be configured by hand, with a reason each. */
  pending: NotFoundParam[]
  conflicts: string[]
}

export function summarize(
  resolutions: readonly Resolution[],
  notFound: readonly NotFoundParam[],
  proposals: readonly ExtractionProposal[],
): ExtractionSummary {
  return {
    applied: resolutions
      .filter((entry) => entry.status === 'accepted' || entry.status === 'edited')
      .map((entry) => entry.key),
    rejected: resolutions.filter((entry) => entry.status === 'rejected').map((entry) => entry.key),
    pending: [...notFound],
    conflicts: conflictGroups(proposals).map((group) => group.key),
  }
}

/* ─────────────────────── the walk back from a rule ──────────────────────── */

/**
 * The reverse link, and the reason the whole phase exists: which parameter is
 * behind a constraint that just blocked somebody. From the parameter, the
 * provenance row gives the article, and the article gives the page.
 */
export const CONSTRAINT_PARAMS: Record<string, readonly string[]> = {
  teacherCapacity: ['load.maxOverloadPercent', 'capacity.maxTeachingHoursYear'],
  teacherUnavailable: ['schedule.workingWeekdays'],
  teacherOverlap: [],
  groupOverlap: [],
  spaceOverlap: [],
  spaceCapacity: [],
  spaceEquipment: [],
  consecutiveHours: ['schedule.maxConsecutiveHours'],
  buildingChange: ['schedule.buildingTransferMinutes'],
  avoidSlot: ['engine.allowAvoidSlots'],
  teacherGaps: ['engine.weights.teacherGaps'],
  singleSessionDay: ['engine.weights.singleSessionDay'],
  weeklySpread: ['engine.weights.weeklySpread'],
  dailyHours: ['schedule.maxDailyHours'],
  sessionLength: ['schedule.defaultSessionMinutes'],
  changeNotice: ['workflow.changeRequestNoticeDays'],
}

export function paramsForConstraint(constraint: string): readonly string[] {
  return CONSTRAINT_PARAMS[constraint] ?? []
}

/**
 * The same question asked from a message key: the UI has
 * `planner.hard.teacherCapacity` in hand, not the bare constraint name.
 */
export function paramsForMessageKey(messageKey: string): readonly string[] {
  return paramsForConstraint(messageKey.split('.').at(-1) ?? '')
}

export type { SettingParam }
