/**
 * The catalogue of configurable parameters: what a regulation is read for.
 *
 * It exists twice over. It is the list the assistant is asked to look for,
 * block by block, and it is the list the interface renders — in plain
 * language, never as a dot-path, because the person confirming "240 hours a
 * year" should not have to know it is called `capacity.maxTeachingHoursYear`.
 *
 * A parameter's *shape* is not repeated here: values are validated by setting
 * them into the center settings and parsing that with `centerSettingsSchema`,
 * so there is one source of truth for what is legal (R6).
 */
import {
  type CenterSettings,
  type SettingValue,
  centerSettingsSchema,
  flattenSettings,
} from './settings.js'

/**
 * Extraction runs one block at a time: better precision than one giant call,
 * and a failure that costs one block rather than the whole document.
 */
export const EXTRACTION_BLOCKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const
export type ExtractionBlock = (typeof EXTRACTION_BLOCKS)[number]

/** How a value is edited and displayed. Not a validation rule — see above. */
export type SettingKind =
  | 'hours'
  | 'number'
  | 'integer'
  | 'percent'
  | 'boolean'
  | 'time'
  | 'date'
  | 'weekdays'
  | 'collection'

export interface SettingParam {
  /** Dot path into the settings object, and the key `setting_provenance` uses. */
  key: string
  block: ExtractionBlock
  kind: SettingKind
  /** Shown next to the figure; also told to the model so it does not convert. */
  unit: string | null
}

function param(key: string, block: ExtractionBlock, kind: SettingKind, unit: string | null) {
  return { key, block, kind, unit } satisfies SettingParam
}

export const SETTING_PARAMS: readonly SettingParam[] = [
  // A · capacity and teaching commitment
  param('capacity.maxTeachingHoursYear', 'A', 'hours', 'hours/year'),
  param('capacity.referenceFullTimeHours', 'A', 'hours', 'hours/year'),
  param('capacity.minTeachingHoursYear', 'A', 'hours', 'hours/year'),
  param('capacity.creditToHours', 'A', 'number', 'hours/credit'),
  param('capacity.hoursPerGroupType.theory', 'A', 'number', 'factor'),
  param('capacity.hoursPerGroupType.seminar', 'A', 'number', 'factor'),
  param('capacity.hoursPerGroupType.lab', 'A', 'number', 'factor'),
  param('capacity.hoursPerGroupType.practicum', 'A', 'number', 'factor'),
  param('capacity.hoursPerGroupType.tutoring', 'A', 'number', 'factor'),

  // B · contractual categories
  param('categories', 'B', 'collection', null),

  // C · recognised reductions
  param('reductions', 'C', 'collection', null),

  // D · the load traffic light
  param('load.thresholds.underBelow', 'D', 'percent', '%'),
  param('load.thresholds.optimalUpTo', 'D', 'percent', '%'),
  param('load.thresholds.limitUpTo', 'D', 'percent', '%'),
  param('load.maxOverloadPercent', 'D', 'percent', '%'),

  // E · timetable rules
  param('schedule.defaultSessionMinutes', 'E', 'integer', 'minutes'),
  param('schedule.dayStart', 'E', 'time', null),
  param('schedule.dayEnd', 'E', 'time', null),
  param('schedule.minBreakMinutes', 'E', 'integer', 'minutes'),
  param('schedule.maxConsecutiveHours', 'E', 'hours', 'hours'),
  param('schedule.maxDailyHours', 'E', 'hours', 'hours'),
  param('schedule.maxWeeklyDays', 'E', 'integer', 'days/week'),
  param('schedule.buildingTransferMinutes', 'E', 'integer', 'minutes'),
  param('schedule.workingWeekdays', 'E', 'weekdays', null),

  // F · what else counts as commitment
  param('workload.tfgHoursPerStudent', 'F', 'hours', 'hours/student'),
  param('workload.tfgMaxHours', 'F', 'hours', 'hours/year'),
  param('workload.tfmHoursPerStudent', 'F', 'hours', 'hours/student'),
  param('workload.tfmMaxHours', 'F', 'hours', 'hours/year'),
  param('workload.weeklyTutoringHours', 'F', 'hours', 'hours/week'),
  param('workload.tutoringProportionalToDedication', 'F', 'boolean', null),
  param('workload.degreeCoordinationHours', 'F', 'hours', 'hours/year'),
  param('workload.subjectCoordinationHours', 'F', 'hours', 'hours/year'),
  param('workload.externalPracticeHoursPerStudent', 'F', 'hours', 'hours/student'),
  param('workload.externalPracticeMaxHours', 'F', 'hours', 'hours/year'),

  // G · the academic year
  param('academicCalendar.firstSemesterStart', 'G', 'date', null),
  param('academicCalendar.firstSemesterEnd', 'G', 'date', null),
  param('academicCalendar.secondSemesterStart', 'G', 'date', null),
  param('academicCalendar.secondSemesterEnd', 'G', 'date', null),
  param('academicCalendar.examPeriods', 'G', 'collection', null),
  param('academicCalendar.holidays', 'G', 'collection', null),
  param('schedule.teachingWeeks', 'G', 'integer', 'weeks'),

  // H · process rules
  param('workflow.podPublicationDate', 'H', 'date', null),
  param('workflow.changeRequestNoticeDays', 'H', 'integer', 'days'),
  param('workflow.coordinatorApprovesChanges', 'H', 'boolean', null),
]

