/**
 * Who a user belongs to, and who decides.
 *
 * An account is global; the roles are per center, and one person can hold
 * several across several universities. The line that matters is that a center
 * administrator staffs their own centers and no others — the route guard only
 * proves they administer *something*, so the payload has to be checked too.
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

describe.skipIf(!hasDatabase)('granting access to centers', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  const created: string[] = []

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    await ensureForeignCenter()
  })

  afterAll(async () => {
    await prisma.userCenterRole.deleteMany({ where: { userId: { in: created } } })
    await prisma.userInvitation.deleteMany({ where: { userId: { in: created } } })
    await prisma.user.deleteMany({ where: { id: { in: created } } })
    await app.close()
    await disconnectPrisma()
  })

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })
  const asSuperadmin = () => ({ 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId })

  interface NewUser {
    email: string
    firstName: string
    lastName: string
    grants: { centerId: string; role: string }[]
  }

  const create = (headers: Record<string, string>, body: NewUser) =>
    app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: body })

  it('creates one account holding roles in several centers at once', async () => {
    const response = await create(asSuperadmin(), {
      email: 'multi.centre@demo.uacademic.test',
      firstName: 'Multi',
      lastName: 'Centre',
      grants: [
        { centerId, role: 'COORDINATOR' },
        { centerId: FOREIGN.centerId, role: 'TEACHER' },
      ],
    })

    expect(response.statusCode).toBe(201)
    created.push(response.json().id)

    const roles = await prisma.userCenterRole.findMany({ where: { userId: response.json().id } })
    expect(roles).toHaveLength(2)
    expect(roles.map((role) => role.role).sort()).toEqual(['COORDINATOR', 'TEACHER'])
  })

  it('refuses a center administrator naming a center that is not theirs', async () => {
    const response = await create(asAdmin(), {
      email: 'intrus@demo.uacademic.test',
      firstName: 'Intrús',
      lastName: 'Prova',
      grants: [{ centerId: FOREIGN.centerId, role: 'TEACHER' }],
    })

    expect(response.statusCode).toBe(403)
    const leaked = await prisma.user.findUnique({
      where: { email: 'intrus@demo.uacademic.test' },
    })
    expect(leaked).toBeNull()
  })

  it('refuses the whole request when one grant of several is out of bounds', async () => {
    const response = await create(asAdmin(), {
      email: 'mig.intrus@demo.uacademic.test',
      firstName: 'Mig',
      lastName: 'Intrús',
      grants: [
        { centerId, role: 'TEACHER' },
        { centerId: FOREIGN.centerId, role: 'TEACHER' },
      ],
    })

    expect(response.statusCode).toBe(403)
    // Not even the grant they were entitled to: an account half-created is
    // worse than none, because the screen said it failed.
    const leaked = await prisma.user.findUnique({
      where: { email: 'mig.intrus@demo.uacademic.test' },
    })
    expect(leaked).toBeNull()
  })

  it('still refuses a center administrator handing out platform administration', async () => {
    const response = await create(asAdmin(), {
      email: 'aspirant@demo.uacademic.test',
      firstName: 'Aspirant',
      lastName: 'Prova',
      grants: [{ centerId, role: 'SUPERADMIN' }],
    })

    expect(response.statusCode).toBe(403)
  })

  it('adds a role to somebody who already exists instead of duplicating them', async () => {
    const first = await create(asSuperadmin(), {
      email: 'ja.existeix@demo.uacademic.test',
      firstName: 'Ja',
      lastName: 'Existeix',
      grants: [{ centerId, role: 'TEACHER' }],
    })
    created.push(first.json().id)

    const again = await create(asSuperadmin(), {
      email: 'ja.existeix@demo.uacademic.test',
      firstName: 'Ja',
      lastName: 'Existeix',
      grants: [{ centerId: FOREIGN.centerId, role: 'TEACHER' }],
    })

    expect(again.statusCode).toBe(201)
    expect(again.json().created).toBe(false)
    expect(again.json().id).toBe(first.json().id)

    const roles = await prisma.userCenterRole.findMany({ where: { userId: first.json().id } })
    expect(roles).toHaveLength(2)
  })

  it('offers a center administrator only the centers they administer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/grantable-centers',
      headers: asAdmin(),
    })

    expect(response.statusCode).toBe(200)
    const ids = response
      .json()
      .universities.flatMap((university: { centers: { id: string }[] }) => university.centers)
      .map((center: { id: string }) => center.id)

    expect(ids).toContain(centerId)
    expect(ids).not.toContain(FOREIGN.centerId)
  })

  it('offers the superadmin every center, grouped by university', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/grantable-centers',
      headers: asSuperadmin(),
    })

    const universities = response.json().universities as { name: string; centers: unknown[] }[]
    expect(universities.length).toBeGreaterThan(1)
    expect(universities.every((university) => university.centers.length > 0)).toBe(true)
  })
})
