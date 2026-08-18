/**
 * Center business parameters (R9): configurable, never hardcoded.
 *
 * The shape lives here so that the API, the web app and the AI extraction
 * pipeline all validate against the same schema, and every parameter has a
 * stable dot-path key that `setting_provenance` can point at — which is what
 * makes "why does this rule block me?" answerable with a citation.
 */
import { z } from 'zod'

import { type ClockTime, isClockTime } from './time.js'

const clockTime = z.string().refine(isClockTime, {
  message: 'Expected a HH:MM 24-hour time',
})

const percentage = z.number().min(0).max(500)

export const loadSettingsSchema = z.object({
  thresholds: z
    .object({
      underBelow: percentage.default(85),
      optimalUpTo: percentage.default(100),
      limitUpTo: percentage.default(110),
    })
    .prefault({}),
  /** Hard ceiling: the planner refuses assignments beyond this percentage. */
  maxOverloadPercent: percentage.default(120),
  countReductionsInCapacity: z.boolean().default(true),
})

export const scheduleSettingsSchema = z.object({
  dayStart: clockTime.default('08:00'),
  dayEnd: clockTime.default('21:00'),
  /** Planner grid granularity, in minutes. */
  slotMinutes: z.number().int().min(5).max(120).default(30),
  defaultSessionMinutes: z.number().int().min(15).max(480).default(60),
  minBreakMinutes: z.number().int().min(0).max(240).default(30),
  maxConsecutiveHours: z.number().min(1).max(12).default(4),
  maxDailyHours: z.number().min(1).max(14).default(8),
  workingWeekdays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]),
  /**
   * Teaching weeks in the year. The planner reasons about a typical week, so
   * this is what turns annual contracted hours into a weekly ceiling.
   */
  teachingWeeks: z.number().int().min(1).max(52).default(30),
})

export const workflowSettingsSchema = z.object({
  /** False means coordination is only informed: the approval step is skipped. */
  coordinatorApprovesChanges: z.boolean().default(true),
  teacherCanProposeSwap: z.boolean().default(true),
  changeRequestNoticeDays: z.number().int().min(0).max(90).default(7),
  /** Hours before an unanswered change request expires. Zero disables it. */
  changeRequestExpiryHours: z.number().int().min(0).max(720).default(72),
  /** Whether an approved change is written into the timetable automatically. */
  autoApplyApprovedChanges: z.boolean().default(true),
  autoNotifyAffectedTeachers: z.boolean().default(true),
})

/**
 * How a class reads once it has left UAcademic: in an ICS subscription, in
 * Outlook, in Google Calendar. Templates rather than hardcoded strings because
 * every center names its groups differently (R9).
 */
export const calendarSettingsSchema = z.object({
  /** Title of a calendar event. Placeholders in `CALENDAR_TEMPLATE_KEYS`. */
  summaryTemplate: z.string().min(1).max(200).default('{{subjectCode}} {{groupCode}}'),
  locationTemplate: z.string().max(200).default('{{building}} · {{spaceName}}'),
  /** Hint clients honour when deciding how often to re-read the feed. */
  feedRefreshMinutes: z.number().int().min(5).max(1440).default(60),
  /** Whether a feed shows the other teachers of the subjects one teaches. */
  feedIncludeColleagues: z.boolean().default(false),
  /** How long a cancelled class keeps being announced as cancelled. */
  tombstoneDays: z.number().int().min(1).max(365).default(60),
  /** Retention of imported free/busy time. Short on purpose: no history. */
  busyRetentionDays: z.number().int().min(1).max(90).default(21),
  /** Weeks a personal commitment has to repeat before the planner avoids it. */
  busyMinOccurrences: z.number().int().min(1).max(10).default(2),
})

/** Notification policy of the center; each user narrows it further (R9). */
export const notificationSettingsSchema = z.object({
  /** Whether low-priority events may be collected into one daily email. */
  dailyDigest: z.boolean().default(true),
  /** Center-local hour the digest is sent at. */
  digestHour: z.number().int().min(0).max(23).default(8),
  /** Quiet hours for push, center-local. Equal values disable them. */
  quietHoursFrom: clockTime.default('22:00'),
  quietHoursTo: clockTime.default('07:00'),
})

