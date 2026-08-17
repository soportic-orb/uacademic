/**
 * Primitive schemas reused across the API surface. Every API type derives from
 * these (R6): the Zod schema is the single source of truth and the TypeScript
 * type is inferred from it, never written twice.
 */
import { z } from 'zod'

import { isClockTime } from '../domain/time.js'
import { SUPPORTED_LOCALES } from '../i18n/index.js'

export const uuidSchema = z.uuid({ message: 'validation.invalidUuid' })

export const clockTimeSchema = z
  .string()
  .refine(isClockTime, { message: 'validation.invalidTime' })

export const weekdaySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
])

/** DECIMAL(6,2): up to 9999.99, never negative, at most two decimals. */
export const decimalHoursSchema = z
  .number()
  .min(0)
  .max(9999.99)
  .refine((value) => Number.isInteger(Math.round(value * 100)), {
    message: 'validation.invalidRange',
  })

export const localeSchema = z.enum(SUPPORTED_LOCALES)

export const themeSchema = z.enum(['light', 'dark', 'system'])

export const roleSchema = z.enum(['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'])
export type Role = z.infer<typeof roleSchema>

export const timeIntervalSchema = z
  .object({
    start: clockTimeSchema,
    end: clockTimeSchema,
  })
  .refine((interval) => interval.end > interval.start, {
    message: 'validation.invalidRange',
    path: ['end'],
  })

/** `YYYY-MM-DD`, the wire format for date-only columns. */
export const isoDateSchema = z.iso.date()

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
}

/** Header carrying the active center. R2: no business query runs without it. */
export const CENTER_HEADER = 'x-center-id'

/** R2: SUPERADMIN crossing centers must do so explicitly, and it is audited. */
export const CROSS_CENTER_HEADER = 'x-cross-center'
