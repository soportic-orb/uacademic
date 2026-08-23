/**
 * Write schemas for the academic structure. The API validates with these and
 * the web forms infer their types from them, so a field cannot drift between
 * the two (R6).
 */
import { z } from 'zod'

import { CADY_MAX_QUESTION } from '../domain/support.js'
import {
  clockTimeSchema,
  decimalHoursSchema,
  isoDateSchema,
  roleSchema,
  uuidSchema,
} from './common.js'

/** R1: names a user reads exist in the three languages, always. */
export const trilingualNameSchema = z.object({
  nameCa: z.string().trim().min(1).max(200),
  nameEs: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
})

const code = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, {
    message: 'validation.invalidCode',
  })

/**
 * The logo is not here: it is uploaded to `/admin/universities/:id/logo`, and
 * the column is written with the URL that route answers with. Accepting one in
 * the body as well would be a second way to set it, and the only URLs it could
 * carry are somewhere else's.
 */
export const universityInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
})
export type UniversityInput = z.infer<typeof universityInputSchema>

export const centerInputSchema = z.object({
  universityId: uuidSchema,
  name: z.string().trim().min(1).max(200),
  code,
  /** The Microsoft tenant GUID; must already exist in `entra_tenants` (R3). */
  entraTenantId: z.uuid().nullish(),
  timezone: z.string().trim().min(1).max(64).default('Europe/Madrid'),
  localeDefault: z.enum(['ca', 'es', 'en']).default('ca'),
})
export type CenterInput = z.infer<typeof centerInputSchema>

export const entraTenantInputSchema = z.object({
  tenantId: z.uuid(),
  displayName: z.string().trim().min(1).max(200),
  issuer: z.url().max(300).nullish(),
  status: z.enum(['active', 'suspended']).default('active'),
})
export type EntraTenantInput = z.infer<typeof entraTenantInputSchema>

export const academicYearInputSchema = z
  .object({
    name: z.string().trim().min(1).max(32),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    status: z.enum(['draft', 'active', 'closed']).default('draft'),
  })
  .refine((year) => year.endDate > year.startDate, {
    message: 'validation.invalidDateRange',
    path: ['endDate'],
  })
export type AcademicYearInput = z.infer<typeof academicYearInputSchema>

export const degreeInputSchema = trilingualNameSchema.extend({
  code,
  level: z.enum(['bachelor', 'master', 'doctorate', 'own_degree']),
})
export type DegreeInput = z.infer<typeof degreeInputSchema>

export const subjectInputSchema = trilingualNameSchema.extend({
  academicYearId: uuidSchema,
  degreeId: uuidSchema,
  code,
  ects: z.coerce.number().min(0).max(999.9),
  year: z.coerce.number().int().min(1).max(9),
  term: z.enum(['t1', 't2', 't3', 'annual']),
  type: z.enum(['basic', 'compulsory', 'elective', 'practicum', 'final_project']),
  teachingLanguage: z.enum(['ca', 'es', 'en', 'other']).default('ca'),
})
export type SubjectInput = z.infer<typeof subjectInputSchema>

export const groupInputSchema = z.object({
  subjectId: uuidSchema,
  type: z.enum(['theory', 'seminar', 'lab', 'practicum', 'tutoring']),
  code: z.string().trim().min(1).max(32),
  plannedHours: decimalHoursSchema,
  capacity: z.coerce.number().int().min(1).max(2000).nullish(),
  requiredSpaceType: z
    .enum(['classroom', 'seminar_room', 'computer_lab', 'lab', 'auditorium', 'other'])
    .nullish(),
})
export type GroupInput = z.infer<typeof groupInputSchema>

export const spaceInputSchema = z.object({
  building: z.string().trim().max(100).nullish(),
  name: z.string().trim().min(1).max(100),
  capacity: z.coerce.number().int().min(1).max(2000),
  type: z.enum(['classroom', 'seminar_room', 'computer_lab', 'lab', 'auditorium', 'other']),
  /**
   * Optional rather than defaulted: with a default, a PATCH that does not
   * mention the equipment would silently clear it.
   */
  equipment: z.array(z.string().trim().min(1).max(50)).optional(),
})
export type SpaceInput = z.infer<typeof spaceInputSchema>

/**
 * The kinds of day a center's calendar is made of, as the platform ships.
 *
 * Two of them mean something to the engine — `term_start` and `term_end`
 * bracket the terms a group's classes run in — and the rest are labels for the
 * days themselves. A center may add its own alongside these, which is why the
 * column is a key rather than a database enum; what a center adds is a label,
 * and it is `isTeachingDay` that decides whether the planner skips the day.
 */
export const BUILT_IN_CALENDAR_TYPES = [
  'holiday',
  'vacation',
  'non_teaching',
  'exam_period',
  'term_start',
  'term_end',
  'event',
] as const

