import {
  academicYearInputSchema,
  carryYearly,
  calendarEntryInputSchema,
  centerInputSchema,
  degreeInputSchema,
  entraTenantInputSchema,
  groupInputSchema,
  spaceInputSchema,
  subjectInputSchema,
  universityInputSchema,
} from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { calendarTypeOptions, registerCalendarTypeRoutes } from './calendar-types.js'
import { type CrudResource, registerCrudRoutes } from '../../lib/crud.js'
import { AppError } from '../../lib/errors.js'
import type { PrismaClient } from '../../lib/prisma.js'

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asNumber = (value: unknown): number => Number(value ?? 0)
const asDate = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : asString(value)

/** Trilingual columns travel together; the client picks the active language. */
const names = (row: Record<string, unknown>) => ({
  nameCa: asString(row.nameCa),
  nameEs: asString(row.nameEs),
  nameEn: asString(row.nameEn),
})

/**
 * A new academic year starts with the days that come round every year.
 *
 * Sant Jordi, a patron saint, the closure between Christmas and Epiphany: a
 * center marks them once and they are copied into each calendar after that,
 * on the same date. Nothing else is copied — the term boundaries and the exam
 * periods are different every year, which is why the flag is per entry.
 *
 * Copied from the year before this one, so opening 2028–29 after 2027–28
 * carries what 2027–28 was itself given.
 */
async function carryYearlyEntries(
  row: Record<string, unknown>,
  client: PrismaClient,
  centerId: string | null,
): Promise<void> {
  if (!centerId) return

  const created = row as { id: string; startDate: Date; endDate: Date }

  const previous = await client.academicYear.findFirst({
    where: { centerId, id: { not: created.id }, startDate: { lt: created.startDate } },
    orderBy: { startDate: 'desc' },
  })
  if (!previous) return

  const entries = await client.academicCalendarEntry.findMany({
    where: { centerId, academicYearId: previous.id, repeatsYearly: true },
  })
  if (entries.length === 0) return

  const years = created.startDate.getUTCFullYear() - previous.startDate.getUTCFullYear()
  if (years <= 0) return

  const carried = carryYearly(
    entries.map((entry) => ({
      ...entry,
      dateFrom: entry.dateFrom.toISOString().slice(0, 10),
      dateTo: entry.dateTo.toISOString().slice(0, 10),
    })),
    years,
    {
      from: created.startDate.toISOString().slice(0, 10),
      to: created.endDate.toISOString().slice(0, 10),
    },
  )

  for (const entry of carried) {
    await client.academicCalendarEntry.create({
      data: {
        centerId,
        academicYearId: created.id,
        type: entry.type,
        dateFrom: new Date(`${entry.dateFrom}T00:00:00Z`),
        dateTo: new Date(`${entry.dateTo}T00:00:00Z`),
        nameCa: entry.nameCa,
        nameEs: entry.nameEs,
        nameEn: entry.nameEn,
        isTeachingDay: entry.isTeachingDay,
        // It goes on repeating: a holiday does not stop being annual because
        // a year went by.
        repeatsYearly: true,
      },
    })
  }
}

interface CoordinatorRow {
  userId: string
  user: { firstName: string; lastName: string }
}

function coordinatorsOf(row: Record<string, unknown>): CoordinatorRow[] {
  return Array.isArray(row.coordinators) ? (row.coordinators as CoordinatorRow[]) : []
}

/**
 * Turning "these people coordinate it" into rows, and into the access it means.
 *
 * Naming somebody here is the grant: the screens that ask whether a person may
 * see a subject read `subject_coordinators`. It is also useless on its own —
 * the coordination screens are gated on the role — so somebody who does not
 * have COORDINATOR in this center is given it. Taking them off a subject does
 * not take the role away: they may coordinate another, and roles are the
 * users screen's to manage.
 */
async function coordinatorWrite(
  client: PrismaClient,
  centerId: string,
  userIds: readonly string[],
): Promise<Record<string, unknown>> {
  const unique = [...new Set(userIds)]

  if (unique.length > 0) {
    const members = await client.userCenterRole.findMany({
      where: { centerId, userId: { in: unique } },
      select: { userId: true, role: true },
    })

    for (const userId of unique) {
      const roles = members.filter((member) => member.userId === userId)
      // Somebody with no role in this center is not somebody this center can
      // hand a subject to (R2).
      if (roles.length === 0) {
        throw AppError.validation([
          { path: 'coordinatorIds', messageKey: 'admin.errors.notInCenter' },
        ])
      }

      if (!roles.some((entry) => entry.role === 'COORDINATOR')) {
        await client.userCenterRole.create({ data: { userId, centerId, role: 'COORDINATOR' } })
      }
    }
  }

  return {
    // The list replaces whatever was there: it is what the form showed.
    deleteMany: {},
    create: unique.map((userId) => ({ userId, centerId })),
  }
}

/**
 * The academic structure, as data. Each entry becomes a full CRUD surface with
 * server-side listing, role checks and audit — see `lib/crud.ts`.
 *
 * Everything hangs off `/api/v1/admin/…` so the management surface never
 * collides with the read models the app itself consumes (`/api/v1/subjects`
 * returns the teaching plan; `/api/v1/admin/subjects` edits it).
 */
