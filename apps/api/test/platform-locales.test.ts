/**
 * Which languages the platform offers.
 *
 * The catalogues always carry all three (R1); this decides which of them are
 * offered to choose from. The distinction matters: a language that is switched
 * off must not leave anybody looking at raw keys.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('the languages the platform offers', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await createTestApp()
    headers = { 'x-mock-user': SEED.superadminEmail, 'x-center-id': await seedCenterId() }
  })

  afterEach(async () => {
    await prisma.platformSetting.deleteMany({ where: { key: 'enabledLocales' } })
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  const set = (locales: string[]) =>
    app.inject({ method: 'PUT', url: '/api/v1/platform/locales', headers, payload: { locales } })

  it('offers all three until somebody says otherwise', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/locales',
      headers,
    })

    expect(response.json().enabled).toEqual(['ca', 'es', 'en'])
  })

  it('keeps the choice, in the order the platform lists them', async () => {
    const response = await set(['en', 'ca'])

    expect(response.statusCode).toBe(200)
    // Asked for in one order, stored in the platform's own.
    expect(response.json().enabled).toEqual(['ca', 'en'])
  })

  it('tells the sign-in screen, which has no session to ask with', async () => {
    await set(['ca'])

    const config = await app.inject({ method: 'GET', url: '/api/v1/auth/config' })

    expect(config.statusCode).toBe(200)
    expect(config.json().locales).toEqual(['ca'])
  })

  it('refuses to leave the platform in no language at all', async () => {
    const response = await set([])

    expect(response.statusCode).toBe(422)
  })

  it('ignores a language that is not one of the three', async () => {
    const response = await set(['ca', 'de'])

    expect(response.statusCode).toBe(422)
  })

  it('is the superadmin’s alone', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/platform/locales',
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': await seedCenterId() },
      payload: { locales: ['ca'] },
    })

    expect(response.statusCode).toBe(403)
  })
})
