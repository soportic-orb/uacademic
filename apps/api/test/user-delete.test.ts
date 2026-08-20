/**
 * Removing a person from the platform.
 *
 * There is no single answer to what "delete" means for a user: the audit log
 * refuses to give up its author (R4), so an account that has ever done anything
 * cannot be erased without erasing the record of it. What the route promises is
 * that the person loses this center and, where the account can go, it goes.
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

describe.skipIf(!hasDatabase)('removing a user', () => {
  let app: FastifyInstance
  let centerId: string
  const prisma = getPrismaClient()

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    await ensureForeignCenter()
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })

  /** Someone with no history: created for this test and nothing else. */
  const newcomer = async (email: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { ...asAdmin(), 'content-type': 'application/json' },
      payload: {
        email,
        firstName: 'Nova',
        lastName: 'Persona',
        grants: [{ centerId, role: 'TEACHER' }],
      },
    })
    expect(response.statusCode).toBe(201)
    return response.json().id as string
  }

  it('deletes an account that has left no trace behind it', async () => {
    const id = await newcomer('acomiadada@demo.uacademic.test')

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${id}`,
      headers: asAdmin(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().outcome).toBe('deleted')
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull()
  })

  it('suspends instead of deleting when the audit log holds on to them', async () => {
    const id = await newcomer('amb-historial@demo.uacademic.test')
    await prisma.auditLog.create({
      data: {
        centerId,
        userId: id,
        entity: 'subject',
        entityId: id,
        action: 'update',
        source: 'user',
      },
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${id}`,
      headers: asAdmin(),
    })

    expect(response.json().outcome).toBe('suspended')

    const user = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(user.status).toBe('suspended')
    // The point of suspending rather than deleting: they are still nobody's
    // colleague in this center.
    expect(await prisma.userCenterRole.count({ where: { userId: id } })).toBe(0)

    await prisma.auditLog.deleteMany({ where: { userId: id } })
    await prisma.user.delete({ where: { id } })
  })

  it('keeps an account that still belongs to another center', async () => {
    const id = await newcomer('a-dos-centres@demo.uacademic.test')
    await prisma.userCenterRole.create({
      data: { userId: id, centerId: FOREIGN.centerId, role: 'TEACHER' },
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${id}`,
      headers: asAdmin(),
    })

    expect(response.json().outcome).toBe('unlinked')

    const remaining = await prisma.userCenterRole.findMany({ where: { userId: id } })
    expect(remaining.map((grant) => grant.centerId)).toEqual([FOREIGN.centerId])

    await prisma.userCenterRole.deleteMany({ where: { userId: id } })
    await prisma.user.delete({ where: { id } })
  })

  it('refuses to let anybody delete the account they are signed in with', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: SEED.adminEmail } })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${admin.id}`,
      headers: asAdmin(),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.details[0].messageKey).toBe('admin.errors.cannotDeleteSelf')
  })

  it('cannot reach a person who belongs to another center (R2)', async () => {
    const outsider = await prisma.user.findUniqueOrThrow({ where: { email: FOREIGN.userEmail } })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${outsider.id}`,
      headers: asAdmin(),
    })

    expect(response.statusCode).toBe(404)
  })
})
