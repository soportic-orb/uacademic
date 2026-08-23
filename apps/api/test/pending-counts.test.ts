/**
 * The number on the menu.
 *
 * It exists so a coordinator can see there is something waiting without
 * opening the screen, which means it has to count what *they* have to act on
 * and nothing else. A badge that counts other people's work is a badge people
 * learn to ignore, and then it stops carrying the one thing it is for.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('what is waiting on the menu', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let coordinatorId: string
  let profileId: string

  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  const counts = (headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/api/v1/me/pending', headers })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    coordinatorId = (await prisma.user.findFirstOrThrow({ where: { email: SEED.teacherEmail } })).id
    profileId = (await prisma.teacherProfile.findFirstOrThrow({ where: { centerId } })).id
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  afterEach(async () => {
    await prisma.changeRequest.deleteMany({ where: { centerId } })
    await prisma.absence.deleteMany({ where: { centerId } })
  })

  const changeRequest = (status: 'requested' | 'accepted_by_teacher' | 'applied') =>
    prisma.changeRequest.create({
      data: {
        centerId,
        type: 'session_move',
        requesterId: coordinatorId,
        proposedJson: {},
        status,
      },
    })

  const absence = (status: 'requested' | 'approved') =>
    prisma.absence.create({
      data: {
        centerId,
        teacherProfileId: profileId,
        dateFrom: new Date('2026-10-05T00:00:00Z'),
        dateTo: new Date('2026-10-05T00:00:00Z'),
        type: 'sick_leave',
        status,
      },
    })

  it('is nothing at all when there is nothing to do', async () => {
    const response = await counts(asCoordinator())

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ changes: 0, absences: 0 })
  })

  it('counts a change request that is waiting on coordination', async () => {
    await changeRequest('accepted_by_teacher')

    expect((await counts(asCoordinator())).json().changes).toBe(1)
  })

  it('does not count one still waiting on the colleague it names', async () => {
    // Not coordination's to answer yet: the teacher has to accept it first.
    await changeRequest('requested')

    expect((await counts(asCoordinator())).json().changes).toBe(0)
  })

  it('does not count one that is already history', async () => {
    await changeRequest('applied')

    expect((await counts(asCoordinator())).json().changes).toBe(0)
  })

  it('counts an absence nobody has answered yet', async () => {
    await absence('requested')

    expect((await counts(asCoordinator())).json().absences).toBe(1)
  })

  it('stops counting it once it has been answered', async () => {
    await absence('approved')

    expect((await counts(asCoordinator())).json().absences).toBe(0)
  })

  it('answers a lecturer rather than refusing them', async () => {
    // Every screen a lecturer opens asks for this. Refusing it would raise a
    // permissions error on a screen they are perfectly entitled to look at —
    // which is exactly what `/ai/status` used to do from the load screen.
    const response = await counts(asTeacher())

    expect(response.statusCode).toBe(200)
  })

  it('counts nothing for somebody who does not coordinate here', async () => {
    await changeRequest('accepted_by_teacher')
    await absence('requested')

    // A lecturer has no screen to act on these from, so a number beside the
    // menu would be a number they can do nothing about.
    expect((await counts(asTeacher())).json()).toEqual({ changes: 0, absences: 0 })
  })
})
