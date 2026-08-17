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

    // Asserted on the seeded people rather than on a census: the import tests
    // and the e2e suite add teachers to the same database, so a total would
    // depend on what ran before.
    const seeded = (lastName: string) =>
      body.teachers.find((teacher: { lastName: string }) => teacher.lastName === lastName)

    expect(body.teachers.length).toBeGreaterThanOrEqual(12)
    expect(seeded('Mestre Pons')).toMatchObject({ status: 'over', ratioPercent: 116.67 })
    expect(seeded('Puig Serra')).toMatchObject({ status: 'optimal', ratioPercent: 90 })
    expect(seeded('Vila Rovira')).toMatchObject({ status: 'under' })
    expect(seeded('Torres Gil')).toMatchObject({ status: 'limit' })

    // Every state of the traffic light is represented in the demo data.
    expect(new Set(body.teachers.map((teacher: { status: string }) => teacher.status))).toEqual(
      new Set(['under', 'optimal', 'limit', 'over']),
    )
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
