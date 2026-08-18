/**
 * The three levels of "the teacher never has to open UAcademic": the ICS
 * subscription, and the two provider integrations behind a fake client — the
 * point of the abstraction is that the engine can be driven without a network.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { CalendarEventDraft } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildJobHandlers } from '../src/jobs/handlers.js'
import { buildState } from '../src/modules/calendar/connections-routes.js'
import { setProviderClient } from '../src/services/calendar/providers.js'
import {
  type BusyResult,
  type CalendarProviderClient,
  type OAuthTokens,
  ProviderError,
  type RemoteEvent,
} from '../src/services/calendar/types.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'
import { pino } from 'pino'

/** A provider that records what it was asked to do, and can be made to fail. */
class FakeProvider implements CalendarProviderClient {
  readonly provider = 'microsoft' as const
  readonly created: CalendarEventDraft[] = []
  readonly updated: { eventId: string; draft: CalendarEventDraft }[] = []
  readonly deleted: string[] = []
  calendars = 0
  deletedCalendars: string[] = []
  busy: { startAt: Date; endAt: Date }[] = []
  failUpdateWith: number | null = null
  failEverythingWith: number | null = null
  #sequence = 0

  authorizeUrl(input: { state: string }): string {
    return `https://provider.test/authorize?state=${input.state}`
  }

  async exchangeCode(): Promise<OAuthTokens> {
    return {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: 'Calendars.ReadWrite',
    }
  }

  async refresh(): Promise<OAuthTokens> {
    return { accessToken: 'refreshed', expiresAt: new Date(Date.now() + 3_600_000) }
  }

  async ensureCalendar(): Promise<string> {
    this.#guard()
    this.calendars += 1
    return 'remote-calendar'
  }

  async deleteCalendar(_tokens: OAuthTokens, calendarId: string): Promise<void> {
    this.deletedCalendars.push(calendarId)
  }

  async createEvent(
    _tokens: OAuthTokens,
    _calendarId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent> {
    this.#guard()
    this.created.push(draft)
    this.#sequence += 1
    return { id: `event-${this.#sequence}` }
  }

  async updateEvent(
    _tokens: OAuthTokens,
    _calendarId: string,
    eventId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent> {
    this.#guard()
    if (this.failUpdateWith) {
      const status = this.failUpdateWith
      this.failUpdateWith = null
      throw new ProviderError(status, 'microsoft', 'update failed')
    }
    this.updated.push({ eventId, draft })
    return { id: eventId }
  }

  async deleteEvent(_tokens: OAuthTokens, _calendarId: string, eventId: string): Promise<void> {
    this.#guard()
    this.deleted.push(eventId)
  }

  async listBusy(): Promise<BusyResult> {
    this.#guard()
    return { windows: this.busy, syncToken: 'cursor-1' }
  }

  reset(): void {
    this.created.length = 0
    this.updated.length = 0
    this.deleted.length = 0
    this.deletedCalendars.length = 0
    this.failUpdateWith = null
    this.failEverythingWith = null
  }

  #guard(): void {
    if (this.failEverythingWith)
      throw new ProviderError(this.failEverythingWith, 'microsoft', 'nope')
  }
}

describe.skipIf(!hasDatabase)('calendar connections', () => {
  let app: FastifyInstance
  let centerId: string
  let userId: string
  const prisma = getPrismaClient()
  const provider = new FakeProvider()
  const handlers = buildJobHandlers(prisma, pino({ level: 'silent' }))

  const asTeacher = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    // The tokens are stored encrypted; without a key there is nothing to test.
    process.env.UACADEMIC_APP_ENCRYPTION_KEY = 'a'.repeat(64)
    // The suite decides which providers this installation has, rather than
    // whatever a developer happens to have configured locally.
    delete process.env.UACADEMIC_GOOGLE_CLIENT_ID
    delete process.env.UACADEMIC_GOOGLE_CLIENT_SECRET
    app = await createTestApp()
    centerId = await seedCenterId()
    userId = (await prisma.user.findFirst({ where: { email: SEED.teacherEmail } }))!.id
    setProviderClient('microsoft', provider)
  })

