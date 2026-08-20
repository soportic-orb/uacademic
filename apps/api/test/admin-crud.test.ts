/**
 * The generic CRUD surface: server-side listing, role enforcement, validation
 * and audit. Exercised through one center-scoped resource (spaces) and one
 * platform resource (universities), because those are the two code paths.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  FOREIGN,
  SEED,
  createTestApp,
  ensureForeignCenter,
  hasDatabase,
  seedCenterId,
} from './helpers.js'

describe.skipIf(!hasDatabase)('admin CRUD', () => {
  let app: FastifyInstance
  let centerId: string
  const prisma = getPrismaClient()

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })
  const asSuperadmin = () => ({ 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    await ensureForeignCenter()
    centerId = await seedCenterId()
    await prisma.space.deleteMany({ where: { centerId, name: { startsWith: 'Test ' } } })
  })

  afterAll(async () => {
    await prisma.space.deleteMany({ where: { centerId, name: { startsWith: 'Test ' } } })
    await app.close()
    await disconnectPrisma()
  })

  describe('listing', () => {
    it('paginates on the server and reports the total', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/spaces?page=1&pageSize=2',
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.items.length).toBeLessThanOrEqual(2)
      expect(body.total).toBeGreaterThanOrEqual(3)
      expect(body.totalPages).toBe(Math.ceil(body.total / 2))
    })

    it('sorts by an allowed column and refuses anything else', async () => {
      const sorted = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/spaces?sort=capacity&order=desc',
        headers: asAdmin(),
      })
      const capacities = sorted.json().items.map((space: { capacity: number }) => space.capacity)
      expect(capacities).toEqual([...capacities].sort((a: number, b: number) => b - a))

      const injected = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/spaces?sort=settingsJson',
        headers: asAdmin(),
      })
      expect(injected.statusCode).toBe(422)
    })

    it('searches across the declared columns', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/spaces?q=Laboratori',
        headers: asAdmin(),
      })

      const names = response.json().items.map((space: { name: string }) => space.name)
      expect(names.some((name: string) => name.includes('Laboratori'))).toBe(true)
      expect(response.json().total).toBeLessThan(3)
    })

    it('filters by a declared field', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/spaces?type=computer_lab',
        headers: asAdmin(),
      })

      const types = response.json().items.map((space: { type: string }) => space.type)
      expect(new Set(types)).toEqual(new Set(['computer_lab']))
    })

    it('never leaks another center rows', async () => {
      await prisma.space.upsert({
        where: { id: '0198f0d2-8f2a-7000-8000-0f0000000010' },
        create: {
          id: '0198f0d2-8f2a-7000-8000-0f0000000010',
          centerId: FOREIGN.centerId,
          name: 'Aula del centre veí',
          capacity: 10,
          type: 'classroom',
        },
        update: {},
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/spaces?pageSize=100',
        headers: asAdmin(),
      })

      const names = response.json().items.map((space: { name: string }) => space.name)
      expect(names).not.toContain('Aula del centre veí')
    })
  })

  describe('writing', () => {
    it('creates, updates and deletes, writing an audit entry each time', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/spaces',
        headers: asAdmin(),
        payload: {
          name: 'Test aula 9.9',
          building: 'Edifici C',
          capacity: 40,
          type: 'classroom',
          equipment: ['projector'],
        },
      })

      expect(created.statusCode).toBe(201)
      const id = created.json().id
      expect(created.json().equipment).toEqual(['projector'])

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/spaces/${id}`,
        headers: asAdmin(),
        payload: { capacity: 55 },
      })
      expect(updated.statusCode).toBe(200)
      expect(updated.json().capacity).toBe(55)

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/spaces/${id}`,
        headers: asAdmin(),
      })
      expect(removed.statusCode).toBe(200)

      const audit = await prisma.auditLog.findMany({
        where: { entity: 'space', entityId: id },
        orderBy: { createdAt: 'asc' },
      })
      expect(audit.map((entry) => entry.action)).toEqual(['create', 'update', 'delete'])
      // R4: before/after, so a change can be explained afterwards.
      const update = audit.find((entry) => entry.action === 'update')
      expect((update?.beforeJson as { capacity?: number } | null)?.capacity).toBe(40)
      expect((update?.afterJson as { capacity?: number } | null)?.capacity).toBe(55)
    })

    it('rejects invalid input with per-field keys', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/spaces',
        headers: asAdmin(),
        payload: { name: '', capacity: 0, type: 'not-a-type' },
      })

      expect(response.statusCode).toBe(422)
      const paths = response.json().error.details.map((detail: { path: string }) => detail.path)
      expect(paths).toContain('name')
      expect(paths).toContain('capacity')
      expect(paths).toContain('type')
    })

    it('lets a teacher read spaces but never write them', async () => {
      const read = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/spaces',
        headers: asTeacher(),
      })
      expect(read.statusCode).toBe(200)

      const write = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/spaces',
        headers: asTeacher(),
        payload: { name: 'Test aula prohibida', capacity: 10, type: 'classroom' },
      })
      expect(write.statusCode).toBe(403)
    })

    it('refuses to delete a row other records depend on', async () => {
      const degree = await prisma.degree.findFirst({ where: { centerId, code: 'GEI' } })

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/degrees/${degree?.id}`,
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(409)
      expect(await prisma.degree.findUnique({ where: { id: degree!.id } })).not.toBeNull()
    })
  })

  describe('platform resources', () => {
    it('are reserved for the superadmin', async () => {
      const asCenterAdmin = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/universities',
        headers: asAdmin(),
      })
      expect(asCenterAdmin.statusCode).toBe(403)

      const asSuperadmin = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/universities',
        headers: { 'x-mock-user': SEED.superadminEmail },
      })
      expect(asSuperadmin.statusCode).toBe(200)
      expect(asSuperadmin.json().items.length).toBeGreaterThanOrEqual(1)
    })

    it('refuses to bind a center to an unregistered Entra tenant (R3)', async () => {
      const university = await prisma.university.findFirst()

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/centers',
        headers: { 'x-mock-user': SEED.superadminEmail },
        payload: {
          universityId: university?.id,
          name: 'Centre amb tenant inventat',
          code: 'FAKE',
          entraTenantId: '00000000-9999-4999-8999-999999999999',
        },
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error.details[0].messageKey).toBe('auth.errors.tenantNotAuthorized')
    })
  })

  describe('users and roles', () => {
    it('lets the platform administrator manage people too', async () => {
      // Without this a fresh installation is a dead end: its only account is a
      // superadmin, who could create centers and then nobody to work in them.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users?pageSize=100',
        headers: asSuperadmin(),
      })

      expect(response.statusCode).toBe(200)
    })

    it('refuses to let a center administrator mint a platform superadmin', async () => {
      // The sibling route has always refused this; creating a user did not,
      // which made it an escalation rather than a boundary.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: asAdmin(),
        payload: {
          email: 'escalation-attempt@demo.uacademic.test',
          firstName: 'Cap',
          lastName: 'Escalada',
          locale: 'ca',
          grants: [{ centerId, role: 'SUPERADMIN' }],
        },
      })

      expect(response.statusCode).toBe(403)

      const created = await prisma.user.findUnique({
        where: { email: 'escalation-attempt@demo.uacademic.test' },
      })
      expect(created).toBeNull()
    })

    it('lists only people with a role in the active center', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users?pageSize=100',
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(200)
      const emails = response.json().items.map((user: { email: string }) => user.email)
      expect(emails).toContain(SEED.teacherEmail)
      expect(emails).not.toContain(FOREIGN.userEmail)
    })

    it('filters by role and by status', async () => {
      const coordinators = await app.inject({
        method: 'GET',
        url: '/api/v1/users?role=COORDINATOR',
        headers: asAdmin(),
      })

      expect(coordinators.statusCode).toBe(200)
      const emails = coordinators.json().items.map((user: { email: string }) => user.email)
      expect(emails).toContain(SEED.teacherEmail)
      expect(emails).not.toContain(SEED.otherTeacherEmail)
    })

    it('activates an account that JIT provisioning left pending', async () => {
      const pending = await prisma.user.upsert({
        where: { email: 'pendent@demo.uacademic.test' },
        create: {
          email: 'pendent@demo.uacademic.test',
          firstName: 'Pendent',
          lastName: 'Activació',
          status: 'pending_activation',
          centerRoles: { create: { centerId, role: 'TEACHER' } },
        },
        update: { status: 'pending_activation' },
      })

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${pending.id}/activate`,
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().status).toBe('active')

      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'user', entityId: pending.id, action: 'activate' },
      })
      expect(audit).not.toBeNull()
    })

    it('does not let a center administrator mint superadmins', async () => {
      const teacher = await prisma.user.findUnique({ where: { email: SEED.otherTeacherEmail } })

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${teacher?.id}/roles`,
        headers: asAdmin(),
        payload: { role: 'SUPERADMIN' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('cannot touch a user from another center', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${FOREIGN.userId}/activate`,
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(404)
    })
  })
})