export function registerAdminResources(app: FastifyInstance): void {
  registerCalendarTypeRoutes(app)

  registerCrudRoutes(app, {
    path: 'admin/universities',
    model: 'university',
    entity: 'university',
    scope: 'platform',
    roles: { read: ['SUPERADMIN'], write: ['SUPERADMIN'] },
    inputSchema: universityInputSchema,
    sortable: ['name', 'createdAt'],
    defaultSort: 'name',
    searchFields: ['name'],
    serialize: (row) => ({
      id: asString(row.id),
      name: asString(row.name),
      logoUrl: row.logoUrl ?? null,
    }),
  } satisfies CrudResource<typeof universityInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/entra-tenants',
    model: 'entraTenant',
    entity: 'entra_tenant',
    scope: 'platform',
    roles: { read: ['SUPERADMIN'], write: ['SUPERADMIN'] },
    inputSchema: entraTenantInputSchema,
    sortable: ['displayName', 'createdAt', 'status'],
    defaultSort: 'displayName',
    searchFields: ['displayName', 'tenantId'],
    filterFields: ['status'],
    serialize: (row) => ({
      id: asString(row.id),
      tenantId: asString(row.tenantId),
      displayName: asString(row.displayName),
      issuer: row.issuer ?? null,
      status: asString(row.status),
    }),
  } satisfies CrudResource<typeof entraTenantInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/centers',
    model: 'center',
    entity: 'center',
    scope: 'platform',
    roles: { read: ['SUPERADMIN'], write: ['SUPERADMIN'] },
    inputSchema: centerInputSchema,
    sortable: ['name', 'code', 'createdAt'],
    defaultSort: 'name',
    searchFields: ['name', 'code'],
    filterFields: ['universityId'],
    include: { university: { select: { name: true } } },
    serialize: (row) => ({
      id: asString(row.id),
      name: asString(row.name),
      code: asString(row.code),
      universityId: asString(row.universityId),
      universityName: asString((row.university as { name?: string } | undefined)?.name),
      entraTenantId: row.entraTenantId ?? null,
      timezone: asString(row.timezone),
      localeDefault: asString(row.localeDefault),
    }),
    beforeWrite: async (input, { client }) => {
      // R3: a center may only point at a tenant a superadmin registered.
      if (input.entraTenantId) {
        const tenant = await client.entraTenant.findUnique({
          where: { tenantId: input.entraTenantId },
        })
        if (!tenant) {
          throw AppError.validation([
            { path: 'entraTenantId', messageKey: 'auth.errors.tenantNotAuthorized' },
          ])
        }
      }
      return input as Record<string, unknown>
    },
  } satisfies CrudResource<typeof centerInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/academic-years',
    model: 'academicYear',
    entity: 'academic_year',
    scope: 'center',
    roles: { read: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'], write: ['CENTER_ADMIN'] },
    inputSchema: academicYearInputSchema,
    sortable: ['name', 'startDate', 'status'],
    defaultSort: 'startDate',
    searchFields: ['name'],
    filterFields: ['status'],
    serialize: (row) => ({
      id: asString(row.id),
      name: asString(row.name),
      startDate: asDate(row.startDate),
      endDate: asDate(row.endDate),
      status: asString(row.status),
    }),
    beforeWrite: (input) => ({
      ...input,
      ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
      ...(input.endDate ? { endDate: new Date(input.endDate) } : {}),
    }),
    afterCreate: (row, context) => carryYearlyEntries(row, context.client, context.centerId),
  } satisfies CrudResource<typeof academicYearInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/degrees',
    model: 'degree',
    entity: 'degree',
    scope: 'center',
    roles: { read: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'], write: ['CENTER_ADMIN'] },
    inputSchema: degreeInputSchema,
    sortable: ['code', 'nameCa', 'level'],
    defaultSort: 'code',
    searchFields: ['code', 'nameCa', 'nameEs', 'nameEn'],
    filterFields: ['level'],
    serialize: (row) => ({
      id: asString(row.id),
      code: asString(row.code),
      level: asString(row.level),
      ...names(row),
    }),
  } satisfies CrudResource<typeof degreeInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/subjects',
    model: 'subject',
    entity: 'subject',
    scope: 'center',
    roles: { read: ['CENTER_ADMIN', 'COORDINATOR'], write: ['CENTER_ADMIN'] },
    inputSchema: subjectInputSchema,
    sortable: ['code', 'nameCa', 'year', 'term'],
    defaultSort: 'code',
    searchFields: ['code', 'nameCa', 'nameEs', 'nameEn'],
    filterFields: ['academicYearId', 'degreeId', 'term', 'type'],
    include: {
      degree: { select: { code: true, nameCa: true } },
      coordinators: {
        select: { userId: true, user: { select: { firstName: true, lastName: true } } },
      },
    },
    serialize: (row) => ({
      id: asString(row.id),
      code: asString(row.code),
      ...names(row),
      coordinatorIds: coordinatorsOf(row).map((entry) => entry.userId),
      // The names as well, so the table can say who without asking again.
      coordinatorNames: coordinatorsOf(row)
        .map((entry) => `${entry.user.firstName} ${entry.user.lastName}`.trim())
        .join(', '),
      ects: asNumber(row.ects),
      year: asNumber(row.year),
      term: asString(row.term),
      type: asString(row.type),
      teachingLanguage: asString(row.teachingLanguage),
      color: row.color ?? null,
      academicYearId: asString(row.academicYearId),
      degreeId: asString(row.degreeId),
      degreeCode: asString((row.degree as { code?: string } | undefined)?.code),
      // The name as well as the code: "GEP" tells somebody who already knows
      // the catalogue which degree this is, and nobody else.
      degreeName: asString((row.degree as { nameCa?: string } | undefined)?.nameCa),
    }),
    beforeWrite: async (input, context) => {
      const { coordinatorIds, ...rest } = input
      if (!coordinatorIds) return rest
      if (!context.centerId) throw AppError.forbidden()

      return {
        ...rest,
        coordinators: await coordinatorWrite(context.client, context.centerId, coordinatorIds),
      }
    },
  } satisfies CrudResource<typeof subjectInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/groups',
    model: 'group',
    entity: 'group',
    scope: 'center',
    roles: { read: ['CENTER_ADMIN', 'COORDINATOR'], write: ['CENTER_ADMIN', 'COORDINATOR'] },
    inputSchema: groupInputSchema,
    sortable: ['code', 'type', 'plannedHours'],
    defaultSort: 'code',
    searchFields: ['code'],
    filterFields: ['subjectId', 'type'],
    include: {
      subject: { select: { code: true, nameCa: true } },
      space: { select: { name: true } },
    },
    serialize: (row) => {
      const subject = row.subject as { code?: string; nameCa?: string } | undefined
      const space = row.space as { name?: string } | undefined
      return {
        id: asString(row.id),
        code: asString(row.code),
        type: asString(row.type),
        plannedHours: asNumber(row.plannedHours),
        capacity: row.capacity ?? null,
        requiredSpaceType: row.requiredSpaceType ?? null,
        spaceId: row.spaceId ?? null,
        spaceName: space?.name ?? null,
        sessionMinutes: row.sessionMinutes ?? null,
        subjectId: asString(row.subjectId),
        subjectCode: asString(subject?.code),
        subjectName: asString(subject?.nameCa),
      }
    },
  } satisfies CrudResource<typeof groupInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/spaces',
    model: 'space',
    entity: 'space',
    scope: 'center',
    roles: { read: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'], write: ['CENTER_ADMIN'] },
    inputSchema: spaceInputSchema,
    sortable: ['name', 'building', 'capacity', 'type'],
    defaultSort: 'name',
    searchFields: ['name', 'building'],
    filterFields: ['type'],
    serialize: (row) => ({
      id: asString(row.id),
      building: row.building ?? null,
      name: asString(row.name),
      capacity: asNumber(row.capacity),
      type: asString(row.type),
      equipment: Array.isArray(row.equipmentJson) ? row.equipmentJson : [],
    }),
    beforeWrite: (input) => {
      const { equipment, ...rest } = input
      // Only touch the column when the caller actually sent the field.
      return { ...rest, ...(equipment === undefined ? {} : { equipmentJson: equipment }) }
    },
  } satisfies CrudResource<typeof spaceInputSchema>)

  registerCrudRoutes(app, {
    path: 'admin/calendar-entries',
    model: 'academicCalendarEntry',
    entity: 'academic_calendar',
    scope: 'center',
    roles: { read: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'], write: ['CENTER_ADMIN'] },
    inputSchema: calendarEntryInputSchema,
    sortable: ['dateFrom', 'type', 'nameCa'],
    defaultSort: 'dateFrom',
    searchFields: ['nameCa', 'nameEs', 'nameEn'],
    filterFields: ['academicYearId', 'type'],
    serialize: (row) => ({
      id: asString(row.id),
      academicYearId: asString(row.academicYearId),
      type: asString(row.type),
      dateFrom: asDate(row.dateFrom),
      dateTo: asDate(row.dateTo),
      isTeachingDay: Boolean(row.isTeachingDay),
      repeatsYearly: Boolean(row.repeatsYearly),
      ...names(row),
    }),
    beforeWrite: async (input, context) => {
      // The type is an open key now, so a typo would quietly invent a type
      // nobody can see in the list. It has to be one this center actually has.
      if (input.type) {
        const known = await calendarTypeOptions(context.request)
        if (!known.some((option) => option.id === input.type)) {
          throw AppError.validation([{ path: 'type', messageKey: 'validation.required' }])
        }
      }

      return {
        ...input,
        ...(input.dateFrom ? { dateFrom: new Date(input.dateFrom) } : {}),
        ...(input.dateTo ? { dateTo: new Date(input.dateTo) } : {}),
      }
    },
  } satisfies CrudResource<typeof calendarEntryInputSchema>)
}