export type BuiltInCalendarType = (typeof BUILT_IN_CALENDAR_TYPES)[number]

/**
 * A type key: lower case, no accents, words joined by underscores.
 *
 * Slugged rather than free text so the value in the column reads the same as
 * the seven the platform ships with, and so a center that writes "Simulacre
 * d'incendi" twice does not end up with two types.
 */
export const calendarTypeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'validation.invalidCode')

export function calendarTypeKeyFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
}

/** A type a center added for itself. The three names are what people read. */
export const calendarTypeInputSchema = z.object({
  nameCa: z.string().trim().min(1).max(60),
  /**
   * The other two languages are optional here, and only here: this is created
   * inline from a dropdown, mid-way through writing something else. Left
   * blank they take the Catalan name, which is better than blocking the person
   * or than inventing a translation.
   */
  nameEs: z.string().trim().max(60).optional(),
  nameEn: z.string().trim().max(60).optional(),
})
export type CalendarTypeInput = z.infer<typeof calendarTypeInputSchema>

export const calendarEntryInputSchema = trilingualNameSchema
  .extend({
    academicYearId: uuidSchema,
    type: calendarTypeKeySchema,
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
    isTeachingDay: z.boolean().default(false),
  })
  .refine((entry) => entry.dateTo >= entry.dateFrom, {
    message: 'validation.invalidDateRange',
    path: ['dateTo'],
  })
export type CalendarEntryInput = z.infer<typeof calendarEntryInputSchema>

export const userInputSchema = z.object({
  email: z.email().max(255),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(150),
  locale: z.enum(['ca', 'es', 'en']).default('ca'),
  status: z.enum(['active', 'invited', 'pending_activation', 'suspended']).default('invited'),
})
export type UserInput = z.infer<typeof userInputSchema>

/**
 * Which centers a new account gets, and as what.
 *
 * At least one, because an account with no role anywhere can sign in and see
 * nothing. Each is checked against what the person creating it may grant: a
 * center administrator staffs their own centers, and no others.
 */
export const userGrantSchema = z.object({
  centerId: uuidSchema,
  role: roleSchema,
})
export type UserGrant = z.infer<typeof userGrantSchema>

export const userCreateSchema = userInputSchema.extend({
  grants: z.array(userGrantSchema).min(1).max(50),
  /**
   * Whether to write to this person now.
   *
   * Off by default, and asked rather than assumed: accounts are regularly
   * created ahead of a term, in a batch, or from an import, and an invitation
   * that arrives two months before anybody explains what it is gets deleted.
   * The invitation can always be sent afterwards from the row itself.
   */
  sendInvitation: z.boolean().default(false),
})
export type UserCreate = z.infer<typeof userCreateSchema>

/**
 * Editing the center's parameters by hand.
 *
 * A map of dot paths to values rather than a whole settings object: an
 * administrator changing the maximum teaching hours should not have to send —
 * and risk overwriting — the ninety parameters they did not touch. Which paths
 * exist, and whether the result is coherent, is decided by the settings schema
 * on the server.
 */
export const centerSettingsPatchSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  notes: z.string().trim().max(500).optional(),
})
export type CenterSettingsPatch = z.infer<typeof centerSettingsPatchSchema>

/**
 * A teacher's contract for one academic year.
 *
 * The account and the contract are different things and are created at
 * different moments: somebody is invited as a lecturer when they join the
 * center, and gets contracted hours when the year is being planned. This is
 * the second half, and until now the only way to write it was a spreadsheet
 * import — which meant a center could not add a single teacher by hand.
 */
export const teacherProfileInputSchema = z.object({
  userId: uuidSchema,
  category: z.enum([
    'full_professor',
    'associate_professor',
    'assistant_professor',
    'lecturer',
    'adjunct',
    'visiting',
    'external',
  ]),
  dedication: z.enum(['full_time', 'part_time', 'hourly']),
  contractedHours: z.coerce.number().min(0).max(9999.99),
  notes: z.string().trim().max(1000).nullish(),
})
export type TeacherProfileInput = z.infer<typeof teacherProfileInputSchema>

/**
 * Giving a teacher a group to teach.
 *
 * The hours are stated rather than derived: what a group is worth in a
 * teacher's load is a decision the center makes — a lab hour and a lecture
 * hour are not the same hour in most regulations — and the group's planned
 * hours are only the default the screen offers.
 */
export const teacherAssignmentSchema = z.object({
  groupId: uuidSchema,
  concept: z.enum(['lecture', 'tutoring', 'coordination', 'tfg', 'other']).default('lecture'),
  assignedHours: z.coerce.number().min(0).max(9999.99),
})
export type TeacherAssignment = z.infer<typeof teacherAssignmentSchema>

