/**
 * The teaching programme: what coordination sees, and what it must not.
 *
 * The teacher's calendar is bounded by "mine". This one is bounded by "what I
 * coordinate", which is a different fence and worth the same scrutiny.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('the teaching programme', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let coordinatorId: string

  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  const RANGE = 'from=2026-09-01&to=2026-12-31'

  const read = (headers: Record<string, string>, query = '') =>
    app.inject({
      method: 'GET',
      url: `/api/v1/calendar/coordination?${RANGE}${query}`,
      headers,
    })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    coordinatorId = (await prisma.user.findFirstOrThrow({ where: { email: SEED.teacherEmail } })).id
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  afterEach(async () => {
    // Put back whatever a test changed about who coordinates what.
    await prisma.subjectCoordinator.deleteMany({ where: { userId: coordinatorId } })
  })

  const coordinate = async (): Promise<{ subjectId: string }> => {
    const session = await prisma.classSession.findFirstOrThrow({
      where: { centerId, scheduleVersion: { status: 'published' } },
      include: { group: { select: { subjectId: true } } },
    })
    await prisma.subjectCoordinator.create({
      data: { subjectId: session.group.subjectId, userId: coordinatorId, centerId },
    })
    return { subjectId: session.group.subjectId }
  }

  it('is not a lecturer’s screen', async () => {
    expect((await read(asTeacher())).statusCode).toBe(403)
  })

  it('shows the classes of a subject somebody coordinates, whoever gives them', async () => {
    const { subjectId } = await coordinate()

    const response = await read(asCoordinator())

    expect(response.statusCode).toBe(200)
    expect(response.json().events.length).toBeGreaterThan(0)
    expect(
      response.json().events.every((event: { subjectId: string }) => event.subjectId === subjectId),
    ).toBe(true)
  })

  it('shows nothing to somebody who coordinates nothing', async () => {
    // The safer of the two readings of an empty list.
    const response = await read(asCoordinator())

    expect(response.statusCode).toBe(200)
    expect(response.json().events).toEqual([])
  })

  it('shows the whole center to the administration, which administers it', async () => {
    const response = await read(asAdmin())

    expect(response.json().events.length).toBeGreaterThan(0)
    const subjects = new Set(
      response.json().events.map((event: { subjectId: string }) => event.subjectId),
    )
    expect(subjects.size).toBeGreaterThan(1)
  })

  it('offers only the values that appear in the programme', async () => {
    const response = await read(asAdmin())
    const filters = response.json().filters

    expect(filters.subjects.length).toBeGreaterThan(0)
    expect(filters.teachers.length).toBeGreaterThan(0)
    expect(filters.groups.length).toBeGreaterThan(0)
  })

  it('narrows by teacher without losing the list of teachers to choose from', async () => {
    const all = await read(asAdmin())
    const teacher = all.json().filters.teachers[0] as { id: string; label: string }

    const filtered = await read(asAdmin(), `&teacherProfileId=${teacher.id}`)

    expect(filtered.json().events.length).toBeGreaterThan(0)
    expect(
      filtered
        .json()
        .events.every(
          (event: { teacherName: string | null }) => event.teacherName === teacher.label,
        ),
    ).toBe(true)
    // A picker that empties itself when it is used is a picker nobody can undo.
    expect(filtered.json().filters.teachers.length).toBe(all.json().filters.teachers.length)
  })

  it('narrows by room', async () => {
    const all = await read(asAdmin())
    const space = all.json().filters.spaces[0] as { id: string; label: string }

    const filtered = await read(asAdmin(), `&spaceId=${space.id}`)

    expect(
      filtered
        .json()
        .events.every((event: { spaceName: string | null }) => event.spaceName === space.label),
    ).toBe(true)
  })

  it('gives every class of a subject the same colour, and different subjects different ones', async () => {
    const response = await read(asAdmin())
    const events = response.json().events as { subjectId: string; background: string }[]

    const bySubject = new Map<string, Set<string>>()
    for (const event of events) {
      bySubject.set(
        event.subjectId,
        (bySubject.get(event.subjectId) ?? new Set()).add(event.background),
      )
    }

    for (const backgrounds of bySubject.values()) expect(backgrounds.size).toBe(1)
    expect(new Set(events.map((event) => event.background)).size).toBeGreaterThan(1)
  })

  describe('printing what is on screen', () => {
    const print = (query: string, headers = asAdmin()) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/calendar/coordination.pdf?${RANGE}&${query}`,
        headers,
      })

    it('is a real PDF', async () => {
      const response = await print('view=agenda')

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    })

    it('prints the week being looked at, not the whole fetched range', async () => {
      const week = await print('view=week&date=2026-09-16')
      const everything = await print('view=agenda')

      // Four months weigh more than one week, whatever else is on the page.
      expect(everything.rawPayload.length).toBeGreaterThan(week.rawPayload.length)
    })

    it('honours the filters that were on when it was pressed', async () => {
      const all = await print('view=agenda')
      const filters = (await read(asAdmin())).json().filters
      const one = await print(`view=agenda&subjectId=${filters.subjects[0].id}`)

      expect(all.rawPayload.length).toBeGreaterThan(one.rawPayload.length)
    })

    it('still produces a document when nothing matches', async () => {
      // An empty file that downloads and opens on nothing looks like a failure.
      const response = await print('view=day&date=2030-07-01')

      expect(response.statusCode).toBe(200)
      expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    })

    it('is not a lecturer’s to print either', async () => {
      expect((await print('view=agenda', asTeacher())).statusCode).toBe(403)
    })
  })

  /**
   * A room changes for reasons that have nothing to do with the timetable, and
   * this is the screen somebody is looking at when they find out.
   */
  describe('moving a class to another room', () => {
    const move = (sessionId: string, spaceId: string | null, headers = asAdmin()) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/calendar/coordination/sessions/${sessionId}`,
        headers,
        payload: { spaceId },
      })

    it('changes the room of a published class, and records it (R4)', async () => {
      const session = await prisma.classSession.findFirstOrThrow({
        where: { centerId, scheduleVersion: { status: 'published' } },
      })
      const space = await prisma.space.findFirstOrThrow({
        where: { centerId, id: { not: session.spaceId ?? undefined } },
      })

      const response = await move(session.id, space.id)

      expect(response.statusCode).toBe(200)
      expect(
        (await prisma.classSession.findFirstOrThrow({ where: { id: session.id } })).spaceId,
      ).toBe(space.id)

      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'class_session', entityId: session.id, action: 'room' },
        orderBy: { createdAt: 'desc' },
      })
      expect(entry?.source).toBe('user')

      await prisma.classSession.update({
        where: { id: session.id },
        data: { spaceId: session.spaceId },
      })
    })

    it('refuses a room that is already taken at that hour', async () => {
      const [first, second] = await prisma.classSession.findMany({
        where: { centerId, scheduleVersion: { status: 'published' } },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        take: 2,
      })

      // Put the second class in the same slot as the first, then try to give
      // it the first one's room.
      await prisma.classSession.update({
        where: { id: second!.id },
        data: {
          weekday: first!.weekday,
          startTime: first!.startTime,
          endTime: first!.endTime,
          dateFrom: first!.dateFrom,
          dateTo: first!.dateTo,
          recurrence: first!.recurrence,
        },
      })

      try {
        const response = await move(second!.id, first!.spaceId)

        expect(response.statusCode).toBe(409)
        expect(response.json().error.messageKey).toBe('calendar.coordination.errors.roomBusy')
      } finally {
        // The room too: a refusal must leave nothing behind, and a test that
        // trusts that has no way of saying so if it is wrong.
        await prisma.classSession.update({
          where: { id: second!.id },
          data: {
            weekday: second!.weekday,
            startTime: second!.startTime,
            endTime: second!.endTime,
            dateFrom: second!.dateFrom,
            dateTo: second!.dateTo,
            recurrence: second!.recurrence,
            spaceId: second!.spaceId,
          },
        })
      }
    })

    it('is not a lecturer’s to change', async () => {
      const session = await prisma.classSession.findFirstOrThrow({
        where: { centerId, scheduleVersion: { status: 'published' } },
      })

      expect((await move(session.id, null, asTeacher())).statusCode).toBe(403)
    })

    it('will not move a class the coordinator does not coordinate', async () => {
      const session = await prisma.classSession.findFirstOrThrow({
        where: { centerId, scheduleVersion: { status: 'published' } },
      })

      // No `coordinate()` here: they coordinate nothing, so this is not theirs.
      expect((await move(session.id, null, asCoordinator())).statusCode).toBe(404)
    })
  })
})
