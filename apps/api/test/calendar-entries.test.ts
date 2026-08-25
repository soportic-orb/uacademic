/**
 * The academic calendar: the days the planner must not place anything on.
 *
 * Creating one answered "something went wrong" — the model was outside the
 * tenant filter, so `center_id` was never written and every insert failed on a
 * NOT NULL column.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  FOREIGN,
  SEED,
  createTestApp,
  ensureForeignCenter,
  hasDatabase,
  seedCenterId,
} from './helpers.js'

describe.skipIf(!hasDatabase)('the academic calendar', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let academicYearId: string
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    headers = { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId }
    const year = await prisma.academicYear.findFirstOrThrow({
      where: { centerId, status: 'active' },
    })
    academicYearId = year.id
    await ensureForeignCenter()
  })

  afterAll(async () => {
    await prisma.academicCalendarEntry.deleteMany({ where: { nameCa: { startsWith: 'Prova ' } } })
    await prisma.calendarType.deleteMany({ where: { centerId } })
    await app.close()
    await disconnectPrisma()
  })

  const entry = (overrides: Record<string, unknown> = {}) => ({
    academicYearId,
    type: 'holiday',
    dateFrom: '2026-12-24',
    dateTo: '2027-01-06',
    nameCa: 'Prova Nadal',
    nameEs: 'Prueba Navidad',
    nameEn: 'Christmas test',
    isTeachingDay: false,
    ...overrides,
  })

  it('creates a period, which is what used to fail outright', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/calendar-entries',
      headers,
      payload: entry(),
    })

    expect(response.statusCode).toBe(201)

    const stored = await prisma.academicCalendarEntry.findFirstOrThrow({
      where: { id: response.json().id },
    })
    // The column the insert never used to reach.
    expect(stored.centerId).toBe(centerId)
  })

  it('creates a single day, with the same date at both ends', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/calendar-entries',
      headers,
      payload: entry({
        type: 'non_teaching',
        dateFrom: '2026-11-01',
        dateTo: '2026-11-01',
        nameCa: 'Prova Tots Sants',
      }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().dateFrom).toBe(response.json().dateTo)
  })

  it('accepts the holiday-period type the screen now offers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/calendar-entries',
      headers,
      payload: entry({ type: 'vacation', nameCa: 'Prova vacances' }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().type).toBe('vacation')
  })

  describe('the kinds of day a center may use', () => {
    it('offers the ones the platform ships with', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/calendar-types',
        headers,
      })

      const items = response.json().items as { id: string; name: string; builtIn: boolean }[]
      expect(items.map((item) => item.id)).toEqual(
        expect.arrayContaining(['holiday', 'vacation', 'term_start', 'term_end']),
      )
      // Named in the reader's language, not as a key.
      expect(items.find((item) => item.id === 'holiday')?.name).toBe('Festiu')
    })

    it('lets a center add its own, and then use it on an entry', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-types',
        headers,
        payload: { nameCa: 'Simulacre d’incendi' },
      })

      expect(created.statusCode).toBe(201)
      expect(created.json().id).toBe('simulacre_d_incendi')

      const listed = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/calendar-types',
        headers,
      })
      expect(
        (listed.json().items as { id: string }[]).some((item) => item.id === 'simulacre_d_incendi'),
      ).toBe(true)

      const entryResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-entries',
        headers,
        payload: entry({ type: 'simulacre_d_incendi', nameCa: 'Prova simulacre' }),
      })

      expect(entryResponse.statusCode).toBe(201)
      expect(entryResponse.json().type).toBe('simulacre_d_incendi')
    })

    it('takes the Catalan name for the languages nobody filled in', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-types',
        headers,
        payload: { nameCa: 'Portes obertes', nameEn: 'Open day' },
      })

      const stored = await prisma.calendarType.findFirstOrThrow({
        where: { centerId, key: 'portes_obertes' },
      })
      expect(stored.nameEs).toBe('Portes obertes')
      expect(stored.nameEn).toBe('Open day')
    })

    it('refuses one that would shadow a type the platform already has', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-types',
        headers,
        payload: { nameCa: 'holiday' },
      })

      expect(response.statusCode).toBe(409)
    })

    it('refuses an entry whose type this center does not have', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-entries',
        headers,
        payload: entry({ type: 'inventat', nameCa: 'Prova inventada' }),
      })

      // An open column is not a licence to invent one: it has to be a type
      // somebody can see in the list.
      expect(response.statusCode).toBe(422)
    })

    it('keeps a center’s own types to itself (R2)', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-types',
        headers,
        payload: { nameCa: 'Nomes aqui' },
      })

      const foreign = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/calendar-types',
        headers: { 'x-mock-user': SEED.superadminEmail, 'x-center-id': FOREIGN.centerId },
      })

      expect((foreign.json().items as { id: string }[]).map((item) => item.id)).not.toContain(
        'nomes_aqui',
      )
    })
  })

  /**
   * A center types Sant Jordi once. Every calendar after that starts with it.
   */
  describe('days that come round every year', () => {
    it('carries them into a new academic year, on the same date', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-entries',
        headers,
        payload: entry({
          type: 'holiday',
          dateFrom: '2026-12-25',
          dateTo: '2026-12-25',
          nameCa: 'Prova Nadal anual',
          repeatsYearly: true,
        }),
      })

      // And one that does not repeat: an exam period is different every year.
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-entries',
        headers,
        payload: entry({
          type: 'exam_period',
          dateFrom: '2027-01-11',
          dateTo: '2027-01-22',
          nameCa: 'Prova exàmens',
        }),
      })

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/academic-years',
        headers,
        payload: { name: 'Prova 2027–2028', startDate: '2027-09-01', endDate: '2028-07-31' },
      })

      expect(created.statusCode).toBe(201)
      const carried = await prisma.academicCalendarEntry.findMany({
        where: { academicYearId: created.json().id },
      })

      try {
        expect(carried).toHaveLength(1)
        expect(carried[0]).toMatchObject({
          nameCa: 'Prova Nadal anual',
          // The same day, a year on, and still marked so the next year gets it.
          repeatsYearly: true,
        })
        expect(carried[0]?.dateFrom.toISOString().slice(0, 10)).toBe('2027-12-25')
      } finally {
        await prisma.academicCalendarEntry.deleteMany({
          where: { academicYearId: created.json().id },
        })
        await prisma.academicYear.delete({ where: { id: created.json().id } })
      }
    })

    it('leaves behind a day that would fall outside the new year', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/calendar-entries',
        headers,
        payload: entry({
          type: 'holiday',
          // August: the gap between one academic year and the next.
          dateFrom: '2026-08-15',
          dateTo: '2026-08-15',
          nameCa: 'Prova agost',
          repeatsYearly: true,
        }),
      })

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/academic-years',
        headers,
        payload: { name: 'Prova 2027–2028 b', startDate: '2027-09-01', endDate: '2028-07-31' },
      })

      try {
        const carried = await prisma.academicCalendarEntry.findMany({
          where: { academicYearId: created.json().id, nameCa: 'Prova agost' },
        })
        expect(carried).toHaveLength(0)
      } finally {
        await prisma.academicCalendarEntry.deleteMany({
          where: { academicYearId: created.json().id },
        })
        await prisma.academicYear.delete({ where: { id: created.json().id } })
      }
    })
  })

  it('refuses a range that ends before it starts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/calendar-entries',
      headers,
      payload: entry({ dateFrom: '2027-01-06', dateTo: '2026-12-24' }),
    })

    expect(response.statusCode).toBe(422)
  })

  it('does not show one center its neighbour’s calendar', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/calendar-entries',
      headers,
      payload: entry({ nameCa: 'Prova nomes aqui' }),
    })

    const foreign = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/calendar-entries?pageSize=100',
      headers: { 'x-mock-user': SEED.superadminEmail, 'x-center-id': FOREIGN.centerId },
    })

    const names = foreign.json().items.map((row: { nameCa: string }) => row.nameCa)
    expect(names).not.toContain('Prova nomes aqui')
  })
})
