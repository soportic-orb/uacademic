import { disconnectPrisma } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('API surface', () => {
  let app: FastifyInstance
  let centerId: string

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  it('answers the healthcheck without an identity', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } })
  })

  it('rejects an anonymous request to a business route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/subjects' })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('UNAUTHORIZED')
  })

  it('returns the caller with the roles resolved from the database', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { 'x-mock-user': SEED.teacherEmail },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.email).toBe(SEED.teacherEmail)
    expect(body.memberships.map((m: { role: string }) => m.role).sort()).toEqual([
      'COORDINATOR',
      'TEACHER',
    ])
  })

  it('computes the teaching load with the center thresholds', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers/load',
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.teachers).toHaveLength(12)
    expect(body.summary.byStatus).toEqual({ under: 3, optimal: 5, limit: 2, over: 2 })

    const overloaded = body.teachers.find(
      (teacher: { status: string }) => teacher.status === 'over',
    )
    expect(overloaded.ratioPercent).toBeGreaterThan(110)
  })

  it('hides the full teacher list from a plain teacher', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers/load',
      headers: { 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId },
    })

    expect(response.statusCode).toBe(403)
  })

  it('lets a teacher read their own load', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers/me/load',
      headers: { 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ lastName: 'Vila Rovira', status: 'under' })
  })

  it('returns the center settings with the provenance of each parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/centers/settings',
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.settings.load.thresholds.limitUpTo).toBe(110)

    const cited = body.provenance.find(
      (record: { paramKey: string }) => record.paramKey === 'schedule.maxConsecutiveHours',
    )
    expect(cited.section).toBe('Article 8.2')
    expect(cited.documentTitle).toContain('Normativa')
  })

  it('translates errors using the Accept-Language header when nobody is signed in', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      headers: { 'accept-language': 'es-ES,es;q=0.9' },
    })

    // An anonymous caller is stopped before routing, so an unknown path does
    // not disclose whether it exists.
    expect(response.statusCode).toBe(401)
    expect(response.json().error.message).toBe('Es necesario iniciar sesión.')
  })

  it('translates errors using the stored preference of a signed-in user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      headers: { 'x-mock-user': SEED.teacherEmail, 'accept-language': 'es-ES,es;q=0.9' },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.message).toBe('No hem trobat el recurs.')
  })
})
