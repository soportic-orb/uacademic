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
