/**
 * The days the center is shut, delivered with the week.
 *
 * The planner is a weekly template: a session on Monday repeats over every
 * Monday of the term, and the engine skips the closed dates when it turns that
 * into actual classes. The grid could not say so, because it had never been
 * told which dates those are.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('the calendar the planner shows', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let headers: Record<string, string>
  let versionId: string
  const madeEntries: string[] = []

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    headers = { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId }

    const year = await prisma.academicYear.findFirstOrThrow({
      where: { centerId, status: 'active' },
    })

    for (const entry of [
      {
        type: 'vacation' as const,
        dateFrom: new Date('2026-12-24'),
        dateTo: new Date('2027-01-06'),
        nameCa: 'Prova Nadal',
        isTeachingDay: false,
      },
      {
        type: 'exam_period' as const,
        dateFrom: new Date('2027-01-12'),
        dateTo: new Date('2027-01-23'),
        nameCa: 'Prova exàmens',
        isTeachingDay: true,
      },
    ]) {
      const created = await prisma.academicCalendarEntry.create({
        data: {
          centerId,
          academicYearId: year.id,
          nameEs: entry.nameCa,
          nameEn: entry.nameCa,
          ...entry,
        },
      })
      madeEntries.push(created.id)
    }

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/planner/versions',
      headers,
      payload: { name: 'Prova calendari' },
    })
    versionId = created.json().id
  })

  afterAll(async () => {
    await prisma.classSession.deleteMany({ where: { scheduleVersionId: versionId } })
    await prisma.scheduleVersion.deleteMany({ where: { id: versionId } })
    await prisma.academicCalendarEntry.deleteMany({ where: { id: { in: madeEntries } } })
    await app.close()
    await disconnectPrisma()
  })

  it('sends the year’s calendar alongside the week', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/planner/versions/${versionId}`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    const calendar = response.json().context.calendar as { name: string }[]
    expect(calendar.map((entry) => entry.name)).toContain('Prova Nadal')
  })

  it('says of each entry whether classes happen, which is what shading needs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/planner/versions/${versionId}`,
      headers,
    })

    const calendar = response.json().context.calendar as {
      name: string
      isTeachingDay: boolean
      dateFrom: string
      dateTo: string
    }[]

    const holiday = calendar.find((entry) => entry.name === 'Prova Nadal')
    const exams = calendar.find((entry) => entry.name === 'Prova exàmens')

    expect(holiday?.isTeachingDay).toBe(false)
    // An exam fortnight is on the calendar and is not a closure.
    expect(exams?.isTeachingDay).toBe(true)
    // Dates as plain days, not instants: a timetable is not timezone-shifted.
    expect(holiday?.dateFrom).toBe('2026-12-24')
    expect(holiday?.dateTo).toBe('2027-01-06')
  })
})
