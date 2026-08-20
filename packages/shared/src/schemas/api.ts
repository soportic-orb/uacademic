/**
 * Shared API contracts. The API implements these and the web client consumes
 * the inferred types, so a change in one shows up as a type error in the other.
 */
import { z } from 'zod'

import {
  clockTimeSchema,
  decimalHoursSchema,
  isoDateSchema,
  localeSchema,
  roleSchema,
  themeSchema,
  uuidSchema,
  weekdaySchema,
} from './common.js'

/** Machine-readable error codes; the message key is resolved per locale (R1). */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'RATE_LIMITED',
  /** The resource existed and was deliberately withdrawn — the installer. */
  'GONE',
  'TENANT_REQUIRED',
  'TENANT_MISMATCH',
  'UNKNOWN_TENANT',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    /** i18n key, e.g. `errors.forbidden`. */
    messageKey: z.string(),
    /** Message already resolved in the caller's locale, for convenience. */
    message: z.string(),
    details: z.array(z.object({ path: z.string(), messageKey: z.string() })).optional(),
    traceId: z.string(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number(),
  checks: z.object({
    database: z.enum(['ok', 'error', 'skipped']),
  }),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const centerMembershipSchema = z.object({
  centerId: uuidSchema,
  centerName: z.string(),
  centerCode: z.string(),
  role: roleSchema,
})
export type CenterMembership = z.infer<typeof centerMembershipSchema>

export const currentUserSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  locale: localeSchema,
  theme: themeSchema,
  avatarUrl: z.string().nullable(),
  memberships: z.array(centerMembershipSchema),
})
export type CurrentUser = z.infer<typeof currentUserSchema>

export const loadStatusSchema = z.enum(['under', 'optimal', 'limit', 'over'])

export const teacherLoadSchema = z.object({
  teacherProfileId: uuidSchema,
  userId: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  avatarUrl: z.string().nullable(),
  category: z.string(),
  dedication: z.string(),
  contractedHours: z.number(),
  reductionHours: z.number(),
  capacityHours: z.number(),
  assignedHours: z.number(),
  remainingHours: z.number(),
  ratioPercent: z.number().nullable(),
  status: loadStatusSchema,
  /** Degrees the teacher has assignments in, which is what the filter offers. */
  degreeIds: z.array(uuidSchema),
})
export type TeacherLoadDto = z.infer<typeof teacherLoadSchema>

export const centerLoadSummarySchema = z.object({
  teachers: z.number().int(),
  totalCapacityHours: z.number(),
  totalAssignedHours: z.number(),
  ratioPercent: z.number().nullable(),
  byStatus: z.object({
    under: z.number().int(),
    optimal: z.number().int(),
    limit: z.number().int(),
    over: z.number().int(),
  }),
})
export type CenterLoadSummaryDto = z.infer<typeof centerLoadSummarySchema>

// ─────────────────────────────────────────────────────────────────────────────
// Teaching capacity: profile, reductions, availability and the load panels
// ─────────────────────────────────────────────────────────────────────────────

export const assignmentConceptSchema = z.enum([
  'lecture',
  'tutoring',
  'coordination',
  'tfg',
  'other',
])

export const availabilityLevelSchema = z.enum(['preferred', 'available', 'avoid', 'unavailable'])

export const conceptTotalSchema = z.object({
  concept: assignmentConceptSchema,
  hours: z.number(),
  percent: z.number(),
})

export const subjectWorkloadSchema = z.object({
  subjectId: uuidSchema,
  subjectCode: z.string(),
  subjectName: z.string(),
  hours: z.number(),
  percent: z.number(),
  byConcept: z.array(conceptTotalSchema),
  groups: z.array(
    z.object({
      groupId: uuidSchema.nullable(),
      groupCode: z.string().nullable(),
      hours: z.number(),
    }),
  ),
})

/** The personal panel: the same totals as the table, plus the breakdown. */
export const teacherWorkloadSchema = teacherLoadSchema.extend({
  academicYearId: uuidSchema,
  bySubject: z.array(subjectWorkloadSchema),
  conceptTotals: z.array(conceptTotalSchema),
})
export type TeacherWorkloadDto = z.infer<typeof teacherWorkloadSchema>

export const teacherReductionSchema = z.object({
  id: uuidSchema,
  reason: z.string(),
  hours: z.number(),
  status: z.enum(['pending', 'approved', 'rejected']),
  approvedBy: uuidSchema.nullable(),
  approverName: z.string().nullable(),
  approvedAt: z.string().nullable(),
})
export type TeacherReductionDto = z.infer<typeof teacherReductionSchema>

export const teacherSkillSchema = z.object({
  id: uuidSchema,
  subjectId: uuidSchema.nullable(),
  subjectCode: z.string().nullable(),
  subjectName: z.string().nullable(),
  knowledgeArea: z.string().nullable(),
})
export type TeacherSkillDto = z.infer<typeof teacherSkillSchema>

