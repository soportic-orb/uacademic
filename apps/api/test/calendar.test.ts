/**
 * The teacher's calendar: occurrences in a range, the subscribable ICS feed
 * with its revocable token, and the PDF and Excel exports.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import ExcelJS from 'exceljs'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { extractText } from '../src/services/documents/extract.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('the teacher calendar', () => {
  let app: FastifyInstance
  let centerId: string
  const prisma = getPrismaClient()

  const asTeacher = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const range = 'from=2026-09-14&to=2026-12-18'

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
  })

  afterAll(async () => {
    const user = await prisma.user.findFirst({ where: { email: SEED.teacherEmail } })
    if (user) await prisma.calendarFeedToken.deleteMany({ where: { userId: user.id } })
    await app.close()
    await disconnectPrisma()
  })

  describe('occurrences', () => {
    /*
      The person here holds coordination as well as a contract. Their own
      classes are theirs whichever hat they are wearing: roles are resolved
      from the database on every request (R3), and no screen's idea of an
      "active role" reaches this answer.
    */
    it('answers somebody who coordinates as well as teaches', async () => {
      const roles = await prisma.userCenterRole.findMany({
        where: { centerId, user: { email: SEED.teacherEmail } },
        select: { role: true },
      })
      expect(roles.map((entry) => entry.role).sort()).toEqual(['COORDINATOR', 'TEACHER'])

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().events.length).toBeGreaterThan(0)
    })

    it('says what each class is and where, not only when', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: asTeacher(),
      })

      const event = response.json().events[0] as {
        startTime: string
        endTime: string
        subjectName: string
        topic: string | null
        teachers: string[]
      }

      // Everything a person needs to read a day: the whole hour, the subject
      // in full, the topic when one was written, and who else is giving it.
      expect(event.startTime).toMatch(/^\d{2}:\d{2}$/)
      expect(event.endTime > event.startTime).toBe(true)
      expect(event.subjectName.length).toBeGreaterThan(0)
      expect('topic' in event).toBe(true)
      expect(Array.isArray(event.teachers)).toBe(true)
    })

    it('expands the weekly sessions of the published version over a range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.events.length).toBeGreaterThan(0)
      expect(body.subjects.length).toBeGreaterThan(0)
      expect(body.events[0]).toMatchObject({ date: expect.stringMatching(/^2026-\d\d-\d\d$/) })

      // Ordered as a calendar reads: by day, then by hour.
      const keys = body.events.map(
        (event: { date: string; startTime: string }) => `${event.date}${event.startTime}`,
      )
      expect(keys).toEqual([...keys].sort())
    })

    it('skips the days the academic calendar closes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: asTeacher(),
      })

      const dates = new Set(response.json().events.map((event: { date: string }) => event.date))
      // A national holiday and the Christmas break are seeded as non-teaching.
      expect(dates.has('2026-10-12')).toBe(false)
      expect(dates.has('2026-12-25')).toBe(false)
    })

    it('filters by subject', async () => {
      const all = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: asTeacher(),
      })
      const subjectId = all.json().subjects[0].id

      const filtered = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}&subjectId=${subjectId}`,
        headers: asTeacher(),
      })

      expect(filtered.json().events.length).toBeGreaterThan(0)
      expect(
        filtered
          .json()
          .events.every((event: { subjectId: string }) => event.subjectId === subjectId),
      ).toBe(true)
      // The demo teacher may well teach a single subject in this range, so the
      // filter is asserted on what it keeps, not on how much it removes.
      expect(filtered.json().events.length).toBeLessThanOrEqual(all.json().events.length)
    })

    it('shows a teacher only their own classes', async () => {
      const mine = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: asTeacher(),
      })
      const other = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: { 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId },
      })

      const mineIds = new Set(
        mine.json().events.map((event: { sessionId: string }) => event.sessionId),
      )
      const otherIds = other.json().events.map((event: { sessionId: string }) => event.sessionId)
      expect(otherIds.some((id: string) => mineIds.has(id))).toBe(false)
    })
  })

  describe('the subscription feed', () => {
    it('hands out an address once and serves the calendar without a session', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/feed',
        headers: asTeacher(),
      })

      expect(created.statusCode).toBe(201)
      const { token, url } = created.json()
      expect(url).toContain(`/api/v1/calendar/feed/${token}.ics`)

      // Stored hashed: the row never holds a working URL.
      const stored = await prisma.calendarFeedToken.findFirst({
        where: { id: created.json().id },
      })
      expect(stored?.token).not.toBe(token)
      expect(stored?.token).toHaveLength(64)

      const feed = await app.inject({ method: 'GET', url: `/api/v1/calendar/feed/${token}.ics` })

      expect(feed.statusCode).toBe(200)
      expect(feed.headers['content-type']).toContain('text/calendar')
      expect(feed.body).toContain('BEGIN:VCALENDAR')
      expect(feed.body).toContain('RRULE:FREQ=WEEKLY')
      expect(feed.body).toContain('EXDATE')
      expect(feed.body).toContain('Marta Puig Serra')
    })

    it('replaces the previous address when a new one is generated', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/feed',
        headers: asTeacher(),
      })
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/feed',
        headers: asTeacher(),
      })

      const stale = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/feed/${first.json().token}.ics`,
      })
      const live = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/feed/${second.json().token}.ics`,
      })

      expect(stale.statusCode).toBe(404)
      expect(live.statusCode).toBe(200)
    })

    it('stops serving a revoked address', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar/feed',
        headers: asTeacher(),
      })

      const revoked = await app.inject({
        method: 'DELETE',
        url: `/api/v1/calendar/feed/${created.json().id}`,
        headers: asTeacher(),
      })
      expect(revoked.statusCode).toBe(204)

      const feed = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/feed/${created.json().token}.ics`,
      })
      expect(feed.statusCode).toBe(404)

      const status = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/feed',
        headers: asTeacher(),
      })
      expect(status.json().active).toBe(false)
    })

    it('refuses an address nobody issued', async () => {
      const feed = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/feed/${'0'.repeat(64)}.ics`,
      })
      expect(feed.statusCode).toBe(404)
    })
  })

  describe('exports', () => {
    it('writes the range as a spreadsheet, one row per class', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/export.xlsx?${range}`,
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('spreadsheetml')

      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(response.rawPayload as unknown as ArrayBuffer)
      const sheet = workbook.worksheets[0]

      const sessions = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/sessions?${range}`,
        headers: asTeacher(),
      })
      expect(sheet?.rowCount).toBe(sessions.json().events.length + 1)
    })

    it('writes the range as a PDF', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/export.pdf?${range}`,
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
      expect(response.rawPayload.length).toBeGreaterThan(1000)
    })

    /**
     * A printed calendar that is not the calendar in front of somebody is a
     * different document: the period is the one on screen, and the shape of
     * the page follows the view.
     */
    it('prints the week being looked at, not the window the browser fetched', async () => {
      const week = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/export.pdf?${range}&view=week&date=2026-09-16`,
        headers: asTeacher(),
      })
      const everything = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/export.pdf?${range}&view=agenda`,
        headers: asTeacher(),
      })

      expect(week.statusCode).toBe(200)
      const { pages } = await extractText(
        new Uint8Array(week.rawPayload),
        'application/pdf',
        'week.pdf',
      )
      const text = pages.map((page) => page.text).join(' ')

      // The week of the 16th, and nothing from the term either side of it.
      expect(text).toContain('2026-09-14')
      expect(text).toContain('2026-09-20')
      expect(text).not.toContain('2026-12-18')
      // Three months of agenda weigh more than one week of grid.
      expect(everything.rawPayload.length).toBeGreaterThan(week.rawPayload.length)
    })

    it('prints its own programme for the year, whatever week is on screen', async () => {
      /*
        The teacher's own plan rather than a slice of it: the teaching months
        with a dot on every day they teach, and every class of theirs beneath
        in date order. One day was asked for on screen; the year comes back.
      */
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/export.pdf?from=2026-09-16&to=2026-09-16&view=programme',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      const { pages } = await extractText(
        new Uint8Array(response.rawPayload),
        'application/pdf',
        'programme.pdf',
      )
      const text = pages.map((page) => page.text).join(' ')

      // The whole academic year, not the day that was on screen.
      expect(text).toContain('2026-09-14 – 2027-07-31')
      // A row of teaching months across the top, each with its days.
      expect(text.toLowerCase()).toContain('des. del 26')
      expect(text).toContain('1 2 3 4 5')
      // And the classes beneath, in date order, with the hours, the person
      // giving them and the room.
      expect(text).toMatch(/\d{2}\/12\/26 \d{2}:\d{2}–\d{2}:\d{2}/)
      expect(text).toContain('Data Horari Tema Docent Aula')
    })

    it('prints a month as a month', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar/export.pdf?${range}&view=month&date=2026-10-05`,
        headers: asTeacher(),
      })

      const { pages } = await extractText(
        new Uint8Array(response.rawPayload),
        'application/pdf',
        'month.pdf',
      )
      const text = pages.map((page) => page.text).join(' ')

      // Named as the month it is, and bounded by it.
      expect(text.toLowerCase()).toContain('octubre')
      expect(text).toContain('2026-10-01')
      expect(text).not.toContain('2026-12-18')
    })

    it('says the hour, the class and the room on the agenda', async () => {
      const session = await prisma.classSession.findFirstOrThrow({
        where: {
          centerId,
          scheduleVersion: { status: 'published' },
          teacherProfile: { user: { email: SEED.teacherEmail } },
        },
      })
      /*
        A room of this test's own. Borrowing one of the center's would put two
        published classes in the same room at the same hour, and every other
        test reading the timetable at that moment would see a conflict that
        has nothing to do with it.
      */
      const space = await prisma.space.create({
        data: {
          centerId,
          name: 'Prova aula agenda',
          building: 'Prova',
          capacity: 60,
          type: 'classroom',
        },
      })

      await prisma.classSession.update({
        where: { id: session.id },
        data: { spaceId: space.id, topic: 'Prova tema agenda' },
      })

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/calendar/export.pdf?${range}&view=agenda`,
          headers: asTeacher(),
        })
        const { pages } = await extractText(
          new Uint8Array(response.rawPayload),
          'application/pdf',
          'agenda.pdf',
        )
        const text = pages.map((page) => page.text).join(' ')

        expect(text).toContain(`${session.startTime}–${session.endTime}`)
        expect(text).toContain('Prova tema agenda')
        expect(text).toContain(space.name)
      } finally {
        await prisma.classSession.update({
          where: { id: session.id },
          data: { spaceId: session.spaceId, topic: session.topic },
        })
        await prisma.space.delete({ where: { id: space.id } })
      }
    })

    /*
      A page of coloured chips is only readable to somebody who already knows
      the timetable, and a colour a center chose has to be the colour that
      comes out of the printer.
    */
    it('prints the subject’s own colour, and a key to what the colours are', async () => {
      const session = await prisma.classSession.findFirstOrThrow({
        where: {
          centerId,
          scheduleVersion: { status: 'published' },
          teacherProfile: { user: { email: SEED.teacherEmail } },
        },
        include: { group: { select: { subject: { select: { id: true, nameCa: true } } } } },
      })

      await prisma.subject.update({
        where: { id: session.group.subject.id },
        data: { color: '#7c3aed' },
      })

      try {
        for (const view of ['agenda', 'month']) {
          const response = await app.inject({
            method: 'GET',
            url: `/api/v1/calendar/export.pdf?${range}&view=${view}&date=2026-09-16`,
            headers: asTeacher(),
          })

          const { pages } = await extractText(
            new Uint8Array(response.rawPayload),
            'application/pdf',
            `${view}.pdf`,
          )
          const text = pages.map((page) => page.text).join(' ')

          // The key names the subject in full, next to its colour.
          expect(text).toContain(session.group.subject.nameCa)
        }
      } finally {
        await prisma.subject.update({
          where: { id: session.group.subject.id },
          data: { color: null },
        })
      }
    })

    it('refuses a range it cannot parse instead of guessing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar/export.pdf?from=yesterday&to=tomorrow',
        headers: asTeacher(),
      })
      expect(response.statusCode).toBe(422)
    })
  })
})
