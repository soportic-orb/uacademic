/**
 * The teaching programme: what coordination sees, and what it must not.
 *
 * The teacher's calendar is bounded by "mine". This one is bounded by "what I
 * coordinate", which is a different fence and worth the same scrutiny.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { extractText } from '../src/services/documents/extract.js'
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

  /*
    "You coordinate nothing" is a fact about a person. Reading it off an empty
    calendar made it true in August and wrong the rest of the year.
  */
  it('says how many subjects somebody is responsible for, whatever month is on screen', async () => {
    const { subjectId } = await coordinate()
    expect(subjectId).toBeTruthy()

    const august = await app.inject({
      method: 'GET',
      url: '/api/v1/calendar/coordination?from=2026-08-01&to=2026-08-31',
      headers: asCoordinator(),
    })

    // A month with no classes in it, and somebody who plainly coordinates one.
    expect(august.json().events).toEqual([])
    expect(august.json().coordinates).toBe(1)
  })

  it('says plainly when somebody coordinates nothing at all', async () => {
    const response = await read(asCoordinator())

    expect(response.json().coordinates).toBe(0)
  })

  it('offers what the timetable holds', async () => {
    const response = await read(asAdmin())
    const filters = response.json().filters

    expect(filters.subjects.length).toBeGreaterThan(0)
    expect(filters.teachers.length).toBeGreaterThan(0)
    expect(filters.groups.length).toBeGreaterThan(0)
  })

  /*
    The pickers used to be built from the occurrences on screen, so a
    colleague who teaches in the second term was missing from the list all
    autumn — and choosing one was the only way to find out they were not
    there.
  */
  it('offers the whole year, not only the week being looked at', async () => {
    const wide = await read(asAdmin())
    const narrow = await app.inject({
      method: 'GET',
      url: '/api/v1/calendar/coordination?from=2026-09-14&to=2026-09-15',
      headers: asAdmin(),
    })

    // A day and a half of classes, and every subject, colleague, group and
    // room of the year still on offer.
    expect(narrow.json().events.length).toBeLessThan(wide.json().events.length)
    expect(narrow.json().filters).toEqual(wide.json().filters)
  })

  it('narrows by teacher without losing the list of teachers to choose from', async () => {
    const all = await read(asAdmin())
    /*
      Somebody who actually teaches inside the months on screen. The pickers
      now offer the whole year — a colleague who only teaches in the second
      term is in the list all autumn, which is the point — so the first name
      in it is not necessarily one with a class this week.
    */
    const teaching = (all.json().events as { teacherProfileId: string | null }[]).find(
      (event) => event.teacherProfileId,
    )
    const teacher = (all.json().filters.teachers as { id: string; label: string }[]).find(
      (option) => option.id === teaching?.teacherProfileId,
    )!

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

    it('says the whole hour, what the class is and where', async () => {
      const { subjectId } = await coordinate()
      const session = await prisma.classSession.findFirstOrThrow({
        where: { centerId, group: { subjectId }, scheduleVersion: { status: 'published' } },
      })
      // A room of this test's own: borrowing one of the center's would put
      // two published classes in it at one hour, and anything else reading the
      // timetable would see a conflict that has nothing to do with this.
      const space = await prisma.space.create({
        data: {
          centerId,
          name: 'Prova aula programa',
          building: 'Prova',
          capacity: 60,
          type: 'classroom',
        },
      })

      await prisma.classSession.update({
        where: { id: session.id },
        data: { spaceId: space.id, topic: 'Prova tema programa' },
      })

      try {
        const response = await print('view=agenda')
        const { pages } = await extractText(
          new Uint8Array(response.rawPayload),
          'application/pdf',
          'programme.pdf',
        )
        const text = pages.map((page) => page.text).join(' ')

        expect(text).toContain(`${session.startTime}–${session.endTime}`)
        expect(text).toContain('Prova tema programa')
        expect(text).toContain(space.name)
      } finally {
        await prisma.classSession.update({
          where: { id: session.id },
          data: { spaceId: session.spaceId, topic: session.topic },
        })
        await prisma.space.delete({ where: { id: space.id } })
      }
    })

    it('prints a month as a month and a week as a week', async () => {
      await coordinate()

      const month = await print('view=month&date=2026-10-05')
      const { pages } = await extractText(
        new Uint8Array(month.rawPayload),
        'application/pdf',
        'month.pdf',
      )
      const text = pages.map((page) => page.text).join(' ')

      // A calendar page, named as the month it is and bounded by it.
      expect(text.toLowerCase()).toContain('octubre')
      expect(text).toContain('2026-10-01')

      const week = await print('view=week&date=2026-09-16')
      const weekPages = await extractText(
        new Uint8Array(week.rawPayload),
        'application/pdf',
        'week.pdf',
      )
      const weekText = weekPages.pages.map((page) => page.text).join(' ')

      expect(weekText).toContain('2026-09-14')
      expect(weekText).toContain('2026-09-20')
      expect(weekText).not.toContain('2026-10-01')
    })

    /*
      The period on paper is asked for rather than assumed: the dialog sends a
      range and a shape, and no day at all.
    */
    it('prints the period asked for, a page per week', async () => {
      await coordinate()

      // The dialog's own query: a range and a shape, and nothing else.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/coordination.pdf?from=2026-09-14&to=2026-09-27&view=week',
        headers: asAdmin(),
      })
      const { pages } = await extractText(
        new Uint8Array(response.rawPayload),
        'application/pdf',
        'weeks.pdf',
      )

      // Two weeks asked for, two pages, each headed by its own dates.
      expect(pages).toHaveLength(2)
      const text = pages.map((page) => page.text).join(' ')
      expect(text).toContain('2026-09-14')
      expect(text).toContain('2026-09-21')
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

      /*
        A room of this test's own. Picking any other room of the center would
        be picking whatever the seed happens to leave free at that hour, and
        the timetable is full: the answer would be "that room is taken", which
        is a different test — the one below.
      */
      const space = await prisma.space.create({
        data: {
          centerId,
          name: 'Prova aula lliure',
          building: 'Prova',
          capacity: 100,
          type: 'classroom',
        },
      })

      try {
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
      } finally {
        await prisma.classSession.update({
          where: { id: session.id },
          data: { spaceId: session.spaceId },
        })
        await prisma.space.delete({ where: { id: space.id } })
      }
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
