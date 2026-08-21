/**
 * Setting the center's parameters by hand.
 *
 * Reading them out of a regulation is the path that carries citations, but a
 * center that simply knows its own maximum teaching hours had no way to say
 * so: every parameter on the screen was read-only.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { readSettingValue } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('editing the center parameters by hand', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    headers = { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId }
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  const patch = (values: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/v1/centers/settings', headers, payload: { values } })

  it('changes the one parameter it was given and leaves the rest alone', async () => {
    const before = (
      await app.inject({ method: 'GET', url: '/api/v1/centers/settings', headers })
    ).json().settings

    const response = await patch({ 'capacity.maxTeachingHoursYear': 300 })

    expect(response.statusCode).toBe(200)
    const after = response.json().settings
    expect(readSettingValue(after, 'capacity.maxTeachingHoursYear')).toBe(300)
    // Untouched neighbours keep their values, which is the whole reason the
    // request carries paths rather than a whole settings object.
    expect(readSettingValue(after, 'capacity.creditToHours')).toEqual(
      readSettingValue(before, 'capacity.creditToHours'),
    )
  })

  it('writes a version and an audit entry, so the change can be explained', async () => {
    const versionsBefore = await prisma.centerSettingsVersion.count({ where: { centerId } })

    await patch({ 'schedule.defaultSessionMinutes': 90 })

    expect(await prisma.centerSettingsVersion.count({ where: { centerId } })).toBe(
      versionsBefore + 1,
    )
    const entry = await prisma.auditLog.findFirst({
      where: { centerId, entity: 'center_settings' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry?.source).toBe('user')
  })

  it('writes a collection: the categories a center names for itself', async () => {
    const categories = [
      {
        code: 'AS66',
        label: 'Associat 6+6',
        baseCapacityHours: 120,
        maxTeachingHours: 180,
        mapsTo: 'adjunct',
        notes: null,
      },
    ]

    const response = await patch({ categories })

    expect(response.statusCode).toBe(200)
    expect(readSettingValue(response.json().settings, 'categories')).toMatchObject([
      { code: 'AS66', baseCapacityHours: 120, mapsTo: 'adjunct' },
    ])
  })

  it('refuses a row that is missing a column the schema requires', async () => {
    // Which is what an added-but-unfilled row is, and the point of sending
    // every column: the answer names the field rather than the whole list.
    const response = await patch({ categories: [{ code: '', label: 'Sense codi' }] })

    expect(response.statusCode).toBe(422)
  })

  it('writes the days the center teaches, and refuses an empty week', async () => {
    expect((await patch({ 'schedule.workingWeekdays': [1, 2, 3, 4] })).statusCode).toBe(200)
    expect((await patch({ 'schedule.workingWeekdays': [] })).statusCode).toBe(422)

    // Put back: this is the seeded center, the planner reads its weekdays for
    // the grid, and the test files run in parallel against one database.
    expect((await patch({ 'schedule.workingWeekdays': [1, 2, 3, 4, 5] })).statusCode).toBe(200)
  })

  it('refuses a value the settings schema will not have', async () => {
    const response = await patch({ 'capacity.maxTeachingHoursYear': -40 })

    expect(response.statusCode).toBe(422)
  })

  it('refuses a parameter that does not exist, rather than inventing one', async () => {
    const response = await patch({ 'capacity.inventat': 12 })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.details?.[0]?.path).toBe('values.capacity.inventat')
  })

  it('is not something a coordinator can do', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/centers/settings',
      headers: { 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId },
      payload: { values: { 'capacity.maxTeachingHoursYear': 100 } },
    })

    expect(response.statusCode).toBe(403)
  })
})