const BY_KEY = new Map(SETTING_PARAMS.map((entry) => [entry.key, entry]))

export function settingParam(key: string): SettingParam | undefined {
  return BY_KEY.get(key)
}

export function paramsOfBlock(block: ExtractionBlock): SettingParam[] {
  return SETTING_PARAMS.filter((entry) => entry.block === block)
}

/** Plain-language name, never the dot path (the wizard shows this one). */
export function paramLabelKey(key: string): string {
  return `settings.params.${key}.label`
}

export function paramHelpKey(key: string): string {
  return `settings.params.${key}.help`
}

export function blockLabelKey(block: ExtractionBlock): string {
  return `settings.blocks.${block}.label`
}

export function blockHelpKey(block: ExtractionBlock): string {
  return `settings.blocks.${block}.help`
}

/* ──────────────────────── reading and writing by path ──────────────────── */

/**
 * Reads a parameter, including the collections — which `flattenSettings` does
 * not carry, because a list of categories is not a scalar.
 */
export function readSettingValue(settings: CenterSettings, key: string): unknown {
  let current: unknown = settings
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** A copy of `settings` with one parameter replaced. Never mutates the input. */
export function withSettingValue(
  settings: CenterSettings,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const clone = structuredClone(settings) as Record<string, unknown>
  const parts = key.split('.')
  let cursor: Record<string, unknown> = clone

  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (next === null || typeof next !== 'object') return clone
    cursor = next as Record<string, unknown>
  }

  cursor[parts.at(-1) as string] = value
  return clone
}

/**
 * Whether a value is legal for a parameter — decided by the settings schema
 * itself, so this can never drift from what the platform accepts.
 */
export function isValidSettingValue(
  settings: CenterSettings,
  key: string,
  value: unknown,
): boolean {
  if (!BY_KEY.has(key)) return false
  return centerSettingsSchema.safeParse(withSettingValue(settings, key, value)).success
}

/**
 * Parameters a person set by hand: they carry a value that is not the default
 * and no citation backs it. R5 of phase 5C — an extraction proposes a change
 * to these, it never overwrites them.
 */
export function manuallyEditedKeys(
  settings: CenterSettings,
  defaults: CenterSettings,
  citedKeys: readonly string[],
): string[] {
  const cited = new Set(citedKeys)
  const current = flattenSettings(settings)
  const base = flattenSettings(defaults)

  const changed = Object.keys(current).filter(
    (key) => !cited.has(key) && !sameValue(current[key], base[key]),
  )

  // Collections are not flattened, so they are compared whole.
  for (const entry of SETTING_PARAMS.filter((item) => item.kind === 'collection')) {
    if (cited.has(entry.key)) continue
    const now = JSON.stringify(readSettingValue(settings, entry.key) ?? null)
    const before = JSON.stringify(readSettingValue(defaults, entry.key) ?? null)
    if (now !== before) changed.push(entry.key)
  }

  return changed.filter((key) => BY_KEY.has(key)).sort()
}