  afterAll(async () => {
    setProviderClient('microsoft', null)
    await prisma.calendarConnection.deleteMany({ where: { userId } })
    await prisma.consentRecord.deleteMany({ where: { userId } })
    await prisma.calendarTombstone.deleteMany({ where: { userId } })
    await prisma.calendarFeedToken.deleteMany({ where: { userId } })
    await app.close()
    await disconnectPrisma()
  })

  beforeEach(() => provider.reset())

  afterEach(async () => {
    await prisma.job.deleteMany({ where: { type: { startsWith: 'calendar.' } } })
  })

  const connect = async () => {
    const state = buildState(userId, 'microsoft')
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/calendar/connections/microsoft/callback?code=abc&state=${state}`,
      headers: asTeacher(),
    })
    expect(response.statusCode).toBe(302)
    return prisma.calendarConnection.findFirstOrThrow({ where: { userId, provider: 'microsoft' } })
  }

  const sync = async () => {
    await handlers['calendar.sync']!({ userId })
  }

  describe('the consent', () => {
    it('is asked for separately from the login, and only when configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/connections/microsoft/authorize',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().url).toContain('state=')

      const google = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/connections/google/authorize',
        headers: asTeacher(),
      })
      // No Google credentials on this installation: refused, not pretended.
      expect(google.statusCode).toBe(503)
    })

    it('refuses a callback whose state was not issued to this person', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/connections/microsoft/callback?code=abc&state=forged.signature',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(403)
    })

    it('stores the tokens encrypted and records the consent it was given under', async () => {
      const connection = await connect()

      expect(connection.status).toBe('active')
      expect(connection.accessTokenEnc).not.toContain('access-token')
      expect(connection.accessTokenEnc.startsWith('v1.')).toBe(true)
      expect(connection.consentVersion).toBeGreaterThan(0)

      const consent = await prisma.consentRecord.findFirst({
        where: { userId, scope: 'calendar.write.microsoft', revokedAt: null },
      })
      expect(consent).not.toBeNull()

      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'calendar_connection', entityId: connection.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit?.action).toMatch(/connect/)

      // Connecting queues the first synchronisation instead of blocking on it.
      const queued = await prisma.job.count({ where: { type: 'calendar.sync', status: 'pending' } })
      expect(queued).toBeGreaterThan(0)
    })
  })

  describe('the push synchronisation', () => {
    it('writes into a dedicated calendar, never the personal one', async () => {
      await connect()
      await sync()

      const connection = await prisma.calendarConnection.findFirstOrThrow({ where: { userId } })
      expect(connection.externalCalendarId).toBe('remote-calendar')
      expect(connection.calendarName).toMatch(/^UAcademic – /)
      expect(provider.created.length).toBeGreaterThan(0)
    })

    it('does nothing at all on a second run with nothing changed', async () => {
      await sync()
      expect(provider.created).toHaveLength(0)
      expect(provider.updated).toHaveLength(0)
      expect(provider.deleted).toHaveLength(0)
    })

    it('updates the event when the class actually moves', async () => {
      const mapping = await prisma.calendarEventMap.findFirstOrThrow({
        where: { connection: { userId } },
      })
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: mapping.sessionId },
      })

      await prisma.classSession.update({
        where: { id: session.id },
        data: { startTime: '19:00', endTime: '20:00' },
      })

      await sync()
      expect(provider.updated).toHaveLength(1)
      expect(provider.updated[0]?.draft.startTime).toBe('19:00')

      await prisma.classSession.update({
        where: { id: session.id },
        data: { startTime: session.startTime, endTime: session.endTime },
      })
      await sync()
    })

    it('recreates an event the teacher deleted on their own device', async () => {
      const mapping = await prisma.calendarEventMap.findFirstOrThrow({
        where: { connection: { userId } },
      })
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: mapping.sessionId },
      })

      // Something to update, and a provider that says the event is gone.
      await prisma.classSession.update({
        where: { id: session.id },
        data: { startTime: '18:00', endTime: '19:00' },
      })
      provider.failUpdateWith = 404

      await sync()

      // UAcademic is the source of truth: the class is put back.
      expect(provider.created).toHaveLength(1)

      await prisma.classSession.update({
        where: { id: session.id },
        data: { startTime: session.startTime, endTime: session.endTime },
      })
      await sync()
    })

    it('removes the event when the class stops being this person’s', async () => {
      const mapping = await prisma.calendarEventMap.findFirstOrThrow({
        where: { connection: { userId } },
      })
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: mapping.sessionId },
      })
      const other = await prisma.teacherProfile.findFirstOrThrow({
        where: { user: { email: SEED.otherTeacherEmail } },
      })

      await prisma.classSession.update({
        where: { id: session.id },
        data: { teacherProfileId: other.id },
      })

      await sync()
      expect(provider.deleted).toContain(mapping.externalEventId)
      expect(await prisma.calendarEventMap.count({ where: { sessionId: session.id } })).toBe(0)

      await prisma.classSession.update({
        where: { id: session.id },
        data: { teacherProfileId: session.teacherProfileId },
      })
      await sync()
    })

    it('parks a revoked connection instead of retrying it forever', async () => {
      // Something has to be written for a dead token to be discovered: a
      // synchronisation with nothing to do talks to nobody.
      const mapping = await prisma.calendarEventMap.findFirstOrThrow({
        where: { connection: { userId } },
      })
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: mapping.sessionId },
      })
      await prisma.classSession.update({
        where: { id: session.id },
        data: { startTime: '20:00', endTime: '21:00' },
      })

      provider.failEverythingWith = 401

      await expect(sync()).rejects.toThrow()

      const connection = await prisma.calendarConnection.findFirstOrThrow({ where: { userId } })
      expect(connection.status).toBe('revoked')

      provider.failEverythingWith = null

      // A parked connection is skipped entirely until the person reconnects.
      provider.reset()
      await sync()
      expect(provider.created).toHaveLength(0)
      expect(provider.updated).toHaveLength(0)

      await prisma.classSession.update({
        where: { id: session.id },
        data: { startTime: session.startTime, endTime: session.endTime },
      })
      await prisma.calendarConnection.updateMany({
        where: { userId },
        data: { status: 'active', lastError: null },
      })
    })
  })

  describe('reading busy time back', () => {
    it('is a separate opt-in, with its own consent record', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/calendar/connections/microsoft',
        headers: asTeacher(),
        payload: { busySyncEnabled: true },
      })

      expect(response.statusCode).toBe(200)
      const consent = await prisma.consentRecord.findFirst({
        where: { userId, scope: 'calendar.busy.read', revokedAt: null },
      })
      expect(consent).not.toBeNull()
    })

    it('stores start and end, and nothing else', async () => {
      provider.busy = [
        { startAt: new Date('2026-10-06T08:00:00Z'), endAt: new Date('2026-10-06T09:30:00Z') },
        { startAt: new Date('2026-10-13T08:00:00Z'), endAt: new Date('2026-10-13T09:30:00Z') },
      ]

      await handlers['calendar.busy.pull']!({})

      const slots = await prisma.externalBusySlot.findMany({
        where: { connection: { userId } },
      })
      expect(slots).toHaveLength(2)
      expect(Object.keys(slots[0]!)).toEqual(
        expect.not.arrayContaining(['summary', 'title', 'organizer']),
      )
    })

    it('deletes what it read when the consent is withdrawn', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/calendar/connections/microsoft',
        headers: asTeacher(),
        payload: { busySyncEnabled: false },
      })

      expect(response.statusCode).toBe(200)
      expect(await prisma.externalBusySlot.count({ where: { connection: { userId } } })).toBe(0)
      expect(
        await prisma.consentRecord.count({
          where: { userId, scope: 'calendar.busy.read', revokedAt: null },
        }),
      ).toBe(0)
    })
  })

  describe('leaving', () => {
    it('offers to take the dedicated calendar with it', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/calendar/connections/microsoft?deleteRemote=true',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().remoteDeleted).toBe(true)
      expect(provider.deletedCalendars).toContain('remote-calendar')

      expect(await prisma.calendarConnection.count({ where: { userId } })).toBe(0)
      expect(await prisma.calendarEventMap.count({ where: { connection: { userId } } })).toBe(0)
      expect(
        await prisma.consentRecord.count({
          where: { userId, scope: 'calendar.write.microsoft', revokedAt: null },
        }),
      ).toBe(0)
    })
  })
})

describe.skipIf(!hasDatabase)('the ICS subscription', () => {
  let app: FastifyInstance
  let centerId: string
  let userId: string
  const prisma = getPrismaClient()

  const asTeacher = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  const subscribe = async (filters: Record<string, unknown> = {}) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/calendar/feed',
      headers: asTeacher(),
      payload: filters,
    })
    expect(response.statusCode).toBe(201)
    return response.json() as { id: string; url: string; token: string }
  }

  const read = async (token: string) =>
    app.inject({ method: 'GET', url: `/api/v1/calendar/feed/${token}.ics` })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    userId = (await prisma.user.findFirst({ where: { email: SEED.teacherEmail } }))!.id
  })

  afterAll(async () => {
    await prisma.calendarTombstone.deleteMany({ where: { userId } })
    await prisma.calendarFeedToken.deleteMany({ where: { userId } })
    await app.close()
    await disconnectPrisma()
  })

  it('describes its timezone instead of leaving the client to guess', async () => {
    const feed = await subscribe()
    const response = await read(feed.token)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/calendar')

    const body = response.body
    expect(body).toContain('BEGIN:VTIMEZONE')
    expect(body).toContain('TZID:Europe/Madrid')
    expect(body).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')
    expect(body).toContain('X-PUBLISHED-TTL:PT')
    expect(body).toContain('SEQUENCE:')
    expect(body).toMatch(/URL:https?:\/\/[^\s]+\/calendar\?session=/)
  })

  it('announces a cancelled class instead of quietly dropping it', async () => {
    const session = await prisma.classSession.findFirstOrThrow({
      where: { teacherProfile: { userId }, scheduleVersion: { status: 'published' } },
    })

    await prisma.calendarTombstone.create({
      data: {
        centerId,
        userId,
        sessionId: session.id,
        reason: 'removed',
        payloadJson: {
          summary: 'MAT1 A',
          weekday: session.weekday,
          startTime: session.startTime,
          endTime: session.endTime,
          dateFrom: session.dateFrom.toISOString().slice(0, 10),
          dateTo: session.dateTo.toISOString().slice(0, 10),
          recurrence: 'weekly',
        },
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const feed = await subscribe()
    const body = (await read(feed.token)).body

    expect(body).toContain('STATUS:CANCELLED')
    // Same UID as the class it withdraws: that is what makes it a withdrawal.
    expect(body).toContain(`UID:${session.id}@uacademic`)

    await prisma.calendarTombstone.deleteMany({ where: { userId } })
  })

  it('carries only the subject the subscriber asked for', async () => {
    const session = await prisma.classSession.findFirstOrThrow({
      where: { teacherProfile: { userId }, scheduleVersion: { status: 'published' } },
      include: { group: { select: { subjectId: true } } },
    })

    const filtered = await subscribe({ subjectId: session.group.subjectId })
    const body = (await read(filtered.token)).body

    const others = await prisma.classSession.findMany({
      where: {
        teacherProfile: { userId },
        scheduleVersion: { status: 'published' },
        NOT: { group: { subjectId: session.group.subjectId } },
      },
      select: { id: true },
    })

    expect(body).toContain(`UID:${session.id}@uacademic`)
    for (const other of others) expect(body).not.toContain(`UID:${other.id}@uacademic`)
  })

  it('changes what it carries without changing the address', async () => {
    const feed = await subscribe()

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/calendar/feed/${feed.id}`,
      headers: asTeacher(),
      payload: { includeColleagues: true },
    })

    expect(patched.statusCode).toBe(200)
    expect(patched.json().filters.includeColleagues).toBe(true)
    // The subscription keeps working: nobody re-adds a feed in four clients.
    expect((await read(feed.token)).statusCode).toBe(200)
  })

  it('is unreachable once revoked', async () => {
    const feed = await subscribe()
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/calendar/feed/${feed.id}`,
      headers: asTeacher(),
    })

    expect((await read(feed.token)).statusCode).toBe(404)
  })

  it('tells the reader how slow each client actually is', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/calendar/feed',
      headers: asTeacher(),
    })

    const latency = response.json().latency
    expect(latency.google.minMinutes).toBeGreaterThanOrEqual(480)
    expect(latency.apple.maxMinutes).toBeLessThanOrEqual(60)
    expect(latency.google.clientControlled).toBe(true)
  })
})
