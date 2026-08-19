/**
 * A center on its first day.
 *
 * Nothing has been imported, the academic calendar has not been set up, and
 * the only account is the superadmin the installer created. Every screen has
 * to work — showing empty states — because this is what everybody sees before
 * they see anything else. What it must not do is greet them with errors.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase } from './helpers.js'

describe.skipIf(!hasDatabase)('a center with nothing in it yet', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let universityId: string
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await createTestApp()

    const university = await prisma.university.create({ data: { name: 'Universitat Buida' } })
    universityId = university.id
    const center = await prisma.center.create({
      data: { universityId, name: 'Centre Buit', code: 'BUIT', settingsJson: {} },
    })
    centerId = center.id

    const superadmin = await prisma.user.findFirstOrThrow({
      where: { email: SEED.superadminEmail },
    })
    await prisma.userCenterRole.create({
      data: { userId: superadmin.id, centerId, role: 'SUPERADMIN' },
    })

    headers = { 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId }
  })

  afterAll(async () => {
    await prisma.userCenterRole.deleteMany({ where: { centerId } })
    await prisma.center.delete({ where: { id: centerId } })
    await prisma.university.delete({ where: { id: universityId } })
    await app.close()
    await disconnectPrisma()
  })

  it('has no subjects, and says so with a list rather than a 404', async () => {
    // No academic year has been created yet, so there is nothing to teach.
    // Answering "we could not find the resource" made that look like a fault.
    const response = await app.inject({ method: 'GET', url: '/api/v1/subjects', headers })

    expect(response.statusCode).toBe(200)
    expect(response.json().items).toEqual([])
  })

  /**
   * What a coordinator sees on opening the product. This answered 404, the
   * dashboard turned it into "something went wrong", and the person had no
   * way of knowing that what was missing was an academic year.
   */
  it('summarises a teaching load of nothing rather than failing', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/teachers/load', headers })

    expect(response.statusCode).toBe(200)
    expect(response.json().academicYearId).toBeNull()
    expect(response.json().teachers).toEqual([])
    expect(response.json().summary).toMatchObject({
      teachers: 0,
      byStatus: { under: 0, optimal: 0, limit: 0, over: 0 },
    })
  })

  it('exports that same empty table instead of refusing to', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers/load/export',
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('spreadsheetml')
  })

  it('opens the document library without a single error', async () => {
    // Exactly what that screen asks for on load. One rejected call is one
    // red toast in front of somebody's first impression of the platform.
    const urls = [
      '/api/v1/documents',
      '/api/v1/admin/academic-years?pageSize=50',
      '/api/v1/admin/degrees?pageSize=100',
      '/api/v1/subjects',
      '/api/v1/teachers/load',
    ]

    const statuses = await Promise.all(
      urls.map(async (url) => {
        const response = await app.inject({ method: 'GET', url, headers })
        return `${url} → ${response.statusCode}`
      }),
    )

    expect(statuses).toEqual(urls.map((url) => `${url} → 200`))
  })

  it('refuses a page larger than it will serve, so the cap is not a suggestion', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/degrees?pageSize=200',
      headers,
    })

    expect(response.statusCode).toBe(422)
  })
})
