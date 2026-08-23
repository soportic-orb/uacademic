/**
 * The kinds of day a center's calendar is made of.
 *
 * Seven ship with the platform, and a center that needs an eighth — "Simulacre
 * d'incendi", "Jornada de portes obertes" — adds it from the dropdown it was
 * about to choose from, rather than waiting for a release. Both kinds come
 * back from the same endpoint, already in the reader's language (R1), so the
 * form and the list have one list of types and cannot disagree about it.
 *
 * What a center adds is a label. The two keys the engine reads — `term_start`
 * and `term_end` — are the platform's, and a new type never gains their
 * meaning; whether a day is taught on is `isTeachingDay`, which the form asks
 * for separately.
 */
import {
  BUILT_IN_CALENDAR_TYPES,
  calendarTypeInputSchema,
  calendarTypeKeyFrom,
  toListResult,
  translate,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

const READ_ROLES = ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'] as const

export interface CalendarTypeOption {
  /** The key stored on the entry. `id` because that is what a picker binds. */
  id: string
  name: string
  /** False for the ones a center added, which is what may be renamed. */
  builtIn: boolean
}

/** Every type this center may use, built-in first, then its own by name. */
export async function calendarTypeOptions(request: FastifyRequest): Promise<CalendarTypeOption[]> {
  const { db } = requireCenterScope(request)
  const rows = await db.calendarType.findMany({ orderBy: { nameCa: 'asc' } })

  const own = rows.map((row) => ({
    id: row.key,
    name: nameFor(request, row),
    builtIn: false,
  }))

  return [
    ...BUILT_IN_CALENDAR_TYPES.map((key) => ({
      id: key,
      name: translate(request.locale, `calendarType.${key}`),
      builtIn: true,
    })),
    ...own,
  ]
}

function nameFor(
  request: FastifyRequest,
  row: { nameCa: string; nameEs: string; nameEn: string },
): string {
  if (request.locale === 'es') return row.nameEs
  if (request.locale === 'en') return row.nameEn
  return row.nameCa
}

export function registerCalendarTypeRoutes(app: FastifyInstance): void {
  app.get(
    '/api/v1/admin/calendar-types',
    { config: { roles: [...READ_ROLES] } },
    async (request) => {
      const items = await calendarTypeOptions(request)
      return toListResult(items, items.length, 1, items.length)
    },
  )

  app.post(
    '/api/v1/admin/calendar-types',
    { config: { roles: ['CENTER_ADMIN'] } },
    async (request, reply) => {
      const { centerId, db } = requireCenterScope(request)
      const user = requireUser(request)
      const input = parseWith(calendarTypeInputSchema, request.body)

      const key = calendarTypeKeyFrom(input.nameCa)
      if (!key) {
        throw AppError.validation([{ path: 'nameCa', messageKey: 'validation.invalidCode' }])
      }

      // A center cannot redefine what the platform means by "holiday", and it
      // cannot have the same type twice under two spellings of one name.
      const taken =
        BUILT_IN_CALENDAR_TYPES.some((builtIn) => builtIn === key) ||
        (await db.calendarType.findFirst({ where: { key } })) !== null
      if (taken) {
        throw new AppError(409, 'CONFLICT', 'admin.calendarTypes.errors.duplicate')
      }

      const created = await db.calendarType.create({
        data: {
          centerId,
          key,
          nameCa: input.nameCa,
          // Blank is not a translation, and neither is a guess: the Catalan
          // name stands in until somebody writes the other two.
          nameEs: input.nameEs?.trim() || input.nameCa,
          nameEn: input.nameEn?.trim() || input.nameCa,
        },
      })

      await writeAuditLog(prisma(), {
        centerId,
        userId: user.userId,
        entity: 'calendar_type',
        entityId: created.id,
        action: 'create',
        after: created,
        source: 'user',
        ip: request.ip,
      })

      void reply.status(201)
      return { id: created.key, name: nameFor(request, created), builtIn: false }
    },
  )
}
