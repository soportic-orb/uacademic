/**
 * Shared API contracts. The API implements these and the web client consumes
 * the inferred types, so a change in one shows up as a type error in the other.
 */
import { z } from 'zod'

import { localeSchema, roleSchema, themeSchema, uuidSchema } from './common.js'

/** Machine-readable error codes; the message key is resolved per locale (R1). */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'RATE_LIMITED',
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
  category: z.string(),
  dedication: z.string(),
  contractedHours: z.number(),
  reductionHours: z.number(),
  capacityHours: z.number(),
  assignedHours: z.number(),
  remainingHours: z.number(),
  ratioPercent: z.number().nullable(),
  status: loadStatusSchema,
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