function sameValue(a: SettingValue | undefined, b: SettingValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

/* ─────────────────────────── the collections ───────────────────────────── */

/**
 * One column of a collection parameter.
 *
 * A list of contractual categories is a table, not a value, and a text box
 * that pretends otherwise invites somebody to paste JSON into their own
 * configuration. Describing the columns here — rather than in the component —
 * keeps the shape beside the schema that validates it, and means the editor
 * is the same editor for all five collections.
 */
export interface CollectionField {
  name: string
  kind: 'text' | 'number' | 'date' | 'boolean' | 'choice'
  /** For `choice`. The empty option is offered when the field is nullable. */
  options?: readonly string[]
  /** Whether an empty box means `null` rather than an error. */
  nullable?: boolean
  /** Shown beside the box, as on the scalar parameters. */
  unit?: string | null
}

function field(
  name: string,
  kind: CollectionField['kind'],
  extra: Omit<CollectionField, 'name' | 'kind'> = {},
): CollectionField {
  return { name, kind, ...extra }
}

const CATEGORY_MAPPINGS = [
  'full_professor',
  'associate_professor',
  'assistant_professor',
  'lecturer',
  'adjunct',
  'visiting',
  'external',
] as const

const REDUCTION_APPROVERS = [
  'department',
  'faculty',
  'coordination',
  'union',
  'rectorate',
  'other',
] as const

/**
 * The columns of each collection, in the order they are edited.
 *
 * These mirror the Zod schemas in `settings.ts`; the schemas remain the
 * authority on what is legal, and the API re-parses whatever this produces.
 */
export const COLLECTION_FIELDS: Readonly<Record<string, readonly CollectionField[]>> = {
  categories: [
    field('code', 'text'),
    field('label', 'text'),
    field('baseCapacityHours', 'number', { unit: 'hours/year' }),
    field('maxTeachingHours', 'number', { unit: 'hours/year' }),
    field('mapsTo', 'choice', { options: CATEGORY_MAPPINGS, nullable: true }),
    field('notes', 'text', { nullable: true }),
  ],
  reductions: [
    field('code', 'text'),
    field('label', 'text'),
    field('hours', 'number', { nullable: true, unit: 'hours' }),
    field('credits', 'number', { nullable: true, unit: 'credits' }),
    field('maxHours', 'number', { nullable: true, unit: 'hours' }),
    field('stackable', 'boolean'),
    field('approvedBy', 'choice', { options: REDUCTION_APPROVERS }),
    field('notes', 'text', { nullable: true }),
  ],
  'academicCalendar.examPeriods': [
    field('label', 'text'),
    field('from', 'date'),
    field('to', 'date'),
  ],
  'academicCalendar.holidays': [field('label', 'text'), field('date', 'date')],
}

export function collectionFields(key: string): readonly CollectionField[] | null {
  return COLLECTION_FIELDS[key] ?? null
}

/**
 * A blank row.
 *
 * Every column is present, because a row half-built is still parsed against
 * the schema on save: an absent `stackable` would take its default and an
 * absent `code` would be reported as missing, which is the point.
 */
export function emptyCollectionRow(key: string): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const column of collectionFields(key) ?? []) {
    if (column.kind === 'boolean') row[column.name] = true
    else if (column.kind === 'choice' && !column.nullable) row[column.name] = column.options?.[0]
    else row[column.name] = column.nullable ? null : ''
  }
  return row
}

/** Label for one column of a collection, and for the values of a `choice`. */
export function collectionFieldLabelKey(key: string, field: string): string {
  return `settings.collections.${key}.fields.${field}`
}

export function collectionChoiceLabelKey(key: string, field: string, option: string): string {
  return `settings.collections.${key}.choices.${field}.${option}`
}