/**
 * What this person teaches, one row per assignment.
 *
 * `bySubject` totals the same thing for the load figures; this carries the
 * ids, because taking an assignment away needs to name which one — and two
 * assignments on the same group differ only by their concept.
 */
export const teacherAssignmentRowSchema = z.object({
  id: uuidSchema,
  subjectId: uuidSchema,
  subjectCode: z.string(),
  subjectName: z.string(),
  groupId: uuidSchema,
  groupCode: z.string(),
  concept: z.enum(['lecture', 'tutoring', 'coordination', 'tfg', 'other']),
  hours: z.number(),
})
export type TeacherAssignmentRowDto = z.infer<typeof teacherAssignmentRowSchema>

/** The profile card of screen (a). */
export const teacherProfileSchema = teacherWorkloadSchema.extend({
  email: z.email(),
  notes: z.string().nullable(),
  reductions: z.array(teacherReductionSchema),
  skills: z.array(teacherSkillSchema),
  assignments: z.array(teacherAssignmentRowSchema),
  weeklyAvailableHours: z.number(),
})
export type TeacherProfileDto = z.infer<typeof teacherProfileSchema>

export const reductionInputSchema = z.object({
  reason: z.string().trim().min(3).max(255),
  hours: decimalHoursSchema,
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
})
export type ReductionInputDto = z.infer<typeof reductionInputSchema>

export const teacherSkillsInputSchema = z.object({
  subjectIds: z.array(uuidSchema).max(100).default([]),
  knowledgeAreas: z.array(z.string().trim().min(2).max(150)).max(50).default([]),
})
export type TeacherSkillsInputDto = z.infer<typeof teacherSkillsInputSchema>

export const availabilityEntrySchema = z.object({
  weekday: weekdaySchema,
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
  level: availabilityLevelSchema,
})
export type AvailabilityEntryDto = z.infer<typeof availabilityEntrySchema>

/**
 * The editor saves the whole week at once: a partial save would leave the grid
 * and the stored intervals describing different things.
 */
export const saveAvailabilitySchema = z.object({
  entries: z
    .array(
      availabilityEntrySchema.refine((entry) => entry.endTime > entry.startTime, {
        message: 'validation.invalidRange',
        path: ['endTime'],
      }),
    )
    .max(500),
})
export type SaveAvailabilityDto = z.infer<typeof saveAvailabilitySchema>

export const availabilityExceptionSchema = z.object({
  id: uuidSchema,
  dateFrom: isoDateSchema,
  dateTo: isoDateSchema,
  reason: z.string().nullable(),
  level: availabilityLevelSchema,
})
export type AvailabilityExceptionDto = z.infer<typeof availabilityExceptionSchema>

export const availabilityExceptionInputSchema = z
  .object({
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
    reason: z.string().trim().max(255).optional(),
    level: availabilityLevelSchema.default('unavailable'),
  })
  .refine((exception) => exception.dateTo >= exception.dateFrom, {
    message: 'validation.invalidRange',
    path: ['dateTo'],
  })
export type AvailabilityExceptionInputDto = z.infer<typeof availabilityExceptionInputSchema>

/** Availability plus the grid geometry, which comes from the center settings. */
export const availabilityResponseSchema = z.object({
  teacherProfileId: uuidSchema,
  entries: z.array(availabilityEntrySchema),
  exceptions: z.array(availabilityExceptionSchema),
  grid: z.object({
    dayStart: clockTimeSchema,
    dayEnd: clockTimeSchema,
    slotMinutes: z.number().int(),
    weekdays: z.array(weekdaySchema),
  }),
  hoursByLevel: z.object({
    preferred: z.number(),
    available: z.number(),
    avoid: z.number(),
    unavailable: z.number(),
  }),
  editable: z.boolean(),
})
export type AvailabilityResponseDto = z.infer<typeof availabilityResponseSchema>

export const loadSortKeySchema = z.enum(['name', 'capacity', 'assigned', 'ratio', 'status'])

/** Filters of the center load panel; the Excel export accepts the same ones. */
export const loadQuerySchema = z.object({
  degreeId: uuidSchema.optional(),
  category: z.string().max(40).optional(),
  status: loadStatusSchema.optional(),
  q: z.string().trim().max(200).optional(),
  sort: loadSortKeySchema.default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
})
export type LoadQueryDto = z.infer<typeof loadQuerySchema>

export const subjectSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  nameCa: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  ects: z.number(),
  year: z.number().int(),
  term: z.enum(['t1', 't2', 't3', 'annual']),
  type: z.enum(['basic', 'compulsory', 'elective', 'practicum', 'final_project']),
  teachingLanguage: z.enum(['ca', 'es', 'en', 'other']),
  degreeCode: z.string(),
  groupCount: z.number().int(),
  plannedHours: z.number(),
  assignedHours: z.number(),
})
export type SubjectDto = z.infer<typeof subjectSchema>
