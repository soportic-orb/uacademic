/**
 * The planner API: versions and their lifecycle, session edits with live
 * validation, publication with its diff and notifications, and the automatic
 * generation running in a worker thread.
 *
 * Publication mutates shared demo state on purpose (it archives whatever was
 * live), so every test that publishes puts the seeded version back afterwards.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

const TEST_PREFIX = 'Test planner '

describe.skipIf(!hasDatabase)('the planner', () => {
  let app: FastifyInstance
  let centerId: string
  let publishedVersionId: string
  const prisma = getPrismaClient()

  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  const createVersion = async (name: string, fromVersionId?: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/planner/versions',
      headers: asCoordinator(),
      payload: { name: `${TEST_PREFIX}${name}`, ...(fromVersionId ? { fromVersionId } : {}) },
    })
    expect(response.statusCode).toBe(201)
    return response.json()
  }

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()

    const seeded = await prisma.scheduleVersion.findFirst({
      where: { centerId, status: 'published' },
    })
    publishedVersionId = seeded!.id
  })

  afterEach(async () => {
    // Whatever a test published, the seeded version is the live one again.
    await prisma.classSession.deleteMany({
      where: { scheduleVersion: { name: { startsWith: TEST_PREFIX } } },
    })
    await prisma.scheduleVersion.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } })
    await prisma.scheduleVersion.update({
      where: { id: publishedVersionId },
      data: { status: 'published' },
    })
  })

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { type: 'schedule.generate' } })
    await app.close()
    await disconnectPrisma()
  })

  describe('versions', () => {
    it('lists the seeded published version and the draft derived from it', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/planner/versions',
        headers: asCoordinator(),
      })

      expect(response.statusCode).toBe(200)
      const statuses = response.json().items.map((item: { status: string }) => item.status)
      expect(statuses).toContain('published')
      expect(statuses).toContain('draft')

      const published = response
        .json()
        .items.find((item: { status: string }) => item.status === 'published')
      expect(published.editable).toBe(false)
      expect(published.sessions).toBeGreaterThan(0)
    })

    it('copies the sessions of the version a draft is derived from', async () => {
      const source = await app.inject({
        method: 'GET',
        url: `/api/v1/planner/versions/${publishedVersionId}`,
        headers: asCoordinator(),
      })
      const created = await createVersion('copy', publishedVersionId)

      expect(created.status).toBe('draft')
      expect(created.editable).toBe(true)
      expect(created.sessions).toHaveLength(source.json().sessions.length)
      expect(created.parentVersionId).toBe(publishedVersionId)
    })

    it('keeps a plain teacher out of the planner entirely', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/planner/versions',
        headers: asTeacher(),
      })
      expect(response.statusCode).toBe(403)
    })

    it('reports the week with its conflicts, penalties and pending groups', async () => {
      const version = await createVersion('summary', publishedVersionId)

      expect(version.summary).toMatchObject({ blocked: 0 })
      expect(version.summary.placed).toBe(version.sessions.length)
      expect(version.grid).toMatchObject({ dayStart: '08:00', slotMinutes: 30 })
      expect(Array.isArray(version.pending)).toBe(true)
    })
  })

  describe('editing a draft', () => {
    it('adds, moves and removes a session', async () => {
      const version = await createVersion('edit')
      const group = await prisma.group.findFirst({ where: { centerId } })
      const profile = await prisma.teacherProfile.findFirst({ where: { centerId } })
      const space = await prisma.space.findFirst({ where: { centerId } })

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: {
          groupId: group!.id,
          teacherProfileId: profile!.id,
          spaceId: space!.id,
          weekday: 5,
          startTime: '08:00',
          endTime: '10:00',
        },
      })

      expect(created.statusCode).toBe(201)
      expect(created.json().sessions).toHaveLength(1)
      const sessionId = created.json().sessions[0].id

      const moved = await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/sessions/${sessionId}`,
        headers: asCoordinator(),
        payload: { weekday: 4, startTime: '10:00', endTime: '12:00' },
      })

      expect(moved.statusCode).toBe(200)
      expect(moved.json().sessions[0]).toMatchObject({ weekday: 4, startTime: '10:00' })

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/planner/versions/${version.id}/sessions/${sessionId}`,
        headers: asCoordinator(),
      })
      expect(removed.json().sessions).toHaveLength(0)
    })

    it('refuses to touch a published version', async () => {
      const group = await prisma.group.findFirst({ where: { centerId } })
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${publishedVersionId}/sessions`,
        headers: asCoordinator(),
        payload: { groupId: group!.id, weekday: 1, startTime: '08:00', endTime: '09:00' },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.messageKey).toBe('planner.version.errors.notEditable')
    })

    it('records every edit in the audit log (R4)', async () => {
      const version = await createVersion('audit')
      const group = await prisma.group.findFirst({ where: { centerId } })

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: { groupId: group!.id, weekday: 5, startTime: '19:00', endTime: '20:00' },
      })

      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'class_session', entityId: created.json().sessions[0].id },
      })
      expect(entry?.action).toBe('session.create')
      expect(entry?.source).toBe('user')
    })
  })

  describe('validation on the fly', () => {
    it('answers green, amber or red with the reason', async () => {
      const version = await createVersion('validate', publishedVersionId)
      const existing = version.sessions[0]

      const blocked = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/validate`,
        headers: asCoordinator(),
        payload: {
          groupId: existing.groupId,
          teacherProfileId: existing.teacherProfileId,
          spaceId: existing.spaceId,
          weekday: existing.weekday,
          startTime: existing.startTime,
          endTime: existing.endTime,
        },
      })

      expect(blocked.statusCode).toBe(200)
      expect(blocked.json().status).toBe('blocked')
      expect(blocked.json().violations[0].messageKey).toMatch(/^planner\.hard\./)

      // The same slot is fine for the session that already occupies it.
      const itself = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/validate`,
        headers: asCoordinator(),
        payload: {
          sessionId: existing.id,
          groupId: existing.groupId,
          teacherProfileId: existing.teacherProfileId,
          spaceId: existing.spaceId,
          weekday: existing.weekday,
          startTime: existing.startTime,
          endTime: existing.endTime,
        },
      })

      expect(itself.json().status).not.toBe('blocked')
    })

    it('blocks a slot the teacher declared unavailable', async () => {
      const version = await createVersion('unavailable')
      const group = await prisma.group.findFirst({ where: { centerId } })
      const profile = await prisma.teacherProfile.findFirst({
        where: { centerId, availability: { some: {} } },
        include: { availability: true },
      })

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/validate`,
        headers: asCoordinator(),
        payload: {
          groupId: group!.id,
          teacherProfileId: profile!.id,
          spaceId: null,
          // Nobody declares availability at dawn.
          weekday: 6,
          startTime: '08:00',
          endTime: '09:00',
        },
      })

      expect(response.json().status).toBe('blocked')
      expect(
        response.json().violations.map((violation: { constraint: string }) => violation.constraint),
      ).toContain('teacherUnavailable')
    })
  })

  describe('publishing', () => {
    it('does not notify anyone while the version is a draft', async () => {
      const before = await prisma.notification.count({ where: { type: 'schedule.published' } })
      const version = await createVersion('quiet', publishedVersionId)

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/status`,
        headers: asCoordinator(),
        payload: { status: 'in_review' },
      })

      expect(await prisma.notification.count({ where: { type: 'schedule.published' } })).toBe(
        before,
      )
    })

    it('publishes, snapshots, archives the previous version and notifies only the affected', async () => {
      const version = await createVersion('publish', publishedVersionId)

      // One session moves: exactly one teacher should hear about it.
      const moved = version.sessions[0]
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/sessions/${moved.id}`,
        headers: asCoordinator(),
        payload: { weekday: moved.weekday === 5 ? 4 : 5 },
      })

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/status`,
        headers: asCoordinator(),
        payload: { status: 'in_review' },
      })

      const before = await prisma.notification.count({ where: { type: 'schedule.published' } })

      const published = await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/status`,
        headers: asCoordinator(),
        payload: { status: 'published' },
      })

      expect(published.statusCode).toBe(200)
      expect(published.json().status).toBe('published')
      expect(published.json().diff).toMatchObject({ changed: 1, added: 0, removed: 0 })
      expect(published.json().notified).toBe(1)

      const stored = await prisma.scheduleVersion.findUnique({ where: { id: version.id } })
      expect(Array.isArray(stored?.snapshotJson)).toBe(true)
      expect(stored?.publishedAt).not.toBeNull()

      const previous = await prisma.scheduleVersion.findUnique({
        where: { id: publishedVersionId },
      })
      expect(previous?.status).toBe('archived')

      const after = await prisma.notification.count({ where: { type: 'schedule.published' } })
      expect(after - before).toBe(1)

      const notification = await prisma.notification.findFirst({
        where: { type: 'schedule.published' },
        orderBy: { createdAt: 'desc' },
      })
      const payload = notification?.payloadJson as { changes: { messageKey: string }[] }
      expect(payload.changes[0]?.messageKey).toBe('planner.change.slot')

      // Delivery beyond the bell is queued, not done inside the request.
      const queued = await prisma.job.count({ where: { type: 'notification.deliver' } })
      expect(queued).toBeGreaterThan(0)

      await prisma.notification.deleteMany({ where: { type: 'schedule.published' } })
      await prisma.job.deleteMany({ where: { type: 'notification.deliver' } })
    })

    it('refuses to publish a week that still has a conflict', async () => {
      const version = await createVersion('conflict', publishedVersionId)
      const first = version.sessions[0]
      // Same teacher and same term: two sessions of different terms alternate
      // and would never actually collide.
      const second = version.sessions.find(
        (session: { teacherProfileId: string; id: string; dateFrom: string }) =>
          session.teacherProfileId === first.teacherProfileId &&
          session.id !== first.id &&
          session.dateFrom === first.dateFrom,
      )

      if (!second) return

      // Two sessions of the same teacher, in the same slot.
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/sessions/${second.id}`,
        headers: asCoordinator(),
        payload: {
          weekday: first.weekday,
          startTime: first.startTime,
          endTime: first.endTime,
        },
      })

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/status`,
        headers: asCoordinator(),
        payload: { status: 'in_review' },
      })

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/status`,
        headers: asCoordinator(),
        payload: { status: 'published' },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.messageKey).toBe('planner.version.errors.blockingViolations')
    })

    it('refuses a transition the lifecycle does not allow', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${publishedVersionId}/status`,
        headers: asCoordinator(),
        payload: { status: 'draft' },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.messageKey).toBe('planner.version.errors.invalidTransition')
    })
  })

  describe('comparing versions', () => {
    it('reports what changes between two versions, and for whom', async () => {
      const version = await createVersion('compare', publishedVersionId)
      const moved = version.sessions[0]

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/sessions/${moved.id}`,
        headers: asCoordinator(),
        payload: { startTime: '19:00', endTime: '21:00', weekday: 5 },
      })

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/planner/versions/${publishedVersionId}/compare?with=${version.id}`,
        headers: asCoordinator(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().summary).toMatchObject({ changed: 1, added: 0, removed: 0 })
      expect(response.json().byTeacher).toHaveLength(1)
      expect(response.json().changes[0].messageKey).toBe('planner.change.slot')
    })

    it('says plainly that two identical versions are identical', async () => {
      const version = await createVersion('identical', publishedVersionId)
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/planner/versions/${publishedVersionId}/compare?with=${version.id}`,
        headers: asCoordinator(),
      })

      expect(response.json().summary).toMatchObject({ added: 0, removed: 0, changed: 0 })
      expect(response.json().changes).toEqual([])
    })
  })

  describe('automatic generation', () => {
    it('runs in a worker thread and returns ranked proposals with their sacrifices', async () => {
      const version = await createVersion('generate')

      const started = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/generate`,
        headers: asCoordinator(),
        payload: { seed: 42, timeBudgetSeconds: 3, proposals: 3 },
      })

      expect(started.statusCode).toBe(202)
      const runId = started.json().runId
      expect(started.json().requirements).toBeGreaterThan(0)

      const run = await waitForRun(runId)
      expect(run.status).toBe('done')
      expect(run.proposals.length).toBeGreaterThan(0)
      expect(run.proposals.length).toBeLessThanOrEqual(3)

      const costs = run.proposals.map((proposal: { cost: number }) => proposal.cost)
      expect(costs).toEqual([...costs].sort((a: number, b: number) => a - b))

      for (const sacrifice of run.proposals[0].sacrifices) {
        expect(sacrifice.messageKey).toMatch(/^planner\.sacrifice\./)
      }

      const applied = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/apply`,
        headers: asCoordinator(),
        payload: { runId, proposalId: run.proposals[0].id },
      })

      expect(applied.statusCode).toBe(200)
      expect(applied.json().sessions.length).toBe(run.proposals[0].sessions.length)
      // What the generator produced is legal by construction.
      expect(applied.json().summary.blocked).toBe(0)
    }, 40_000)

    it('keeps a run inside the center that started it (R2)', async () => {
      const version = await createVersion('scoped')
      const started = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/generate`,
        headers: asCoordinator(),
        payload: { seed: 1, timeBudgetSeconds: 1 },
      })

      const runId = started.json().runId
      await waitForRun(runId)

      const foreign = await app.inject({
        method: 'GET',
        url: `/api/v1/planner/runs/${runId}`,
        headers: {
          'x-mock-user': SEED.superadminEmail,
          'x-center-id': centerId,
          'x-cross-center': 'true',
        },
      })
      expect(foreign.statusCode).toBe(200)

      // Same run id, a center it does not belong to: not found, never leaked.
      await prisma.job.update({
        where: { id: runId },
        data: { payloadJson: { centerId: 'another-center' } },
      })
      const denied = await app.inject({
        method: 'GET',
        url: `/api/v1/planner/runs/${runId}`,
        headers: asCoordinator(),
      })
      expect(denied.statusCode).toBe(404)
    }, 30_000)
  })

  async function waitForRun(runId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/planner/runs/${runId}`,
        headers: asCoordinator(),
      })
      const run = response.json()
      if (run.status !== 'processing') return run
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('generation did not finish in time')
  }
})
