/**
 * R2 end to end: a user from one center must not be able to read another
 * center's data, no matter which header they send.
 */
import { disconnectPrisma } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FOREIGN, SEED, createTestApp, ensureForeignCenter, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('cross-center access', () => {
  let app: FastifyInstance
  let centerId: string

  beforeAll(async () => {
    app = await createTestApp()
    await ensureForeignCenter()
    centerId = await seedCenterId()
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  it('rejects a center header the user has no membership in', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects',
      headers: { 'x-mock-user': SEED.teacherEmail, 'x-center-id': FOREIGN.centerId },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('TENANT_MISMATCH')
  })

  it('never returns another center rows in a list the user is allowed to read', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects',
      headers: { 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId },
    })

    expect(response.statusCode).toBe(200)
    const codes = response.json().items.map((subject: { code: string }) => subject.code)
    expect(codes).not.toContain('SECRET01')
    expect(codes.length).toBeGreaterThan(0)
  })

  it('rejects the cross-center header for anyone but SUPERADMIN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects',
      headers: {
        'x-mock-user': SEED.adminEmail,
        'x-center-id': FOREIGN.centerId,
        'x-cross-center': 'true',
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')
  })

  it('lets SUPERADMIN cross centers and records it in the audit log', async () => {
    const { getPrismaClient } = await import('@uacademic/db')
    const prisma = getPrismaClient()

    const before = await prisma.auditLog.count({
      where: { action: 'cross_center_access', centerId: FOREIGN.centerId },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects',
      headers: {
        'x-mock-user': SEED.superadminEmail,
        'x-center-id': FOREIGN.centerId,
        'x-cross-center': 'true',
      },
    })

    expect(response.statusCode).toBe(200)
    const codes = response.json().items.map((subject: { code: string }) => subject.code)
    expect(codes).toContain('SECRET01')

    const after = await prisma.auditLog.count({
      where: { action: 'cross_center_access', centerId: FOREIGN.centerId },
    })
    expect(after).toBe(before + 1)
  })

  it('keeps the outsider out of the demo center', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects',
      headers: { 'x-mock-user': FOREIGN.userEmail, 'x-center-id': centerId },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('TENANT_MISMATCH')
  })
})
