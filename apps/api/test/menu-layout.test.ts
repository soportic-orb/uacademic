/**
 * The order somebody keeps their own menu in.
 *
 * On the account rather than in the browser, so it follows them between the
 * office desktop and home — and carrying no permission whatsoever, which is
 * the thing worth pinning down: what a menu may contain is still decided by
 * the roles on every request (R3).
 */
import { Prisma, disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('a personal menu order', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let userId: string

  const headers = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  const read = () => app.inject({ method: 'GET', url: '/api/v1/me/menu', headers: headers() })

  const write = (entries: unknown[]) =>
    app.inject({ method: 'PUT', url: '/api/v1/me/menu', headers: headers(), payload: { entries } })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    userId = (await prisma.user.findFirstOrThrow({ where: { email: SEED.teacherEmail } })).id
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  afterEach(async () => {
    // `Prisma.DbNull`, not `undefined`: on a nullable JSON column undefined
    // means "leave it alone", so the cleanup would quietly do nothing.
    await prisma.user.update({ where: { id: userId }, data: { menuLayoutJson: Prisma.DbNull } })
  })

  it('is empty until somebody arranges one, which means the product’s own order', async () => {
    const response = await read()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ entries: [] })
  })

  it('keeps what was written, separators and all', async () => {
    const entries = [
      { kind: 'item', key: 'messages' },
      { kind: 'separator', id: 'sep-1', label: 'Docència' },
      { kind: 'item', key: 'planning' },
    ]

    expect((await write(entries)).statusCode).toBe(200)
    expect((await read()).json()).toEqual({ entries })
  })

  it('is one person’s, not the center’s', async () => {
    await write([{ kind: 'item', key: 'messages' }])

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/me/menu',
      headers: { 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId },
    })

    expect(other.json()).toEqual({ entries: [] })
  })

  it('refuses a separator with no id, which nothing could address', async () => {
    const response = await write([{ kind: 'separator', label: 'Docència' }])

    expect(response.statusCode).toBe(422)
  })

  it('refuses a label long enough to break the column it sits in', async () => {
    const response = await write([{ kind: 'separator', id: 'sep-1', label: 'x'.repeat(200) }])

    expect(response.statusCode).toBe(422)
  })

  it('falls back to the product’s order when the stored layout cannot be read', async () => {
    // Written by an older version, or by hand. Answering with an error would
    // leave somebody with no menu and no way to fix it from the interface.
    await prisma.user.update({
      where: { id: userId },
      data: { menuLayoutJson: { nonsense: true } },
    })

    const response = await read()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ entries: [] })
  })

  it('grants nothing: naming a screen does not open it', async () => {
    // The menu is a list of what to draw. What may be reached is decided by
    // the roles, on every request, whatever this says.
    await write([{ kind: 'item', key: 'platform' }])

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/locales',
      headers: headers(),
    })

    expect(forbidden.statusCode).toBe(403)
  })
})
