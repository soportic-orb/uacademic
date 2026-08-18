/**
 * The data-protection duties, against a real database.
 *
 * What matters here is what is *not* in the answers: an export that carries a
 * refresh token would be a breach with good intentions, and an erasure that
 * takes the audit trail with it would leave a center unable to say who
 * approved what.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { parseCenterSettings } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyRetention, erasePersonalData } from '../src/services/privacy.js'
import {
  FOREIGN,
  SEED,
  createTestApp,
  ensureForeignCenter,
  hasDatabase,
  seedCenterId,
} from './helpers.js'

const SUBJECT_EMAIL = 'erasure-subject@demo.uacademic.test'

describe.skipIf(!hasDatabase)('data protection', () => {
  let app: FastifyInstance
  let centerId: string
  let teacherId: string
  const prisma = getPrismaClient()

  const asTeacher = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asOtherTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })
  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })

  /** The center as the suite found it: the retention tests rewrite it. */
  let originalSettings: unknown

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    teacherId = (await prisma.user.findFirstOrThrow({ where: { email: SEED.teacherEmail } })).id
    originalSettings = (await prisma.center.findUniqueOrThrow({ where: { id: centerId } }))
      .settingsJson

    await removeSubject()
  })

  afterAll(async () => {
    await removeSubject()
    await prisma.center.update({
      where: { id: centerId },
      data: { settingsJson: originalSettings as never },
    })
    await app.close()
    await disconnectPrisma()
  })

  /** The stand-in this suite erases, gone before and after whatever happens. */
  const removeSubject = async () => {
    // After an erasure the address is anonymised, so both are looked for.
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: SUBJECT_EMAIL }, { lastName: 'esborrat', firstName: 'Compte' }] },
    })
    if (!existing) return

    await prisma.auditLog.deleteMany({ where: { userId: existing.id } })
    await prisma.pushSubscription.deleteMany({ where: { userId: existing.id } })
    await prisma.userCenterRole.deleteMany({ where: { userId: existing.id } })
    await prisma.user.delete({ where: { id: existing.id } })
  }

  describe('taking your data with you', () => {
    it('hands over what is held, as a file', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me/export',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-disposition']).toContain('attachment')
      expect(response.headers['cache-control']).toContain('no-store')

      const body = response.json()
      expect(body.subject.email).toBe(SEED.teacherEmail)
      expect(body.memberships.length).toBeGreaterThan(0)
      expect(body.teaching.profiles.length).toBeGreaterThan(0)
      expect(Array.isArray(body.schedule.sessions)).toBe(true)
    })

    it('carries no key anybody could use', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me/export',
        headers: asTeacher(),
      })

      const raw = response.body
      expect(raw).not.toMatch(/refresh_token|refreshTokenEnc|accessTokenEnc/)
      // The ICS token is a bearer capability in a URL: its value never travels.
      expect(response.json().calendar.feeds.every((feed: { token?: string }) => !feed.token)).toBe(
        true,
      )
      expect(response.json().notIncluded).toContain('icsFeedTokens')
    })

    it('is written down: somebody read a person’s whole file', async () => {
      await app.inject({ method: 'GET', url: '/api/v1/me/export', headers: asTeacher() })

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'export_personal_data', entityId: teacherId },
        orderBy: { createdAt: 'desc' },
      })
      expect(entry).not.toBeNull()
    })
  })

  describe('asking to be erased', () => {
    it('records the request without changing anything yet', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/me/erasure-request',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      const user = await prisma.user.findUniqueOrThrow({ where: { id: teacherId } })
      expect(user.email).toBe(SEED.teacherEmail)

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'request_erasure', entityId: teacherId },
      })
      expect(entry).not.toBeNull()
    })

    it('is not a teacher’s to carry out on somebody else', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${teacherId}/erase`,
        headers: asOtherTeacher(),
      })

      expect(response.statusCode).toBe(403)
    })

    it('is not an administrator’s to carry out on another center’s people', async () => {
      await ensureForeignCenter()

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${FOREIGN.userId}/erase`,
        headers: asAdmin(),
      })

      // Not 403 but 404: from this center, that person does not exist (R2).
      expect(response.statusCode).toBe(404)
    })

    it('erases the person and keeps the record', async () => {
      // A user of this suite's own, so the seeded center keeps its staff.
      const victim = await prisma.user.create({
        data: {
          email: SUBJECT_EMAIL,
          firstName: 'Aina',
          lastName: 'Provisional',
          entraOid: '00000000-0000-4000-8000-00000000e1a5',
          status: 'active',
          centerRoles: { create: { centerId, role: 'TEACHER' } },
        },
      })
      await prisma.pushSubscription.create({
        data: {
          userId: victim.id,
          endpoint: 'https://push.example/erasure',
          endpointHash: 'e'.repeat(64),
          p256dh: 'key',
          auth: 'auth',
        },
      })
      await prisma.auditLog.create({
        data: {
          centerId,
          userId: victim.id,
          entity: 'class_session',
          entityId: victim.id,
          action: 'update',
          source: 'user',
        },
      })

      const result = await erasePersonalData(prisma, {
        userId: victim.id,
        requestedBy: victim.id,
      })

      const after = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } })
      expect(after.email).not.toContain('erasure-subject')
      expect(after.firstName).not.toBe('Aina')
      expect(after.entraOid).toBeNull()
      expect(after.status).toBe('suspended')

      // The devices are gone…
      expect(await prisma.pushSubscription.count({ where: { userId: victim.id } })).toBe(0)
      // …and the history is not.
      expect(await prisma.auditLog.count({ where: { userId: victim.id } })).toBeGreaterThan(0)
      expect(result.kept).toContain('auditTrail')
    })
  })

  describe('the register of processing activities', () => {
    it('names every table it is based on, with its retention', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/privacy/processing',
        headers: asTeacher(),
      })

      const body = response.json()
      const audit = body.activities.find((entry: { key: string }) => entry.key === 'audit')
      expect(audit.tables).toContain('audit_log')
      expect(audit.retentionDays).toBeGreaterThan(0)

      const assistant = body.activities.find((entry: { key: string }) => entry.key === 'assistant')
      expect(assistant.externalRecipient).toBe('anthropic')
    })
  })

  describe('retention', () => {
    const setNotificationRetention = async (days: number) => {
      const center = await prisma.center.findUniqueOrThrow({ where: { id: centerId } })
      const settings = parseCenterSettings(center.settingsJson)

      await prisma.center.update({
        where: { id: centerId },
        data: {
          settingsJson: {
            ...settings,
            privacy: { ...settings.privacy, notificationDays: days },
          } as never,
        },
      })
    }

    it('deletes only what has aged past the center’s own policy', async () => {
      await setNotificationRetention(90)
      const old = new Date(Date.now() - 120 * 86_400_000)
      const recent = new Date()

      const stale = await prisma.notification.create({
        data: {
          centerId,
          userId: teacherId,
          type: 'schedule.published',
          payloadJson: { title: 'Vell' },
          createdAt: old,
        },
      })
      const fresh = await prisma.notification.create({
        data: {
          centerId,
          userId: teacherId,
          type: 'schedule.published',
          payloadJson: { title: 'Nou' },
          createdAt: recent,
        },
      })

      const report = await applyRetention(prisma)

      expect(report.notifications).toBeGreaterThan(0)
      expect(await prisma.notification.findUnique({ where: { id: stale.id } })).toBeNull()
      expect(await prisma.notification.findUnique({ where: { id: fresh.id } })).not.toBeNull()

      await prisma.notification.delete({ where: { id: fresh.id } })
    })

    it('keeps everything when a center sets no period', async () => {
      // Zero is a decision, not an oversight: this center keeps its history.
      await setNotificationRetention(0)

      const ancient = await prisma.notification.create({
        data: {
          centerId,
          userId: teacherId,
          type: 'schedule.published',
          payloadJson: { title: 'Antic' },
          createdAt: new Date('2020-01-01'),
        },
      })

      await applyRetention(prisma)
      expect(await prisma.notification.findUnique({ where: { id: ancient.id } })).not.toBeNull()

      await prisma.notification.delete({ where: { id: ancient.id } })
    })
  })
})
