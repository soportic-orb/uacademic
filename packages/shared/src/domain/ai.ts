/**
 * What the assistant is allowed to do, and what it is never allowed to do.
 *
 * The catalog lives here rather than in the API because three parties have to
 * agree on it: the API that executes the tools, the UI that renders a proposal
 * before anybody confirms it, and the tests. Two rules shape everything:
 *
 *   R5 — a write tool **returns a proposal**. It never writes. Execution
 *   happens after an explicit human confirmation, and is recorded.
 *   The privacy rule — the context sent to the model carries internal
 *   identifiers, names and hours. Never an identity document, a phone number,
 *   a postal address or anything about somebody's health.
 */
import { z } from 'zod'

export type AiToolKind = 'read' | 'write'

export interface AiToolDefinition {
  name: string
  kind: AiToolKind
  /** i18n key under `assistant.tools.` for the label shown in the UI. */
  labelKey: string
  /** Sent to the model. English, because that is what it reasons in. */
  description: string
  schema: z.ZodType
}

/* ─────────────────────────── read tools ─────────────────────────── */

const teacherRef = z.object({
  teacherProfileId: z.string().min(1).optional(),
  teacherName: z.string().min(1).optional(),
})

export const READ_TOOL_SCHEMAS = {
  get_teacher_workload: teacherRef.extend({
    /** Optional term, to answer "this semester" rather than the whole year. */
    term: z.enum(['annual', 'first', 'second']).optional(),
  }),
  get_teacher_availability: teacherRef,
  get_subject_schedule: z.object({
    subjectId: z.string().min(1).optional(),
    subjectCode: z.string().min(1).optional(),
  }),
  list_conflicts: z.object({
    /** Without a session, the whole published week is checked. */
    sessionId: z.string().min(1).optional(),
    /** A hypothetical placement, which is what "why can't I?" really asks. */
    weekday: z.number().int().min(1).max(7).optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    spaceId: z.string().min(1).optional(),
    teacherProfileId: z.string().min(1).optional(),
  }),
  get_space_occupancy: z.object({
    spaceId: z.string().min(1).optional(),
    weekday: z.number().int().min(1).max(7).optional(),
  }),
  get_change_history: z.object({
    entity: z.enum(['change_request', 'class_session', 'absence', 'assignment']).optional(),
    days: z.number().int().min(1).max(365).optional(),
  }),
  find_eligible_substitutes: z.object({
    sessionId: z.string().min(1).optional(),
    teacherProfileId: z.string().min(1).optional(),
    /** A date the teacher is away, which is what a coordinator actually says. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
} as const

/* ─────────────────────────── write tools ─────────────────────────── */

export const WRITE_TOOL_SCHEMAS = {
  propose_schedule: z.object({
    subjectId: z.string().min(1).optional(),
    subjectCode: z.string().min(1).optional(),
    /** Free text the coordinator added: "mornings only", "not on Fridays". */
    notes: z.string().max(500).optional(),
  }),
  assign_teacher_to_group: z.object({
    groupId: z.string().min(1),
    teacherProfileId: z.string().min(1),
    hours: z.number().min(0).max(1000).optional(),
  }),
  move_session: z.object({
    sessionId: z.string().min(1),
    weekday: z.number().int().min(1).max(7).optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    spaceId: z.string().min(1).nullable().optional(),
    teacherProfileId: z.string().min(1).nullable().optional(),
  }),
  rebalance_workload: z.object({
    /** Whose load to relieve. Empty means "whoever is over the limit". */
    teacherProfileIds: z.array(z.string().min(1)).max(20).optional(),
    subjectId: z.string().min(1).optional(),
  }),
  /**
   * A timetable read out of a document the coordinator attached.
   *
   * Rows carry what the *document* says — a group code, a teacher's name, a
   * room's name — never identifiers, because the model has none to give. The
   * server resolves each one against the center's own data and refuses
   * anything it cannot match, which is what stops a plausible-looking
   * invention becoming a class.
   */
  import_schedule: z.object({
    rows: z
      .array(
        z.object({
          /** `YYYY-MM-DD`. Every class is placed on a day of its own. */
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          /** As written in the document: "MAT101 T1", "Grup A", "T1". */
          group: z.string().min(1).max(120),
          subject: z.string().max(120).optional(),
          teacher: z.string().max(160).optional(),
          space: z.string().max(120).optional(),
          topic: z.string().max(200).optional(),
        }),
      )
      .min(1)
      .max(400),
    /** Which draft to add them to. The editable one, if this is left out. */
    versionId: z.string().min(1).optional(),
  }),
  draft_announcement: z.object({
    subjectId: z.string().min(1).optional(),
    audience: z.enum(['center', 'subject']).default('subject'),
    topic: z.string().min(3).max(500),
  }),
} as const

export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'get_teacher_workload',
    kind: 'read',
    labelKey: 'assistant.tools.get_teacher_workload',
    description:
      'Contracted hours, approved reductions, assigned hours and the resulting load ratio for one teacher. Identify the teacher by teacherProfileId when you have it, or by teacherName.',
    schema: READ_TOOL_SCHEMAS.get_teacher_workload,
  },
  {
    name: 'get_teacher_availability',
    kind: 'read',
    labelKey: 'assistant.tools.get_teacher_availability',
    description:
      "One teacher's weekly availability grid: which slots are preferred, available, better avoided or unavailable, plus dated exceptions.",
    schema: READ_TOOL_SCHEMAS.get_teacher_availability,
  },
  {
    name: 'get_subject_schedule',
    kind: 'read',
    labelKey: 'assistant.tools.get_subject_schedule',
    description:
      'The published sessions of a subject: groups, weekday, times, room and teacher. Use it before proposing any change to a subject.',
    schema: READ_TOOL_SCHEMAS.get_subject_schedule,
  },
  {
    name: 'list_conflicts',
    kind: 'read',
    labelKey: 'assistant.tools.list_conflicts',
    description:
      'Hard-constraint violations in the published week. Pass sessionId together with weekday/startTime/spaceId/teacherProfileId to ask whether a hypothetical placement would be legal — that is how to answer "why can I not put this class here?".',
    schema: READ_TOOL_SCHEMAS.list_conflicts,
  },
  {
    name: 'get_space_occupancy',
    kind: 'read',
    labelKey: 'assistant.tools.get_space_occupancy',
    description: 'Which rooms are busy in which slots, and which are free.',
    schema: READ_TOOL_SCHEMAS.get_space_occupancy,
  },
  {
    name: 'get_change_history',
    kind: 'read',
    labelKey: 'assistant.tools.get_change_history',
    description:
      'Recent recorded changes: who changed what, when, and whether it was a person, the assistant or the system.',
    schema: READ_TOOL_SCHEMAS.get_change_history,
  },
  {
    name: 'find_eligible_substitutes',
    kind: 'read',
    labelKey: 'assistant.tools.find_eligible_substitutes',
    description:
      'Who could cover a class, ranked, with the reason for each and the blocker for those who cannot. Pass a sessionId, or a teacherProfileId and a date to cover everything that teacher has that day.',
    schema: READ_TOOL_SCHEMAS.find_eligible_substitutes,
  },
  {
    name: 'propose_schedule',
    kind: 'write',
    labelKey: 'assistant.tools.propose_schedule',
    description:
      'Produce a timetable proposal for a subject, respecting availability and every hard constraint. Returns a proposal for the coordinator to review; it changes nothing by itself.',
    schema: WRITE_TOOL_SCHEMAS.propose_schedule,
  },
  {
    name: 'assign_teacher_to_group',
    kind: 'write',
    labelKey: 'assistant.tools.assign_teacher_to_group',
    description:
      'Propose assigning a teacher to a group. Returns a proposal with the resulting load; it changes nothing by itself.',
    schema: WRITE_TOOL_SCHEMAS.assign_teacher_to_group,
  },
  {
    name: 'move_session',
    kind: 'write',
    labelKey: 'assistant.tools.move_session',
    description:
      'Propose moving a class to another slot, room or teacher. Returns a proposal with the conflicts it would cause, if any; it changes nothing by itself.',
    schema: WRITE_TOOL_SCHEMAS.move_session,
  },
  {
    name: 'rebalance_workload',
    kind: 'write',
    labelKey: 'assistant.tools.rebalance_workload',
    description:
      'Propose moving assignments from overloaded teachers to colleagues with headroom and the right competence. Returns a proposal; it changes nothing by itself.',
    schema: WRITE_TOOL_SCHEMAS.rebalance_workload,
  },
  {
    name: 'import_schedule',
    kind: 'write',
    labelKey: 'assistant.tools.import_schedule',
    description:
      'Propose adding classes read out of an attached document to the planner. Give one row per class, with the date, the times and the names exactly as the document writes them; the server matches them to this center and refuses what it cannot match. Ask the coordinator about anything ambiguous BEFORE calling this — a wrong mapping is worse than a question. Returns a proposal; it changes nothing by itself.',
    schema: WRITE_TOOL_SCHEMAS.import_schedule,
  },
  {
    name: 'draft_announcement',
    kind: 'write',
    labelKey: 'assistant.tools.draft_announcement',
    description:
      'Draft an announcement for a subject group or the center channel. Returns the draft as a proposal; nothing is sent until it is confirmed.',
    schema: WRITE_TOOL_SCHEMAS.draft_announcement,
  },
]

export function aiTool(name: string): AiToolDefinition | undefined {
  return AI_TOOLS.find((tool) => tool.name === name)
}

export function isWriteTool(name: string): boolean {
  return aiTool(name)?.kind === 'write'
}

export const AI_READ_TOOLS = AI_TOOLS.filter((tool) => tool.kind === 'read')
export const AI_WRITE_TOOLS = AI_TOOLS.filter((tool) => tool.kind === 'write')

/* ─────────────────────────── proposals ─────────────────────────── */

export type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'failed'

/** A single change a proposal would make, as the preview renders it. */
export interface ProposalChange {
  entity: 'class_session' | 'assignment' | 'message'
  entityId: string | null
  label: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface AiProposal {
  tool: string
  summary: string
  changes: ProposalChange[]
  /** Hard-constraint violations the change would cause, if any. */
  violations: { messageKey: string; params: Record<string, string | number> }[]
  /** Soft-constraint costs, so a coordinator sees what is being traded away. */
  warnings: { messageKey: string; params: Record<string, string | number> }[]
}

/**
 * A proposal with violations is still shown — a coordinator may be entitled to
 * know exactly what is impossible — but it cannot be confirmed. The rule lives
 * here so the button and the endpoint agree on it.
 */
export function isConfirmable(proposal: AiProposal): boolean {
  return proposal.changes.length > 0 && proposal.violations.length === 0
}

/* ─────────────────────────── budget ─────────────────────────── */

export type BudgetLevel = 'ok' | 'warning' | 'exceeded'

export interface BudgetStatus {
  usedTokens: number
  budgetTokens: number
  percent: number
  level: BudgetLevel
}

/**
 * Where a center stands against its monthly allowance. The warning threshold
 * is configurable (R9) and defaults to 80%: the point of an alert is to arrive
 * before the assistant stops answering, not with it.
 */
export function budgetStatus(
  usedTokens: number,
  budgetTokens: number,
  warningPercent = 80,
): BudgetStatus {
  if (budgetTokens <= 0) {
    return { usedTokens, budgetTokens, percent: 0, level: 'ok' }
  }

  const ratio = (usedTokens / budgetTokens) * 100
  // The level reads the exact ratio, not the rounded one shown on screen:
  // 99.9999% is not "exceeded", however it displays.
  const percent = Math.round(ratio * 10) / 10

  return {
    usedTokens,
    budgetTokens,
    percent,
    level: ratio >= 100 ? 'exceeded' : ratio >= warningPercent ? 'warning' : 'ok',
  }
}

/* ─────────────────────────── privacy ─────────────────────────── */

/**
 * Fields that must never leave for the model, whatever the shape they arrive
 * in. Names and internal identifiers are fine — they are what makes an answer
 * useful — but an identity document, a phone number, an address or anything
 * medical is not the assistant's business.
 */
export const FORBIDDEN_CONTEXT_KEYS: readonly string[] = [
  'dni',
  'nif',
  'nie',
  'passport',
  'passportNumber',
  'nationalId',
  'idNumber',
  'taxId',
  'ssn',
  'socialSecurity',
  'phone',
  'phoneNumber',
  'mobile',
  'address',
  'street',
  'postalCode',
  'zip',
  'city',
  'birthDate',
  'dateOfBirth',
  'iban',
  'bankAccount',
  'salary',
  'health',
  'medicalReason',
  'diagnosis',
  'sickNote',
  'password',
  'passwordHash',
  'totpSecret',
  'accessToken',
  'refreshToken',
  'accessTokenEnc',
  'refreshTokenEnc',
]

function isForbiddenKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, '')
  return FORBIDDEN_CONTEXT_KEYS.some(
    (forbidden) => normalised === forbidden.toLowerCase().replace(/[^a-z]/g, ''),
  )
}

/**
 * Strips the fields above from anything on its way to the model.
 *
 * It is a belt on top of braces: every context builder selects its columns
 * explicitly, and this catches the day somebody adds a `phone` to a `select`
 * and forgets what it is feeding.
 */
export function minimizeForModel<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => minimizeForModel(entry)) as unknown as T
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(key)) continue
      out[key] = minimizeForModel(entry)
    }
    return out as T
  }

  return value
}

/** Every forbidden field found in a payload, by path. Used by the tests. */
export function findPersonalData(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findPersonalData(entry, `${path}[${index}]`))
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const where = path ? `${path}.${key}` : key
      return isForbiddenKey(key) ? [where] : findPersonalData(entry, where)
    })
  }

  return []
}
