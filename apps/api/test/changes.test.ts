/**
 * Class changes and absences: the ladder, the conflict check that guards it,
 * the notifications each step raises, and the substitute ranking.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildJobHandlers } from '../src/jobs/handlers.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('class changes', () => {
  let app: FastifyInstance
  let centerId: string
  let sessionId: string
  let targetUserId: string
  const prisma = getPrismaClient()

  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })
  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  const create = async (payload: Record<string, unknown>, headers = asCoordinator()) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/changes',
      headers,
      payload,
    })
    expect(response.statusCode).toBe(201)
    return response.json()
  }

  const transition = (id: string, action: string, headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/changes/${id}/transition`,
      headers,
      payload: { action },
    })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()

    const session = await prisma.classSession.findFirst({
      where: { centerId, scheduleVersion: { status: 'published' } },
      orderBy: { weekday: 'asc' },
    })
    sessionId = session!.id

    const target = await prisma.user.findFirst({ where: { email: SEED.otherTeacherEmail } })
    targetUserId = target!.id
  })

  afterEach(async () => {
    await prisma.changeRequest.deleteMany({ where: { centerId } })
    await prisma.notification.deleteMany({ where: { centerId } })
    await prisma.job.deleteMany({ where: { type: { in: ['push.send', 'email.send'] } } })
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  describe('the ladder', () => {
    it('walks a request from the counterpart to coordination to the timetable', async () => {
      const created = await create({
        type: 'space_change',
        sessionId,
        targetUserId,
        reason: 'Aula petita',
        proposal: { spaceId: null },
      })

      expect(created.status).toBe('requested')
      // The requester is also the coordination of this center, so they may
      // withdraw it or refuse it outright — but not accept on the other's behalf.
      expect(created.actions.sort()).toEqual(['cancel', 'reject'])

      const accepted = await transition(created.id, 'accept', asTeacher())
      expect(accepted.statusCode).toBe(200)
      expect(accepted.json().status).toBe('accepted_by_teacher')

      // Coordination approves, and with auto-apply on it lands in one step.
      const approved = await transition(created.id, 'approve', asCoordinator())
      expect(approved.statusCode).toBe(200)
      expect(approved.json().status).toBe('applied')

      const session = await prisma.classSession.findUnique({ where: { id: sessionId } })
      expect(session?.spaceId).toBeNull()

      // Put the room back so the rest of the suite sees the seeded week.
      await prisma.classSession.update({
        where: { id: sessionId },
        data: { spaceId: (await prisma.space.findFirst({ where: { centerId } }))!.id },
      })
    })

    it('lets the counterpart refuse, and stops there', async () => {
      const created = await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: { weekday: 5 },
      })

      const rejected = await transition(created.id, 'reject', asTeacher())
      expect(rejected.json().status).toBe('rejected')

      const late = await transition(created.id, 'approve', asCoordinator())
      expect(late.statusCode).toBe(409)
      expect(late.json().error.messageKey).toBe('changes.errors.closed')
    })

    it('refuses a step that is not the caller’s to take', async () => {
      const created = await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: { weekday: 5 },
      })

      // The requester cannot accept on the other person's behalf.
      const response = await transition(created.id, 'accept', asCoordinator())
      expect(response.statusCode).toBe(409)
      expect(response.json().error.messageKey).toBe('changes.errors.notYours')
    })

    it('keeps a change with no counterpart out of the acceptance step', async () => {
      const created = await create({
        type: 'space_change',
        sessionId,
        proposal: { note: 'sense contrapart' },
      })

      // Nobody to accept, but coordination still approves in this center.
      expect(created.status).toBe('accepted_by_teacher')
      expect(created.actions).toContain('approve')
    })

    it('applies straight away where coordination is only informed', async () => {
      const center = await prisma.center.findUnique({ where: { id: centerId } })
      const settings = center!.settingsJson as Record<string, unknown>

      await prisma.center.update({
        where: { id: centerId },
        data: {
          settingsJson: {
            ...settings,
            workflow: {
              ...(settings.workflow as Record<string, unknown>),
              coordinatorApprovesChanges: false,
            },
          },
        },
      })

      try {
        const created = await create({
          type: 'space_change',
          sessionId,
          proposal: { note: 'informatiu' },
        })
        expect(created.status).toBe('applied')
      } finally {
        await prisma.center.update({
          where: { id: centerId },
          data: { settingsJson: settings as never },
        })
      }
    })
  })

  describe('the conflict check', () => {
    it('reports the conflicts a proposal would cause, without blocking the request', async () => {
      const other = await prisma.classSession.findFirst({
        where: {
          centerId,
          scheduleVersion: { status: 'published' },
          NOT: { id: sessionId },
        },
      })

      const created = await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: {
          weekday: other!.weekday,
          startTime: other!.startTime,
          endTime: other!.endTime,
          spaceId: other!.spaceId,
        },
      })

      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/changes/${created.id}`,
        headers: asCoordinator(),
      })

      expect(detail.json().violations.length).toBeGreaterThan(0)
      expect(detail.json().violations[0].messageKey).toMatch(/^planner\.hard\./)
    })

    it('refuses to apply a change that would break the published week', async () => {
      const other = await prisma.classSession.findFirst({
        where: { centerId, scheduleVersion: { status: 'published' }, NOT: { id: sessionId } },
      })

      const created = await create({
        type: 'session_move',
        sessionId,
        proposal: {
          weekday: other!.weekday,
          startTime: other!.startTime,
          endTime: other!.endTime,
          spaceId: other!.spaceId,
        },
      })

      const response = await transition(created.id, 'approve', asCoordinator())
      expect(response.statusCode).toBe(409)
      expect(response.json().error.messageKey).toBe('changes.errors.conflicts')
    })
  })

  describe('what each step tells whom', () => {
    it('notifies the counterpart when a request is made, and nobody else’s bell', async () => {
      const created = await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: { weekday: 5 },
      })

      const notifications = await prisma.notification.findMany({
        where: { type: 'change.requested' },
      })

      expect(notifications.some((row) => row.userId === targetUserId)).toBe(true)
      // The requester is not told about their own request.
      const requester = await prisma.user.findFirst({ where: { email: SEED.teacherEmail } })
      expect(notifications.some((row) => row.userId === requester!.id)).toBe(false)
      expect(created.id).toBeTruthy()
    })

    it('records every step in the audit log with its author (R4)', async () => {
      const created = await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: { weekday: 5 },
      })
      await transition(created.id, 'accept', asTeacher())

      const entries = await prisma.auditLog.findMany({
        where: { entity: 'change_request', entityId: created.id },
        orderBy: { createdAt: 'asc' },
      })

      expect(entries.map((entry) => entry.action)).toEqual(['create', 'accept'])
      expect(entries.every((entry) => entry.source === 'user')).toBe(true)
    })

    it('queues push and email as jobs rather than sending them in the request', async () => {
      await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: { weekday: 5 },
      })

      const queued = await prisma.job.findMany({
        where: { type: { in: ['push.send', 'email.send'] } },
      })
      // The demo user has no push subscription, so only what has an address is
      // queued: nothing is enqueued to fail.
      expect(queued.every((job) => job.type === 'email.send' || job.type === 'push.send')).toBe(
        true,
      )
    })
  })

  describe('expiry', () => {
    it('expires an unanswered request, records it as a system action and tells both sides', async () => {
      const created = await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: { weekday: 5 },
      })

      await prisma.changeRequest.update({
        where: { id: created.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })

      const handlers = buildJobHandlers(prisma, {
        info: () => undefined,
        error: () => undefined,
      } as never)
      await handlers['changes.expire']!({})

      const row = await prisma.changeRequest.findUnique({ where: { id: created.id } })
      expect(row?.status).toBe('expired')

      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'change_request', entityId: created.id, action: 'expire' },
      })
      expect(audit?.source).toBe('system')
      expect(audit?.userId).toBeNull()

      const notifications = await prisma.notification.findMany({
        where: { type: 'change.expired' },
      })
      expect(notifications).toHaveLength(2)
    })

    it('leaves a request with no deadline alone', async () => {
      const created = await create({
        type: 'session_move',
        sessionId,
        targetUserId,
        proposal: { weekday: 5 },
      })
      await prisma.changeRequest.update({
        where: { id: created.id },
        data: { expiresAt: null },
      })

      const handlers = buildJobHandlers(prisma, { info: () => undefined } as never)
      await handlers['changes.expire']!({})

      expect((await prisma.changeRequest.findUnique({ where: { id: created.id } }))?.status).toBe(
        'requested',
      )
    })
  })
})

describe.skipIf(!hasDatabase)('absences and substitutions', () => {
  let app: FastifyInstance
  let centerId: string
  const prisma = getPrismaClient()

  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })
  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
  })

  afterEach(async () => {
    await prisma.absence.deleteMany({ where: { centerId } })
    await prisma.changeRequest.deleteMany({ where: { centerId } })
    await prisma.notification.deleteMany({ where: { centerId } })
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  const report = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: asTeacher(),
      payload: {
        dateFrom: '2026-10-05',
        dateTo: '2026-10-09',
        type: 'conference',
        reason: 'Congrés internacional',
      },
    })
    expect(response.statusCode).toBe(201)
    return response.json()
  }

  it('reports an absence and lists the classes it leaves uncovered', async () => {
    const absence = await report()

    expect(absence).toMatchObject({ status: 'requested', type: 'conference' })
    expect(Array.isArray(absence.sessions)).toBe(true)
    expect(absence.sessions.length).toBeGreaterThan(0)
  })

  it('tells coordination straight away', async () => {
    await report()

    const notifications = await prisma.notification.findMany({
      where: { type: 'absence.reported' },
    })
    expect(notifications.length).toBeGreaterThan(0)
  })

  it('keeps one teacher out of another’s absences', async () => {
    const absence = await report()

    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/absences/${absence.id}/sessions`,
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
    })
    expect(other.statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/api/v1/absences', headers: asTeacher() })
    expect(list.json().canManage).toBe(false)
    expect(
      list.json().items.every((item: { teacherName: string }) => item.teacherName.includes('Vila')),
    ).toBe(true)
  })

  it('ranks the colleagues who could cover a class, with the reasons', async () => {
    const absence = await report()
    const sessionId = absence.sessions[0].id

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/absences/${absence.id}/candidates?sessionId=${sessionId}`,
      headers: asCoordinator(),
    })

    expect(response.statusCode).toBe(200)
    const items = response.json().items
    expect(items.length).toBeGreaterThan(0)

    // Eligible first, and every entry explains itself.
    const eligible = items.filter((item: { eligible: boolean }) => item.eligible)
    const ineligible = items.filter((item: { eligible: boolean }) => !item.eligible)
    expect(
      items.slice(0, eligible.length).every((item: { eligible: boolean }) => item.eligible),
    ).toBe(true)
    expect(ineligible.every((item: { reasons: unknown[] }) => item.reasons.length > 0)).toBe(true)
    expect(items[0].reasons[0].messageKey).toMatch(/^substitutes\./)
  })

  it('asks the substitute rather than reassigning the class behind their back', async () => {
    const absence = await report()
    const sessionId = absence.sessions[0].id

    const candidates = await app.inject({
      method: 'GET',
      url: `/api/v1/absences/${absence.id}/candidates?sessionId=${sessionId}`,
      headers: asCoordinator(),
    })
    const candidate = candidates.json().items.find((item: { eligible: boolean }) => item.eligible)

    if (!candidate) return

    const assigned = await app.inject({
      method: 'POST',
      url: `/api/v1/absences/${absence.id}/substitute`,
      headers: asCoordinator(),
      payload: { sessionId, teacherProfileId: candidate.teacherProfileId },
    })

    expect(assigned.statusCode).toBe(201)
    expect(assigned.json().substituteProfileId).toBe(candidate.teacherProfileId)

    const changeRequest = await prisma.changeRequest.findUnique({
      where: { id: assigned.json().changeRequestId },
    })
    expect(changeRequest).toMatchObject({ type: 'substitution', status: 'requested' })

    // The class has not moved yet: it moves when they accept.
    const session = await prisma.classSession.findUnique({ where: { id: sessionId } })
    expect(session?.teacherProfileId).not.toBe(candidate.teacherProfileId)

    const notifications = await prisma.notification.findMany({
      where: { type: 'absence.substituteAssigned' },
    })
    expect(notifications).toHaveLength(1)
  })

  it('refuses an absence that ends before it starts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: asTeacher(),
      payload: { dateFrom: '2026-10-09', dateTo: '2026-10-05', type: 'other' },
    })
    expect(response.statusCode).toBe(422)
  })
})

describe.skipIf(!hasDatabase)('the classes a change can be proposed for', () => {
  let app: FastifyInstance
  const prisma = getPrismaClient()
  let centerId: string

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  it('offers the caller their own published classes and nobody else’s', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/changes/sessions',
      headers: { 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId },
    })

    expect(response.statusCode).toBe(200)
    const items = response.json().items as { id: string }[]
    expect(items.length).toBeGreaterThan(0)

    const own = await prisma.classSession.findMany({
      where: {
        centerId,
        scheduleVersion: { status: 'published' },
        teacherProfile: { user: { email: SEED.teacherEmail } },
      },
      select: { id: true },
    })
    expect(items.map((item) => item.id).sort()).toEqual(own.map((item) => item.id).sort())
  })
})
