/**
 * Which columns of a listing somebody has put away.
 *
 * On the account rather than in the browser, for the same reason the menu
 * order is: it is a thing a person arranged, and re-arranging it because they
 * opened the screen on another machine is losing their work. It carries no
 * permission — what a listing contains is decided on every request (R3) — so
 * this is theirs to write with no further check.
 */
import { Prisma, disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('the columns somebody keeps', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let userId: string

  const headers = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  const read = () => app.inject({ method: 'GET', url: '/api/v1/me/tables', headers: headers() })

  const write = (table: string, hidden: string[]) =>
    app.inject({
      method: 'PUT',
      url: `/api/v1/me/tables/${table}`,
      headers: headers(),
      payload: { hidden },
    })

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
    await prisma.user.update({
      where: { id: userId },
      data: { tableLayoutJson: Prisma.DbNull },
    })
  })

  it('starts with every column, because nobody has hidden any', async () => {
    expect((await read()).json()).toEqual({ tables: {} })
  })

  it('remembers what was put away, per listing', async () => {
    await write('audit', ['source', 'user'])
    await write('subjects', ['ects'])

    expect((await read()).json().tables).toEqual({
      audit: { hidden: ['source', 'user'] },
      subjects: { hidden: ['ects'] },
    })
  })

  it('leaves the other listings alone when one is arranged', async () => {
    await write('audit', ['source'])
    await write('audit', [])

    const tables = (await read()).json().tables as Record<string, { hidden: string[] }>
    // Emptied, not forgotten: showing everything again is a choice too.
    expect(tables.audit).toEqual({ hidden: [] })
  })

  it('refuses something that is not a list of column names', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/tables/audit',
      headers: headers(),
      payload: { hidden: 'source' },
    })

    expect(response.statusCode).toBe(422)
  })

  it('shows every column again when what was stored cannot be read', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { tableLayoutJson: { nonsense: true } },
    })

    // A listing nobody can fix from the interface is worse than a listing
    // that forgot an arrangement.
    expect((await read()).json()).toEqual({ tables: {} })
  })

  it('is one person’s arrangement, not everybody’s', async () => {
    await write('audit', ['source'])

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/me/tables',
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
    })

    expect(other.json().tables.audit).toBeUndefined()
  })
})
