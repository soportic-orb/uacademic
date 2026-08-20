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

  /**
   * Adding somebody to a second center used to send nothing at all — the
   * screen said the user was created and the person was never told — and the
   * answer carried no `invitationSent`, which the screen read as a mail server
   * that is not configured. On an installation whose mail works, that is a
   * false statement about the installation.
   */
  it('invites somebody who is added to a center and cannot sign in yet', async () => {
    const email = 'sense.entrada@demo.uacademic.test'
    await prisma.user.deleteMany({ where: { email } })
    // The queue outlives a test run, so the count below has to start at zero.
    await prisma.job.deleteMany({
      where: { type: 'user.invite', payloadJson: { path: '$.email', equals: email } },
    })

    const first = await create(asSuperadmin(), {
      email,
      firstName: 'Sense',
      lastName: 'Entrada',
      grants: [{ centerId, role: 'TEACHER' }],
    })
    created.push(first.json().id)

    const second = await create(asSuperadmin(), {
      email,
      firstName: 'Sense',
      lastName: 'Entrada',
      grants: [{ centerId: FOREIGN.centerId, role: 'TEACHER' }],
    })

    expect(second.statusCode).toBe(201)
    expect(second.json().created).toBe(false)
    expect(second.json().grantsAdded).toBe(1)
    // The field is always there, whichever branch answered.
    expect(second.json()).toHaveProperty('invitationSent')
    expect(second.json().alreadyCouldSignIn).toBe(false)

    const invites = await prisma.job.count({
      where: { type: 'user.invite', payloadJson: { path: '$.email', equals: email } },
    })
    expect(invites).toBe(2)
  })

  it('sends no invitation to somebody who can already sign in', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: SEED.teacherEmail } })
    await prisma.userCenterRole.deleteMany({
      where: { userId: user.id, centerId: FOREIGN.centerId },
    })
    const before = await prisma.job.count({ where: { type: 'user.invite' } })

    const response = await create(asSuperadmin(), {
      email: SEED.teacherEmail,
      firstName: 'Marta',
      lastName: 'Puig',
      grants: [{ centerId: FOREIGN.centerId, role: 'TEACHER' }],
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().alreadyCouldSignIn).toBe(true)
    expect(response.json().invitationSent).toBe(false)
    expect(await prisma.job.count({ where: { type: 'user.invite' } })).toBe(before)

    await prisma.userCenterRole.deleteMany({
      where: { userId: user.id, centerId: FOREIGN.centerId },
    })
  })

  it('says what the conflict is when somebody already has that access', async () => {
    const email = 'ja.hi.es@demo.uacademic.test'
    await prisma.user.deleteMany({ where: { email } })
    const body = {
      email,
      firstName: 'Ja',
      lastName: 'Hi És',
      grants: [{ centerId, role: 'TEACHER' }],
    }

    const first = await create(asSuperadmin(), body)
    created.push(first.json().id)

    const again = await create(asSuperadmin(), body)

    expect(again.statusCode).toBe(409)
    // "The action conflicts with the current state" told nobody anything.
    expect(again.json().error.messageKey).toBe('admin.errors.alreadyHasAccess')
  })

  it('finds somebody placed in another of the administrator’s centers', async () => {
    const email = 'a.laltre.centre@demo.uacademic.test'
    await prisma.user.deleteMany({ where: { email } })

    const response = await create(asSuperadmin(), {
      email,
      firstName: 'A',
      lastName: 'Altre Centre',
      grants: [{ centerId: FOREIGN.centerId, role: 'TEACHER' }],
    })
    created.push(response.json().id)

    const headers = { 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId }
    const here = await app.inject({ method: 'GET', url: '/api/v1/users?pageSize=100', headers })
    expect(here.json().items.map((row: { email: string }) => row.email)).not.toContain(email)

    // Naming the center is how the row is found rather than silently missing.
    const there = await app.inject({
      method: 'GET',
      url: `/api/v1/users?pageSize=100&centerId=${FOREIGN.centerId}`,
      headers,
    })
    expect(there.json().items.map((row: { email: string }) => row.email)).toContain(email)
  })

  it('refuses to list a center the administrator does not administer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/users?centerId=${FOREIGN.centerId}`,
      headers: asAdmin(),
    })

    expect(response.statusCode).toBe(403)
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
