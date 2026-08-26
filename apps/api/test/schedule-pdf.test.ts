/**
 * The timetable somebody prints and pins above a desk.
 *
 * What matters is that it says the same thing the phone calendar does — the
 * weekly template minus the days the center is shut — and that only the right
 * people can ask for somebody else's.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { extractText } from '../src/services/documents/extract.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('the printable timetable', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let profileId: string

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    const profile = await prisma.teacherProfile.findFirstOrThrow({
      where: { centerId, user: { email: SEED.teacherEmail } },
    })
    profileId = profile.id
  })

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { type: 'teacher.schedule' } })
    await app.close()
    await disconnectPrisma()
  })

  const asTeacher = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asOtherTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  const download = (id: string, query: string, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/api/v1/teachers/${id}/schedule.pdf?${query}`, headers })

  it('gives a teacher their own, as a PDF', async () => {
    const response = await download('me', 'from=2026-09-01&to=2026-12-31', asTeacher())

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    // A real document, not an empty file with the right header.
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    expect(response.rawPayload.length).toBeGreaterThan(1000)
  })

  /**
   * A printed timetable is read away from the screen, so it has to answer on
   * its own: when does this finish, what is it, and where.
   */
  it('prints the whole hour, what the class is, and the room', async () => {
    const session = await prisma.classSession.findFirstOrThrow({
      where: { teacherProfileId: profileId, scheduleVersion: { status: 'published' } },
      include: { group: { select: { subject: { select: { nameCa: true } } } }, space: true },
    })
    /*
      A room of this test's own: borrowing one of the center's would put two
      published classes in the same room at the same hour, and any other test
      reading the timetable at that moment would see a conflict that has
      nothing to do with it.
    */
    const space = await prisma.space.create({
      data: {
        centerId,
        name: 'Prova aula impresa',
        building: 'Prova',
        capacity: 60,
        type: 'classroom',
      },
    })

    await prisma.classSession.update({
      where: { id: session.id },
      data: { spaceId: space.id, topic: 'Prova tema imprès' },
    })

    try {
      const response = await download('me', 'from=2026-09-01&to=2026-12-31', asTeacher())
      const { pages } = await extractText(
        new Uint8Array(response.rawPayload),
        'application/pdf',
        'timetable.pdf',
      )
      const text = pages.map((page) => page.text).join(' ')

      expect(text).toContain(`${session.startTime}–${session.endTime}`)
      expect(text).toContain('Prova tema imprès')
      expect(text).toContain(space.name)
    } finally {
      await prisma.classSession.update({
        where: { id: session.id },
        data: { spaceId: session.spaceId, topic: session.topic },
      })
      await prisma.space.delete({ where: { id: space.id } })
    }
  })

  it('names the subject when nobody wrote a topic on the class', async () => {
    const session = await prisma.classSession.findFirstOrThrow({
      where: { teacherProfileId: profileId, scheduleVersion: { status: 'published' } },
      include: { group: { select: { subject: { select: { nameCa: true } } } } },
    })

    await prisma.classSession.update({ where: { id: session.id }, data: { topic: null } })

    const response = await download('me', 'from=2026-09-01&to=2026-12-31', asTeacher())
    const { pages } = await extractText(
      new Uint8Array(response.rawPayload),
      'application/pdf',
      'timetable.pdf',
    )

    expect(pages.map((page) => page.text).join(' ')).toContain(
      session.group.subject.nameCa.slice(0, 12),
    )
  })

  it('draws a page per month of the range', async () => {
    const short = await download('me', 'from=2026-09-01&to=2026-09-30', asTeacher())
    const long = await download('me', 'from=2026-09-01&to=2027-01-31', asTeacher())

    // Five months of pages weigh more than one, whatever else is on them.
    expect(long.rawPayload.length).toBeGreaterThan(short.rawPayload.length)
  })

  it('still produces a document when the range holds no classes', async () => {
    // An empty file that downloads and opens on nothing looks like a failure.
    const response = await download('me', 'from=2030-07-01&to=2030-07-31', asTeacher())

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('refuses a range that runs backwards', async () => {
    const response = await download('me', 'from=2026-12-31&to=2026-09-01', asTeacher())

    expect(response.statusCode).toBe(422)
  })

  it('hands a coordinator anybody’s timetable', async () => {
    const response = await download(profileId, 'from=2026-09-01&to=2026-09-30', {
      'x-mock-user': SEED.adminEmail,
      'x-center-id': centerId,
    })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('does not hand one lecturer another lecturer’s timetable', async () => {
    const response = await download(profileId, 'from=2026-09-01&to=2026-09-30', asOtherTeacher())

    expect(response.statusCode).toBe(403)
  })

  it('queues one message per contracted teacher when the coordinator sends them', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teachers/schedules/send',
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
      payload: { from: '2026-09-01', to: '2026-12-31' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().queued).toBeGreaterThan(0)

    const queued = await prisma.job.count({ where: { type: 'teacher.schedule' } })
    expect(queued).toBe(response.json().queued)
  })

  /*
    A draft is nobody's week: it is the version a coordinator is still moving
    classes around in, and thirty people receiving one would plan their term
    from it.
  */
  it('refuses to send a timetable nobody has published', async () => {
    const published = await prisma.scheduleVersion.findMany({
      where: { centerId, status: 'published' },
      select: { id: true },
    })
    await prisma.scheduleVersion.updateMany({
      where: { id: { in: published.map((version) => version.id) } },
      data: { status: 'draft' },
    })

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/teachers/schedules/send',
        headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
        payload: { from: '2026-09-01', to: '2026-12-31' },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.messageKey).toBe('teachers.schedule.errors.notPublished')
    } finally {
      await prisma.scheduleVersion.updateMany({
        where: { id: { in: published.map((version) => version.id) } },
        data: { status: 'published' },
      })
    }
  })

  it('sends to only the people named, when the request names any', async () => {
    await prisma.job.deleteMany({ where: { type: 'teacher.schedule' } })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teachers/schedules/send',
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
      payload: { from: '2026-09-01', to: '2026-12-31', teacherProfileIds: [profileId] },
    })

    expect(response.json().queued).toBe(1)
  })

  it('is not something a lecturer can trigger for the whole center', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teachers/schedules/send',
      headers: asOtherTeacher(),
      payload: { from: '2026-09-01', to: '2026-12-31' },
    })

    expect(response.statusCode).toBe(403)
  })
})