/**
 * The document library the assistant reads from (R9): how much a center may
 * store, how a file is cut up, and how much of it is handed to the model
 * whole before retrieval takes over.
 */
export const documentSettingsSchema = z.object({
  /** Total storage one center may use, in megabytes. */
  quotaMb: z.number().int().min(1).max(100_000).default(2_000),
  maxFileMb: z.number().int().min(1).max(200).default(25),
  chunkTokens: z.number().int().min(200).max(4_000).default(800),
  chunkOverlapTokens: z.number().int().min(0).max(1_000).default(100),
  /**
   * Below this many tokens the relevant documents go into the context whole,
   * with prompt caching, instead of being retrieved in fragments. A teaching
   * plan is 15-30 pages; retrieval is for the day a center has hundreds.
   */
  injectionTokenBudget: z.number().int().min(10_000).max(900_000).default(150_000),
  /** How many fragments a retrieval hands to the model when it does run. */
  retrievalChunks: z.number().int().min(3).max(50).default(12),
  /** Days ahead the UI starts warning that a document is about to expire. */
  expiryWarningDays: z.number().int().min(1).max(365).default(45),
  /**
   * Whether a scanned PDF may be read with the model's vision. It costs real
   * money per page, so the center opts in and the person is told first.
   */
  allowVisionOcr: z.boolean().default(true),
  visionOcrMaxPages: z.number().int().min(1).max(200).default(40),
})

/**
 * The assistant (R5, R9). Off until a center turns it on, capped by a token
 * budget it cannot exceed, and warning before it gets there rather than after.
 */
export const aiSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Tokens per calendar month. Zero means no ceiling. */
  monthlyTokenBudget: z.number().int().min(0).max(100_000_000).default(2_000_000),
  /** Percentage of the budget at which the center is warned. */
  alertThresholdPercent: z.number().int().min(1).max(99).default(80),
  /** How many tool round-trips one question may take before it is cut off. */
  maxToolIterations: z.number().int().min(1).max(20).default(8),
  /** Cap per answer, so one runaway question cannot spend a month's budget. */
  maxOutputTokens: z.number().int().min(256).max(64_000).default(8_000),
})

/**
 * Weights of the schedule engine: one per soft constraint, so a center that
 * cares more about avoiding gaps than about buildings just raises a number.
 * Higher means the criterion pulls harder; zero switches it off.
 */
export const engineSettingsSchema = z.object({
  weights: z
    .object({
      /** Using a slot the teacher marked "better avoided". */
      avoidSlot: z.number().min(0).max(10).default(5),
      /** Idle hours between two classes of the same teacher on one day. */
      teacherGaps: z.number().min(0).max(10).default(4),
      /** A day where a teacher comes in for a single session. */
      singleSessionDay: z.number().min(0).max(10).default(3),
      /** Moving building between consecutive sessions. */
      buildingChange: z.number().min(0).max(10).default(2),
      /** Teaching beyond `schedule.maxConsecutiveHours` without a break. */
      consecutiveHours: z.number().min(0).max(10).default(4),
      /** A group's sessions bunched into few days instead of spread out. */
      weeklySpread: z.number().min(0).max(10).default(2),
    })
    .prefault({}),
  allowAvoidSlots: z.boolean().default(true),
  /** Seconds the automatic generation may run before returning its best. */
  timeBudgetSeconds: z.number().int().min(5).max(300).default(60),
  /** How many proposals the generator returns. */
  proposals: z.number().int().min(1).max(5).default(3),
})

export const formatSettingsSchema = z.object({
  /** ISO weekday the calendar starts on. Monday everywhere, by convention. */
  firstDayOfWeek: z.number().int().min(1).max(7).default(1),
  timeFormat: z.enum(['24h', '12h']).default('24h'),
  decimalHours: z.boolean().default(true),
})

/**
 * Just-in-time provisioning (R3/R9): whether a person who signs in from a
 * registered tenant gets an account automatically, and under what conditions.
 * Off by default — a center opts in deliberately.
 */
