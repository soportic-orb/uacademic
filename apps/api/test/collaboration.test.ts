/**
 * Messaging, notifications and the audit viewer.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('messaging', () => {
  let app: FastifyInstance
  let centerId: string
  let otherUserId: string
  const prisma = getPrismaClient()

  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    otherUserId = (await prisma.user.findFirst({ where: { email: SEED.otherTeacherEmail } }))!.id
  })

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { centerId } })
    await prisma.conversationMember.deleteMany({ where: { conversation: { centerId } } })
    await prisma.conversation.deleteMany({ where: { centerId } })
    await prisma.notification.deleteMany({ where: { centerId } })
    await app.close()
    await disconnectPrisma()
  })

  it('creates the standing conversations nobody has to set up', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: asCoordinator(),
    })

    expect(response.statusCode).toBe(200)
    const types = response.json().items.map((item: { type: string }) => item.type)
    expect(types).toContain('announcement')
    // The coordinator teaches, so their subject groups exist too.
    expect(types).toContain('subject')
  })

  it('keeps the announcement channel read-only for a teacher', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: asTeacher() })

    const announcement = await prisma.conversation.findFirst({
      where: { centerId, type: 'announcement' },
    })

    const asTeacherPost = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${announcement!.id}/messages`,
      headers: asTeacher(),
      payload: { body: 'Puc escriure?' },
    })
    expect(asTeacherPost.statusCode).toBe(403)

    const asCoordinatorPost = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${announcement!.id}/messages`,
      headers: asCoordinator(),
      payload: { body: 'Reunió de departament dijous' },
    })
    expect(asCoordinatorPost.statusCode).toBe(201)
  })

  it('opens a direct conversation once and reuses it', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: asCoordinator(),
      payload: { type: 'direct', userId: otherUserId },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: asCoordinator(),
      payload: { type: 'direct', userId: otherUserId },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
  })

  it('delivers a message, counts it as unread and marks it read', async () => {
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: asCoordinator(),
      payload: { type: 'direct', userId: otherUserId },
    })
    const conversationId = conversation.json().id

    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: asCoordinator(),
      payload: { body: 'Pots cobrir dijous?' },
    })

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: asTeacher(),
    })
    const thread = inbox.json().items.find((item: { id: string }) => item.id === conversationId)
    expect(thread.unread).toBe(1)
    // Unread conversations come first, which is the whole point of the order.
    expect(inbox.json().items[0].id).toBe(conversationId)

    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: asTeacher(),
    })
    expect(messages.json().items[0]).toMatchObject({
      body: 'Pots cobrir dijous?',
      readByAll: false,
    })

    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/read`,
      headers: asTeacher(),
    })

    const afterRead = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: asCoordinator(),
    })
    expect(afterRead.json().items.at(-1)).toMatchObject({ readByAll: true })
  })

  it('notifies the other members, in their own language', async () => {
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: asCoordinator(),
      payload: { type: 'direct', userId: otherUserId },
    })

    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversation.json().id}/messages`,
      headers: asCoordinator(),
      payload: { body: 'Hola' },
    })

    const notification = await prisma.notification.findFirst({
      where: { userId: otherUserId, type: 'message.received' },
      orderBy: { createdAt: 'desc' },
    })
    expect(notification).not.toBeNull()
    expect((notification?.payloadJson as { title: string }).title).toBe('Missatge nou')
  })

  it('refuses a conversation the caller is not in', async () => {
    const foreign = await prisma.conversation.create({
      data: { centerId, type: 'group', title: 'Privada' },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${foreign.id}/messages`,
      headers: asTeacher(),
    })
    expect(response.statusCode).toBe(403)
  })

  it('searches the messages the caller can actually read', async () => {
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: asCoordinator(),
      payload: { type: 'direct', userId: otherUserId },
    })

    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversation.json().id}/messages`,
      headers: asCoordinator(),
      payload: { body: 'Recordatori: claustre extraordinari divendres' },
    })

    const found = await app.inject({
      method: 'GET',
      url: '/api/v1/messages/search?q=claustre',
      headers: asTeacher(),
    })
    expect(found.json().items.length).toBeGreaterThan(0)
    expect(found.json().items[0].body).toContain('claustre')

    const stranger = await app.inject({
      method: 'GET',
      url: '/api/v1/messages/search?q=claustre',
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
    })
    expect(stranger.json().items).toEqual([])
  })

  it('refuses an attachment type that has no business in an inbox', async () => {
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: asCoordinator(),
      payload: { type: 'direct', userId: otherUserId },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversation.json().id}/messages`,
      headers: asCoordinator(),
      payload: {
        body: 'Mira això',
        attachments: [
          {
            id: 'x',
            fileName: 'setup.exe',
            mimeType: 'application/x-msdownload',
            sizeBytes: 100,
          },
        ],
      },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.details[0].messageKey).toBe('messages.attachments.unsupportedType')
  })
})

describe.skipIf(!hasDatabase)('notifications', () => {
  let app: FastifyInstance
  let centerId: string
  let userId: string
  const prisma = getPrismaClient()

  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    userId = (await prisma.user.findFirst({ where: { email: SEED.otherTeacherEmail } }))!.id
  })

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } })
    await prisma.notificationPref.deleteMany({ where: { userId } })
    await prisma.pushSubscription.deleteMany({ where: { userId } })
    await app.close()
    await disconnectPrisma()
  })

  it('lists what a person was told, and marks it read', async () => {
    await prisma.notification.create({
      data: {
        centerId,
        userId,
        type: 'change.applied',
        payloadJson: { title: 'Canvi aplicat', body: 'x' },
      },
    })

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: asTeacher(),
    })
    expect(list.json().unread).toBeGreaterThan(0)

    const first = list.json().items[0]
    const read = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${first.id}/read`,
      headers: asTeacher(),
    })
    expect(read.statusCode).toBe(204)

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unreadOnly=true',
      headers: asTeacher(),
    })
    expect(after.json().items.some((item: { id: string }) => item.id === first.id)).toBe(false)
  })

  it('offers the whole catalog with its defaults', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/preferences',
      headers: asTeacher(),
    })

    const items = response.json().items
    expect(items.length).toBeGreaterThan(5)
    expect(items.find((item: { event: string }) => item.event === 'change.expired')).toMatchObject({
      digest: true,
      priority: 'low',
    })
    expect(response.json().push).toHaveProperty('available')
  })

  it('saves preferences but refuses to switch off a mandatory channel', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/notifications/preferences',
      headers: asTeacher(),
      payload: {
        items: [
          { event: 'schedule.published', inApp: false, push: false, email: false, digest: false },
          { event: 'message.received', inApp: true, push: false, email: true, digest: false },
        ],
      },
    })
    expect(saved.statusCode).toBe(200)

    const stored = await prisma.notificationPref.findMany({ where: { userId } })
    expect(stored.find((row) => row.eventType === 'schedule.published')?.inApp).toBe(true)
    expect(stored.find((row) => row.eventType === 'message.received')?.email).toBe(true)
  })

  it('stores a push subscription once, however many times the browser sends it', async () => {
    const subscription = {
      endpoint: 'https://push.example.test/abc',
      keys: { p256dh: 'key', auth: 'auth' },
      userAgent: 'Firefox',
    }

    await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/push',
      headers: asTeacher(),
      payload: subscription,
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/push',
      headers: asTeacher(),
      payload: subscription,
    })

    expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(1)

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/notifications/push',
      headers: asTeacher(),
      payload: { endpoint: subscription.endpoint },
    })
    expect(removed.statusCode).toBe(204)
    expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('the audit viewer', () => {
  let app: FastifyInstance
  let centerId: string

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  it('lists what happened, newest first, with who did it', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: asAdmin() })

    expect(response.statusCode).toBe(200)
    const items = response.json().items
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toHaveProperty('entity')
    expect(items[0]).toHaveProperty('source')

    const dates = items.map((item: { createdAt: string }) => item.createdAt)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('filters by entity, by source and by date', async () => {
    const byEntity = await app.inject({
      method: 'GET',
      url: '/api/v1/audit?entity=change_request',
      headers: asAdmin(),
    })
    expect(
      byEntity.json().items.every((item: { entity: string }) => item.entity === 'change_request'),
    ).toBe(true)

    const bySource = await app.inject({
      method: 'GET',
      url: '/api/v1/audit?source=system',
      headers: asAdmin(),
    })
    expect(
      bySource.json().items.every((item: { source: string }) => item.source === 'system'),
    ).toBe(true)

    const future = await app.inject({
      method: 'GET',
      url: '/api/v1/audit?from=2099-01-01',
      headers: asAdmin(),
    })
    expect(future.json().items).toEqual([])
  })

  it('offers the entities this center has actually recorded', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: asAdmin() })
    const entities = response.json().entities.map((entry: { entity: string }) => entry.entity)

    expect(entities.length).toBeGreaterThan(0)
    expect(entities).toEqual([...entities].sort())
  })

  it('keeps the log away from a teacher', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe.skipIf(!hasDatabase)('the realtime subscription', () => {
  let app: FastifyInstance
  let centerId: string
  const prisma = getPrismaClient()

  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })
  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
  })

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { centerId } })
    await prisma.conversationMember.deleteMany({ where: { conversation: { centerId } } })
    await prisma.conversation.deleteMany({ where: { centerId } })
    await prisma.notification.deleteMany({ where: { centerId } })
    await app.close()
    await disconnectPrisma()
  })

  it('carries what happens to you, not what happens to everybody', async () => {
    // Both people have to exist as members before anything can be sent.
    await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: asCoordinator() })
    await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: asTeacher() })

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/events/poll',
      headers: asTeacher(),
    })
    const cursor = before.json().lastEventId

    const announcement = await prisma.conversation.findFirst({
      where: { centerId, type: 'announcement' },
    })
    const sent = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${announcement!.id}/messages`,
      headers: asCoordinator(),
      payload: { body: 'Claustre divendres' },
    })
    expect(sent.statusCode).toBe(201)

    const polled = await app.inject({
      method: 'GET',
      url: `/api/v1/events/poll?after=${cursor}`,
      headers: asTeacher(),
    })

    const types = polled.json().events.map((event: { type: string }) => event.type)
    // The member gets the message and the notification it raised…
    expect(types).toContain('message')
    expect(types).toContain('notification')

    // …and the events are ordered by the sequence they were published in.
    const ids = polled.json().events.map((event: { id: number }) => event.id)
    expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b))
  })

  it('refuses a caller with no session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events/poll',
      headers: { 'x-mock-user': 'nobody@example.org', 'x-center-id': centerId },
    })
    expect(response.statusCode).toBe(401)
  })
})
