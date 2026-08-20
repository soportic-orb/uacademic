/**
 * Write schemas for the academic structure. The API validates with these and
 * the web forms infer their types from them, so a field cannot drift between
 * the two (R6).
 */
import { z } from 'zod'

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

export const calendarEntryInputSchema = trilingualNameSchema
  .extend({
    academicYearId: uuidSchema,
    type: z.enum(['holiday', 'non_teaching', 'exam_period', 'term_start', 'term_end', 'event']),
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
})
export type UserCreate = z.infer<typeof userCreateSchema>

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
