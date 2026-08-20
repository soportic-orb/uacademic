/**
 * Who somebody may write to.
 *
 * A university is not itself a tenant — everything else in the product belongs
 * to a center — so the "university" scope is the one deliberate widening in
 * the product, and what matters is that it stops there.
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

describe.skipIf(!hasDatabase)('choosing who to write to', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let headers: Record<string, string>
  let siblingCenterId: string
  const made: string[] = []

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    headers = { 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId }
    await ensureForeignCenter()

    // A second faculty of the *same* university as the seeded center.
    const here = await prisma.center.findUniqueOrThrow({ where: { id: centerId } })
    const sibling = await prisma.center.create({
      data: {
        universityId: here.universityId,
        name: 'Facultat Germana',
        code: 'GER',
        settingsJson: {},
      },
    })
    siblingCenterId = sibling.id

    const colleague = await prisma.user.create({
      data: { email: 'germana@demo.uacademic.test', firstName: 'Anna', lastName: 'Germana' },
    })
    made.push(colleague.id)
    await prisma.userCenterRole.create({
      data: { userId: colleague.id, centerId: siblingCenterId, role: 'TEACHER' },
    })
  })

  afterAll(async () => {
    await prisma.userCenterRole.deleteMany({ where: { centerId: siblingCenterId } })
    await prisma.user.deleteMany({ where: { id: { in: made } } })
    await prisma.center.delete({ where: { id: siblingCenterId } })
    await app.close()
    await disconnectPrisma()
  })

  const list = (scope: string, q?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/conversations/recipients?scope=${scope}${q ? `&q=${q}` : ''}`,
      headers,
    })

  it('offers the people of this center, and not the sibling faculty', async () => {
    const response = await list('center')

    expect(response.statusCode).toBe(200)
    const emails = response.json().items.map((row: { email: string }) => row.email)
    expect(emails).toContain(SEED.otherTeacherEmail)
    expect(emails).not.toContain('germana@demo.uacademic.test')
  })

  it('reaches across the university when asked, and no further', async () => {
    const response = await list('university')

    const emails = response.json().items.map((row: { email: string }) => row.email)
    expect(emails).toContain('germana@demo.uacademic.test')
    // The other university stays out of it, in either scope.
    expect(emails).not.toContain(FOREIGN.userEmail)
  })

  it('never offers somebody themselves', async () => {
    const response = await list('university')

    const emails = response.json().items.map((row: { email: string }) => row.email)
    expect(emails).not.toContain(SEED.teacherEmail)
  })

  it('searches by name as well as by address', async () => {
    const response = await list('university', 'Germana')

    const emails = response.json().items.map((row: { email: string }) => row.email)
    expect(emails).toEqual(['germana@demo.uacademic.test'])
  })
})