/**
 * The range a timetable is printed or sent for.
 *
 * Asked for every time rather than defaulted to the whole year: a term, a
 * month before an exam period, the fortnight somebody is covering for a
 * colleague — the useful ranges are all shorter than the year, and a
 * ninety-page PDF is one nobody prints.
 */
export const scheduleRangeSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((range) => range.to >= range.from, {
    message: 'validation.invalidDateRange',
    path: ['to'],
  })
export type ScheduleRange = z.infer<typeof scheduleRangeSchema>

/** Sending them out: everybody contracted this year unless named otherwise. */
export const sendSchedulesSchema = scheduleRangeSchema.safeExtend({
  teacherProfileIds: z.array(uuidSchema).max(500).optional(),
})
export type SendSchedules = z.infer<typeof sendSchedulesSchema>

/** Editing one: the person it belongs to never changes. */
export const teacherProfileUpdateSchema = teacherProfileInputSchema.omit({ userId: true }).partial()
export type TeacherProfileUpdate = z.infer<typeof teacherProfileUpdateSchema>

export const userRoleInputSchema = z.object({
  userId: uuidSchema,
  role: roleSchema,
  validFrom: isoDateSchema.optional(),
  validTo: isoDateSchema.nullish(),
})
export type UserRoleInput = z.infer<typeof userRoleInputSchema>

/** Kept here so the planner and the calendar agree on the shape of a slot. */
export const timeWindowSchema = z.object({
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
})

/* ─────────────────────────── the support chat ──────────────────────────── */

/** One question for Cady. Short: this is a chat, not a document upload. */
export const supportAskSchema = z.object({
  question: z.string().trim().min(2).max(CADY_MAX_QUESTION),
  conversationId: uuidSchema.optional(),
  /**
   * The screen the person is on. Bounded and matched against a known list of
   * routes — it reaches a prompt, so it is not free text with a free ride.
   */
  path: z.string().trim().max(200).optional(),
})
export type SupportAsk = z.infer<typeof supportAskSchema>

/** The reader's verdict on one answer, which is how the help gets better. */
export const supportFeedbackSchema = z.object({ helpful: z.boolean() })
export type SupportFeedback = z.infer<typeof supportFeedbackSchema>

const supportArticleTextSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8_000),
})

/**
 * A piece of help, in the three languages (R1).
 *
 * Cady reads the reader's own language out of this, so a missing one is a
 * question she cannot answer for a third of the platform.
 */
export const supportArticleInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'validation.slug'),
  roles: z.array(roleSchema).min(1),
  enabled: z.boolean().default(true),
  content: z.object({
    ca: supportArticleTextSchema,
    es: supportArticleTextSchema,
    en: supportArticleTextSchema,
  }),
})
export type SupportArticleInput = z.infer<typeof supportArticleInputSchema>

export const supportArticleUpdateSchema = supportArticleInputSchema.partial()

/** What the platform administrator may switch. */
export const supportSettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  maxOutputTokens: z.number().int().min(256).max(8_000).optional(),
  historyMessages: z.number().int().min(0).max(40).optional(),
})
export type SupportSettingsInput = z.infer<typeof supportSettingsInputSchema>

/* ────────────────────────── the personal menu ──────────────────────────── */

/**
 * How somebody has arranged their own menu.
 *
 * A list of what to draw, not a copy of the menu: the roles still decide what
 * a person may reach, and an item this does not mention is still drawn at the
 * end. The label is the person's own text, so it is bounded but not policed.
 */
export const menuEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), key: z.string().trim().min(1).max(40) }),
  z.object({
    kind: z.literal('separator'),
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().max(40),
  }),
])
export type MenuEntryInput = z.infer<typeof menuEntrySchema>

export const menuLayoutSchema = z.object({
  entries: z.array(menuEntrySchema).max(120),
})
export type MenuLayoutInput = z.infer<typeof menuLayoutSchema>

/**
 * The menu each role starts with, set once for the whole installation.
 *
 * Only the three center roles. A platform administrator arranges their own —
 * there is one of them, they are the person setting these, and a default they
 * would have to maintain for themselves is a form to fill in for nobody.
 */
export const DEFAULTED_ROLES = ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'] as const
export type DefaultedRole = (typeof DEFAULTED_ROLES)[number]

const roleMenuSchema = z.array(menuEntrySchema).max(120)

// Spelled out rather than a record keyed by the enum: a record over an enum is
// exhaustive, and every one of these is optional — an installation sets the
// default for one role and leaves the others as the product declares them.
export const menuDefaultsSchema = z.object({
  defaults: z
    .object({
      CENTER_ADMIN: roleMenuSchema.optional(),
      COORDINATOR: roleMenuSchema.optional(),
      TEACHER: roleMenuSchema.optional(),
    })
    // A role that does not get a default — the platform administrator, who
    // sets these — is refused rather than silently dropped.
    .strict(),
})
export type MenuDefaultsInput = z.infer<typeof menuDefaultsSchema>
