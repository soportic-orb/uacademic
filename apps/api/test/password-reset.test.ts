/**
 * Getting back into an account.
 *
 * The whole endpoint is reachable without a session, so the thing it must not
 * do is tell anybody which addresses have accounts — an endpoint that answers
 * differently for a real one is an endpoint that lists them all to whoever is
 * patient enough to ask.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { SEED, hasDatabase } from './helpers.js'

describe.skipIf(!hasDatabase)('asking for a new password', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'local',
        UACADEMIC_SESSION_COOKIE_SECRET: 'test-session-secret-that-is-long-enough',
      }),
    })
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { type: 'user.passwordReset' } })
  })

  const ask = (email: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/password-reset', payload: { email } })

  it('sends a link to an address that has an account', async () => {
    const response = await ask(SEED.teacherEmail)

    expect(response.statusCode).toBe(202)
    const job = await prisma.job.findFirst({ where: { type: 'user.passwordReset' } })
    const url = String((job?.payloadJson as { url?: string } | null)?.url ?? '')
    expect(url).toContain('/activate?token=')
  })

  it('answers a stranger exactly the same, and queues nothing', async () => {
    const response = await ask('ningu@enlloc.test')

    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ requested: true })
    expect(await prisma.job.count({ where: { type: 'user.passwordReset' } })).toBe(0)
  })

  it('lets the link set a password that then works', async () => {
    await ask(SEED.teacherEmail)
    const job = await prisma.job.findFirstOrThrow({ where: { type: 'user.passwordReset' } })
    const url = new URL(String((job.payloadJson as { url: string }).url))
    const token = url.searchParams.get('token') ?? ''

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invitation/${token}`,
      payload: { password: 'Recuperada-2026', confirmPassword: 'Recuperada-2026' },
    })
    expect(accepted.statusCode).toBe(200)

    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/local/session',
      payload: { email: SEED.teacherEmail, password: 'Recuperada-2026' },
    })
    expect(signedIn.statusCode).toBe(200)

    await prisma.localCredential.deleteMany({
      where: { user: { email: SEED.teacherEmail } },
    })
  })

  it('gives the link a short fuse, not the invitation’s week', async () => {
    await ask(SEED.teacherEmail)

    const user = await prisma.user.findUniqueOrThrow({ where: { email: SEED.teacherEmail } })
    const invitation = await prisma.userInvitation.findFirstOrThrow({
      where: { userId: user.id, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })

    const hours = (invitation.expiresAt.getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(1)
    expect(hours).toBeLessThan(3)
  })

  it('will not resurrect a suspended account', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: SEED.teacherEmail } })
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } })

    const response = await ask(SEED.teacherEmail)

    expect(response.statusCode).toBe(202)
    expect(await prisma.job.count({ where: { type: 'user.passwordReset' } })).toBe(0)

    await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
  })
})
