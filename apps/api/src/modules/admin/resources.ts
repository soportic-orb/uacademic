import {
  academicYearInputSchema,
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

import { type CrudResource, registerCrudRoutes } from '../../lib/crud.js'
import { AppError } from '../../lib/errors.js'

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
 * The academic structure, as data. Each entry becomes a full CRUD surface with
 * server-side listing, role checks and audit — see `lib/crud.ts`.
 *
 * Everything hangs off `/api/v1/admin/…` so the management surface never
 * collides with the read models the app itself consumes (`/api/v1/subjects`
 * returns the teaching plan; `/api/v1/admin/subjects` edits it).
 */
export function registerAdminResources(app: FastifyInstance): void {
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
    include: { degree: { select: { code: true } } },
    serialize: (row) => ({
      id: asString(row.id),
      code: asString(row.code),
      ...names(row),
      ects: asNumber(row.ects),
      year: asNumber(row.year),
      term: asString(row.term),
      type: asString(row.type),
      teachingLanguage: asString(row.teachingLanguage),
      academicYearId: asString(row.academicYearId),
      degreeId: asString(row.degreeId),
      degreeCode: asString((row.degree as { code?: string } | undefined)?.code),
    }),
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
    include: { subject: { select: { code: true, nameCa: true } } },
    serialize: (row) => {
      const subject = row.subject as { code?: string; nameCa?: string } | undefined
      return {
        id: asString(row.id),
        code: asString(row.code),
        type: asString(row.type),
        plannedHours: asNumber(row.plannedHours),
        capacity: row.capacity ?? null,
        requiredSpaceType: row.requiredSpaceType ?? null,
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
      ...names(row),
    }),
    beforeWrite: (input) => ({
      ...input,
      ...(input.dateFrom ? { dateFrom: new Date(input.dateFrom) } : {}),
      ...(input.dateTo ? { dateTo: new Date(input.dateTo) } : {}),
    }),
  } satisfies CrudResource<typeof calendarEntryInputSchema>)
}
