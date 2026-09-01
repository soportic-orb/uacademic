/**
 * The planner API: versions and their lifecycle, session edits with live
 * validation, publication with its diff and notifications, and the automatic
 * placement, and the rule that nothing repeats.
 *
 * Publication mutates shared demo state on purpose (it archives whatever was
 * live), so every test that publishes puts the seeded version back afterwards.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

const TEST_PREFIX = 'Test planner '

/**
 * A class is placed on a date, never on a weekday: the planner puts each
 * session on its own day and nothing repeats it. These are real dates in the
 * seeded year, one per ISO weekday, so a test can say "Wednesday" and mean a
 * Wednesday the platform will accept.
 */
const ON = {
  1: '2026-09-14',
  2: '2026-09-15',
  3: '2026-09-16',
  4: '2026-09-17',
  5: '2026-09-18',
} as const

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

    it('counts what is left to place against the year, not against a week', async () => {
      const version = await createVersion('year countdown')
      const group = await prisma.group.findFirstOrThrow({
        where: { centerId, plannedHours: { gt: 0 } },
      })

      const plan = (version.groups as { groupId: string; targetMinutes: number }[]).find(
        (entry) => entry.groupId === group.id,
      )

      // The whole year's teaching, not a week of it.
      expect(plan?.targetMinutes).toBe(Math.round(Number(group.plannedHours) * 60))
    })

    it('adds the groups’ own countdowns up into the number on the status bar', async () => {
      const version = await createVersion('pending total')
      const groups = version.groups as { sessionsRemaining: number }[]

      expect(version.summary.pending).toBe(
        groups.reduce((total, entry) => total + entry.sessionsRemaining, 0),
      )
    })

    it('reports the week with its conflicts, penalties and pending groups', async () => {
      const version = await createVersion('summary', publishedVersionId)

      expect(version.summary).toMatchObject({ blocked: 0 })
      expect(version.summary.placed).toBe(version.sessions.length)
      expect(version.grid).toMatchObject({ dayStart: '08:00', slotMinutes: 30 })
      expect(Array.isArray(version.pending)).toBe(true)
    })

    it('lists every group of the year, not only what is left to place', async () => {
      const version = await createVersion('groups', publishedVersionId)
      const year = await prisma.academicYear.findFirstOrThrow({
        where: { centerId, status: 'active' },
      })
      const total = await prisma.group.count({
        where: { subject: { academicYearId: year.id } },
      })

      expect(version.groups.length).toBe(total)

      // A group somebody has already finished is still listed, said to be
      // done: "have I done this one?" is what the column is for. Finished
      // means the year's hours are placed, so this makes one so.
      const placed = (version.groups as { groupId: string; placedMinutes: number }[]).find(
        (group) => group.placedMinutes > 0,
      )
      const group = await prisma.group.findFirstOrThrow({ where: { id: placed!.groupId } })

      try {
        await prisma.group.update({
          where: { id: group.id },
          data: { plannedHours: placed!.placedMinutes / 60 },
        })

        const reread = await app.inject({
          method: 'GET',
          url: `/api/v1/planner/versions/${version.id}`,
          headers: asCoordinator(),
        })

        const done = (reread.json().groups as { groupId: string; complete: boolean }[]).find(
          (entry) => entry.groupId === group.id,
        )
        expect(done?.complete).toBe(true)
      } finally {
        await prisma.group.update({
          where: { id: group.id },
          data: { plannedHours: group.plannedHours },
        })
      }
    })

    it('counts down the hours of a group as its classes are placed', async () => {
      const version = await createVersion('countdown')
      const target = version.groups.find(
        (group: { targetMinutes: number }) => group.targetMinutes > 0,
      )
      expect(target).toBeDefined()

      const before = target as { groupId: string; remainingMinutes: number }

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: {
          groupId: before.groupId,
          date: ON[3],
          startTime: '18:00',
          endTime: '19:00',
        },
      })
      expect(created.statusCode).toBe(201)

      const after = created
        .json()
        .groups.find((group: { groupId: string }) => group.groupId === before.groupId)

      // One hour placed is one hour fewer to place, in the same answer that
      // created it: the column moves as the class lands.
      expect(after.placedMinutes).toBe(60)
      expect(after.remainingMinutes).toBe(Math.max(0, before.remainingMinutes - 60))
    })

    it('never repeats a class onto another day', async () => {
      const version = await createVersion('once-only')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: { groupId: group.id, date: ON[2], startTime: '11:00', endTime: '12:00' },
      })

      // A week is planned by placing that week's classes; the following week
      // is placed again. Nothing here copies one onto another.
      expect(created.json().sessions).toHaveLength(1)
      expect(created.json().sessions[0]).toMatchObject({
        recurrence: 'once',
        dateFrom: ON[2],
        dateTo: ON[2],
        weekday: 2,
      })
    })

    it('refuses a session with no day to happen on', async () => {
      const version = await createVersion('dateless')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: { groupId: group.id, startTime: '11:00', endTime: '12:00' },
      })

      expect(response.statusCode).toBe(422)
    })

    it('says which dates the year runs between, so the grid opens inside it', async () => {
      const version = await createVersion('range')

      expect(version.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(version.range.to >= version.range.from).toBe(true)
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
          date: ON[5],
          startTime: '08:00',
          endTime: '10:00',
        },
      })

      expect(created.statusCode).toBe(201)
      expect(created.json().sessions).toHaveLength(1)
      const sessionId = created.json().sessions[0].id

      // Placed on one day and only on that day: both ends of the range are
      // the date it happens, and it happens once.
      expect(created.json().sessions[0]).toMatchObject({
        weekday: 5,
        dateFrom: ON[5],
        dateTo: ON[5],
        recurrence: 'once',
      })

      const moved = await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/sessions/${sessionId}`,
        headers: asCoordinator(),
        payload: { date: ON[4], startTime: '10:00', endTime: '12:00' },
      })

      expect(moved.statusCode).toBe(200)
      expect(moved.json().sessions[0]).toMatchObject({
        weekday: 4,
        dateFrom: ON[4],
        startTime: '10:00',
      })

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/planner/versions/${version.id}/sessions/${sessionId}`,
        headers: asCoordinator(),
      })
      expect(removed.json().sessions).toHaveLength(0)
    })

    it('places a class given by two people, and keeps both of them', async () => {
      const version = await createVersion('co-teaching')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })
      const [first, second] = await prisma.teacherProfile.findMany({
        where: { centerId },
        take: 2,
      })

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: {
          groupId: group.id,
          teacherProfileIds: [first!.id, second!.id],
          date: ON[3],
          startTime: '16:00',
          endTime: '17:00',
        },
      })

      expect(created.statusCode).toBe(201)
      const session = created.json().sessions[0]
      // The first of them is the session's own teacher, which is what every
      // screen that knows about one teacher goes on showing.
      expect(session.teacherProfileId).toBe(first!.id)
      expect(
        session.teachers.map((person: { teacherProfileId: string }) => person.teacherProfileId),
      ).toEqual([first!.id, second!.id])

      // Handing it to one person alone drops the other.
      const alone = await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/sessions/${session.id}`,
        headers: asCoordinator(),
        payload: { teacherProfileIds: [second!.id] },
      })

      expect(alone.json().sessions[0].teacherProfileId).toBe(second!.id)
      expect(alone.json().sessions[0].teachers).toHaveLength(1)
      expect(await prisma.sessionTeacher.count({ where: { sessionId: session.id } })).toBe(0)
    })

    it('warns when the second teacher is already teaching, and allows it', async () => {
      const version = await createVersion('co-teaching clash')
      const [group, otherGroup] = await prisma.group.findMany({ where: { centerId }, take: 2 })
      const [first, second] = await prisma.teacherProfile.findMany({
        where: { centerId },
        take: 2,
      })

      await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: {
          groupId: otherGroup!.id,
          teacherProfileId: second!.id,
          date: ON[3],
          startTime: '18:00',
          endTime: '19:00',
        },
      })

      const verdict = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/validate`,
        headers: asCoordinator(),
        payload: {
          groupId: group!.id,
          teacherProfileIds: [first!.id, second!.id],
          date: ON[3],
          startTime: '18:00',
          endTime: '19:00',
        },
      })

      /*
        Two groups meeting at once is what having two groups means, and one
        person can be on both: they open both practicals and move between
        them. It is said out loud and it is not refused.
      */
      const body = verdict.json() as {
        status: string
        violations: { messageKey: string }[]
        penalties: { messageKey: string }[]
      }

      expect(body.violations).toEqual([])
      expect(body.status).toBe('warning')
      expect(body.penalties.map((penalty) => penalty.messageKey)).toContain(
        'planner.soft.teacherOverlap',
      )
    })

    it('puts a class in the room its group normally meets in', async () => {
      const version = await createVersion('group room')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })
      const space = await prisma.space.findFirstOrThrow({ where: { centerId } })
      await prisma.group.update({ where: { id: group.id }, data: { spaceId: space.id } })

      try {
        const created = await app.inject({
          method: 'POST',
          url: `/api/v1/planner/versions/${version.id}/sessions`,
          headers: asCoordinator(),
          payload: {
            groupId: group.id,
            date: ON[4],
            startTime: '17:00',
            endTime: '18:00',
          },
        })

        expect(created.json().sessions[0].spaceId).toBe(space.id)

        // A default, not a rule: this one class can be somewhere else.
        const moved = await app.inject({
          method: 'PATCH',
          url: `/api/v1/planner/versions/${version.id}/sessions/${created.json().sessions[0].id}`,
          headers: asCoordinator(),
          payload: { spaceId: null },
        })
        expect(moved.json().sessions[0].spaceId).toBeNull()
      } finally {
        await prisma.group.update({ where: { id: group.id }, data: { spaceId: null } })
      }
    })

    it('repeats a class across the term, one ordinary session per day', async () => {
      const version = await createVersion('series')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: { groupId: group.id, date: ON[1], startTime: '12:00', endTime: '13:00' },
      })
      const sessionId = created.json().sessions[0].id

      const monday = new Date(`${ON[1]}T00:00:00Z`)
      const until = new Date(monday)
      until.setUTCDate(until.getUTCDate() + 14)

      const series = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions/${sessionId}/duplicate`,
        headers: asCoordinator(),
        payload: { weekdays: [1, 3], until: until.toISOString().slice(0, 10) },
      })

      expect(series.statusCode).toBe(201)
      const sessions = series.json().sessions as { weekday: number; recurrence: string }[]

      // Inside the fortnight: the Monday it was copied from, two more
      // Mondays and two Wednesdays.
      expect(sessions).toHaveLength(5)
      expect(sessions.every((session) => session.recurrence === 'once')).toBe(true)
      expect(new Set(sessions.map((session) => session.weekday))).toEqual(new Set([1, 3]))
    })

    it('does not put a class on a day the center is closed', async () => {
      const version = await createVersion('series over a holiday')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })
      const year = await prisma.academicYear.findFirstOrThrow({
        where: { centerId, status: 'active' },
      })

      const monday = new Date(`${ON[1]}T00:00:00Z`)
      const nextMonday = new Date(monday)
      nextMonday.setUTCDate(nextMonday.getUTCDate() + 7)
      const closed = nextMonday.toISOString().slice(0, 10)

      const holiday = await prisma.academicCalendarEntry.create({
        data: {
          centerId,
          academicYearId: year.id,
          type: 'holiday',
          dateFrom: nextMonday,
          dateTo: nextMonday,
          nameCa: 'Prova festiu sèrie',
          nameEs: 'Prova festiu sèrie',
          nameEn: 'Prova festiu sèrie',
          isTeachingDay: false,
        },
      })

      try {
        const created = await app.inject({
          method: 'POST',
          url: `/api/v1/planner/versions/${version.id}/sessions`,
          headers: asCoordinator(),
          payload: { groupId: group.id, date: ON[1], startTime: '13:00', endTime: '14:00' },
        })

        const series = await app.inject({
          method: 'POST',
          url: `/api/v1/planner/versions/${version.id}/sessions/${created.json().sessions[0].id}/duplicate`,
          headers: asCoordinator(),
          payload: { weekdays: [1], until: closed },
        })

        expect(series.json().created).toBe(0)
        expect(series.json().skipped).toBe(1)
      } finally {
        await prisma.academicCalendarEntry.delete({ where: { id: holiday.id } })
      }
    })

    it('starts a class of a group at the length that group teaches in', async () => {
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })
      await prisma.group.update({ where: { id: group.id }, data: { sessionMinutes: 180 } })

      try {
        const version = await createVersion('lab length')
        const plan = (version.groups as { groupId: string; durationMinutes: number }[]).find(
          (entry) => entry.groupId === group.id,
        )

        // What a drag from the groups column places, rather than the center's
        // own default.
        expect(plan?.durationMinutes).toBe(180)
      } finally {
        await prisma.group.update({ where: { id: group.id }, data: { sessionMinutes: null } })
      }
    })

    it('refuses an hour that ends before it starts, however it was dragged', async () => {
      const version = await createVersion('backwards')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })

      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: { groupId: group.id, date: ON[2], startTime: '09:00', endTime: '10:00' },
      })

      // Dragging the top edge past the bottom one: only one end is sent, so
      // the refusal has to come from what the class would become.
      const resized = await app.inject({
        method: 'PATCH',
        url: `/api/v1/planner/versions/${version.id}/sessions/${created.json().sessions[0].id}`,
        headers: asCoordinator(),
        payload: { startTime: '11:00' },
      })

      expect(resized.statusCode).toBe(422)
    })

    it('refuses to touch a published version', async () => {
      const group = await prisma.group.findFirst({ where: { centerId } })
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${publishedVersionId}/sessions`,
        headers: asCoordinator(),
        payload: { groupId: group!.id, date: ON[1], startTime: '08:00', endTime: '09:00' },
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
        payload: { groupId: group!.id, date: ON[5], startTime: '19:00', endTime: '20:00' },
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
      const version = await createVersion('validate')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })
      const profile = await prisma.teacherProfile.findFirstOrThrow({ where: { centerId } })

      // A class of this model — placed on a day — rather than one of the
      // seeded weekly rows, whose `dateFrom` is the start of term and not the
      // day they happen on.
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: {
          groupId: group.id,
          teacherProfileId: profile.id,
          date: ON[2],
          startTime: '09:00',
          endTime: '10:00',
        },
      })
      const existing = created.json().sessions[0]

      const blocked = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/validate`,
        headers: asCoordinator(),
        payload: {
          groupId: existing.groupId,
          teacherProfileId: existing.teacherProfileId,
          spaceId: existing.spaceId,
          date: ON[2],
          startTime: '09:00',
          endTime: '10:00',
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
          date: ON[2],
          startTime: '09:00',
          endTime: '10:00',
        },
      })

      expect(itself.json().status).not.toBe('blocked')
    })

    it('does not clash with the same slot in another week', async () => {
      const version = await createVersion('other-week')
      const group = await prisma.group.findFirstOrThrow({ where: { centerId } })
      const profile = await prisma.teacherProfile.findFirstOrThrow({ where: { centerId } })

      await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/sessions`,
        headers: asCoordinator(),
        payload: {
          groupId: group.id,
          teacherProfileId: profile.id,
          date: ON[2],
          startTime: '09:00',
          endTime: '10:00',
        },
      })

      // The Tuesday of the following week. Nothing repeats, so Tuesday at nine
      // is free again — which is the whole point of placing by date.
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/planner/versions/${version.id}/validate`,
        headers: asCoordinator(),
        payload: {
          groupId: group.id,
          teacherProfileId: profile.id,
          date: '2026-09-22',
          startTime: '09:00',
          endTime: '10:00',
        },
      })

      expect(response.json().status).not.toBe('blocked')
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
          // A Saturday: nobody has declared themselves available on one.
          date: '2026-09-19',
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
        // Moving a class is moving its date: `weekday` is derived from it.
        payload: { date: moved.weekday === 5 ? ON[4] : ON[5] },
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

    it('publishes a year of classes for a teacher whose contract covers them', async () => {
      /*
        A version holds every class of the year, one date at a time, so a
        teacher's hours in it are the year's hours. Weighed against a week's
        share of their contract instead, a normally contracted teacher tripped
        the capacity rule and publication was refused for "conflicts" nobody
        could find on the grid.

        A version of its own, with nothing in it but this year of classes, so
        the only rule it can break is the one under test.
      */
      const version = await createVersion('year')
      const profile = await prisma.teacherProfile.findFirstOrThrow({
        where: { user: { email: SEED.teacherEmail } },
        include: { availability: { orderBy: { weekday: 'asc' } } },
      })
      // Mornings, Monday to Friday, as this teacher declared them.
      const window = profile.availability.find((entry) => entry.level !== 'unavailable')!
      const startTime = window.startTime
      const endTime = `${String(Number(startTime.slice(0, 2)) + 2).padStart(2, '0')}:${startTime.slice(3)}`

      // A group an ordinary classroom can hold: the room below is one, and a
      // group that needs a laboratory would fail on the room rather than on
      // the hours this test is about.
      const group = await prisma.group.findFirstOrThrow({
        where: {
          subject: { academicYearId: profile.academicYearId },
          requiredSpaceType: 'classroom',
          capacity: { lte: 200 },
        },
        orderBy: { code: 'asc' },
      })

      // A room of this test's own, so nothing it places lands on top of a
      // class the center already holds. Cleared first in case an earlier run
      // failed before it could put the room back.
      await prisma.space.deleteMany({ where: { centerId, name: 'Prova aula anual' } })
      const space = await prisma.space.create({
        data: {
          centerId,
          name: 'Prova aula anual',
          building: 'Prova',
          capacity: 200,
          type: 'classroom',
        },
      })

      // Enough two-hour classes to fill four fifths of the contract: a full
      // year's work, and inside it.
      const contracted = Number(profile.contractedHours)
      expect(contracted).toBeGreaterThan(0)
      const wanted = Math.floor((contracted * 0.8) / 2)

      const dates: Date[] = []
      for (let day = 0; dates.length < wanted && day < 500; day += 1) {
        const date = new Date(Date.UTC(2026, 8, 21) + day * 24 * 60 * 60 * 1000)
        // Only the days this teacher is available on.
        if (
          !profile.availability.some((entry) => entry.weekday === ((date.getUTCDay() + 6) % 7) + 1)
        )
          continue
        dates.push(date)
      }
      expect(dates).toHaveLength(wanted)

      await prisma.classSession.createMany({
        data: dates.map((date) => ({
          centerId,
          scheduleVersionId: version.id,
          groupId: group.id,
          teacherProfileId: profile.id,
          spaceId: space.id,
          weekday: ((date.getUTCDay() + 6) % 7) + 1,
          startTime,
          endTime,
          dateFrom: date,
          dateTo: date,
          recurrence: 'once',
        })),
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

      expect(response.statusCode).toBe(200)

      await prisma.classSession.deleteMany({ where: { spaceId: space.id } })
      await prisma.space.delete({ where: { id: space.id } })
      await prisma.notification.deleteMany({ where: { type: 'schedule.published' } })
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
})