export const identitySettingsSchema = z.object({
  jitProvisioning: z.boolean().default(false),
  /** Empty means "any domain of the tenant this center is bound to". */
  allowedEmailDomains: z.array(z.string().min(3)).default([]),
  defaultRole: z.literal('TEACHER').default('TEACHER'),
  /** When true, the account lands in `pending_activation` and must be approved. */
  requireActivation: z.boolean().default(true),
})

export const centerSettingsSchema = z.object({
  // `prefault` (not `default`) so the nested defaults are actually applied:
  // in Zod 4 a plain default value is returned as-is, without being parsed.
  load: loadSettingsSchema.prefault({}),
  schedule: scheduleSettingsSchema.prefault({}),
  workflow: workflowSettingsSchema.prefault({}),
  engine: engineSettingsSchema.prefault({}),
  formats: formatSettingsSchema.prefault({}),
  identity: identitySettingsSchema.prefault({}),
  notifications: notificationSettingsSchema.prefault({}),
  calendar: calendarSettingsSchema.prefault({}),
  ai: aiSettingsSchema.prefault({}),
  documents: documentSettingsSchema.prefault({}),
})

export type CenterSettings = z.infer<typeof centerSettingsSchema>
export type LoadSettings = z.infer<typeof loadSettingsSchema>
export type ScheduleSettings = z.infer<typeof scheduleSettingsSchema>
export type IdentitySettings = z.infer<typeof identitySettingsSchema>
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>
export type AiSettings = z.infer<typeof aiSettingsSchema>
export type DocumentSettings = z.infer<typeof documentSettingsSchema>
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>

export const defaultCenterSettings: CenterSettings = centerSettingsSchema.parse({})

/**
 * Parses stored settings, filling in every missing parameter with its default.
 * A center that has never been configured still gets a complete, valid object.
 */
export function parseCenterSettings(value: unknown): CenterSettings {
  return centerSettingsSchema.parse(value ?? {})
}

export function safeParseCenterSettings(value: unknown) {
  return centerSettingsSchema.safeParse(value ?? {})
}

export type SettingValue = string | number | boolean | (string | number)[]

/** Flattens settings to dot-path keys: `load.thresholds.underBelow`. */
export function flattenSettings(
  settings: CenterSettings | Record<string, unknown>,
  prefix = '',
): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {}
  for (const [key, value] of Object.entries(settings)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(value)) {
      out[path] = value as (string | number)[]
    } else if (value !== null && typeof value === 'object') {
      Object.assign(out, flattenSettings(value as Record<string, unknown>, path))
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[path] = value
    }
  }
  return out
}

/**
 * Every configurable parameter, as the dot-path keys used by
 * `setting_extractions.param_key` and `setting_provenance.param_key`.
 */
export const SETTING_PARAM_KEYS: readonly string[] = Object.keys(
  flattenSettings(defaultCenterSettings),
).sort()

export function isSettingParamKey(key: string): boolean {
  return SETTING_PARAM_KEYS.includes(key)
}

export function getSettingValue(
  settings: CenterSettings,
  paramKey: string,
): SettingValue | undefined {
  return flattenSettings(settings)[paramKey]
}

/** Where a parameter came from, so any blocking rule can be explained. */
export const settingProvenanceSchema = z.object({
  paramKey: z.string().min(1),
  documentId: z.uuid().nullable().default(null),
  page: z.number().int().min(1).nullable().default(null),
  section: z.string().max(200).nullable().default(null),
  quote: z.string().max(2000).nullable().default(null),
})

export type SettingProvenance = z.infer<typeof settingProvenanceSchema>

export interface ScheduleWindow {
  dayStart: ClockTime
  dayEnd: ClockTime
  slotMinutes: number
}

export function scheduleWindow(settings: CenterSettings): ScheduleWindow {
  return {
    dayStart: settings.schedule.dayStart,
    dayEnd: settings.schedule.dayEnd,
    slotMinutes: settings.schedule.slotMinutes,
  }
}
