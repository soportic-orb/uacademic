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
})

export const workflowSettingsSchema = z.object({
  coordinatorApprovesChanges: z.boolean().default(true),
  teacherCanProposeSwap: z.boolean().default(true),
  changeRequestNoticeDays: z.number().int().min(0).max(90).default(7),
  autoNotifyAffectedTeachers: z.boolean().default(true),
})

/** Weights of the schedule engine. Higher means the criterion pulls harder. */
export const engineSettingsSchema = z.object({
  weights: z
    .object({
      availabilityPreference: z.number().min(0).max(10).default(5),
      compactness: z.number().min(0).max(10).default(3),
      spaceFit: z.number().min(0).max(10).default(2),
      loadBalance: z.number().min(0).max(10).default(4),
      teacherContinuity: z.number().min(0).max(10).default(3),
    })
    .prefault({}),
  allowAvoidSlots: z.boolean().default(true),
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
})

export type CenterSettings = z.infer<typeof centerSettingsSchema>
export type LoadSettings = z.infer<typeof loadSettingsSchema>
export type ScheduleSettings = z.infer<typeof scheduleSettingsSchema>
export type IdentitySettings = z.infer<typeof identitySettingsSchema>

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
