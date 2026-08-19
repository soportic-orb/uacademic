/**
 * The bridge between an account being created and its owner being able to use
 * it. Everything here is reachable without a session — that is the point — so
 * each guard matters: a link is good once, for a week, and for one account.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { SESSION_COOKIE } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { issueInvitation } from '../src/services/invitations.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

const PASSWORD = 'Invitacio-2026-uab'

describe.skipIf(!hasDatabase)('accepting an invitation', () => {
  let app: FastifyInstance
  const prisma = getPrismaClient()

  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'entra',
        UACADEMIC_ENTRA_CLIENT_ID: 'test-client',
        UACADEMIC_APP_ENCRYPTION_KEY: 'a'.repeat(64),
        UACADEMIC_SESSION_COOKIE_SECRET: 'test-session-secret-that-is-long-enough',
      }),
    })
  })

  async function invitedUser() {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: SEED.otherTeacherEmail } })
    await prisma.userInvitation.deleteMany({ where: { userId: user.id } })
    await prisma.localCredential.deleteMany({ where: { userId: user.id } })
    await prisma.user.update({ where: { id: user.id }, data: { status: 'invited' } })
    return user
  }

  beforeEach(async () => {
    await invitedUser()
  })

  afterAll(async () => {
    // The seeded lecturer is left as the rest of the suite expects to find them.
    const user = await prisma.user.findUnique({ where: { email: SEED.otherTeacherEmail } })
    if (user) {
      await prisma.userInvitation.deleteMany({ where: { userId: user.id } })
      await prisma.localCredential.deleteMany({ where: { userId: user.id } })
      await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
    }

    await app.close()
    await disconnectPrisma()
  })

  const accept = (token: string, password = PASSWORD) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/auth/invitation/${token}`,
      payload: { password, confirmPassword: password },
    })

  it('shows who the link is for, so the person knows it is theirs', async () => {
    const user = await invitedUser()
    const { token } = await issueInvitation(prisma, user.id)

    const response = await app.inject({ method: 'GET', url: `/api/v1/auth/invitation/${token}` })

    expect(response.statusCode).toBe(200)
    expect(response.json().email).toBe(SEED.otherTeacherEmail)
    expect(response.json().centerName).toBeTruthy()
  })

  it('sets the password, opens the account and signs the person in', async () => {
    const user = await invitedUser()
    const { token } = await issueInvitation(prisma, user.id)

    const response = await accept(token)

    expect(response.statusCode).toBe(200)
    expect(response.json().email).toBe(SEED.otherTeacherEmail)
    expect(response.cookies.some((cookie) => cookie.name === SESSION_COOKIE)).toBe(true)

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.status).toBe('active')

    // And the password works on the ordinary sign-in screen.
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/local/session',
      payload: { email: SEED.otherTeacherEmail, password: PASSWORD },
    })
    expect(signedIn.statusCode).toBe(200)
  })

  it('refuses a password nobody could remember having typed twice', async () => {
    const user = await invitedUser()
    const { token } = await issueInvitation(prisma, user.id)

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/invitation/${token}`,
      payload: { password: PASSWORD, confirmPassword: `${PASSWORD}x` },
    })

    expect(response.statusCode).toBe(422)
    const credential = await prisma.localCredential.findUnique({ where: { userId: user.id } })
    expect(credential).toBeNull()
  })

  it('refuses a weak password and leaves the invitation usable', async () => {
    const user = await invitedUser()
    const { token } = await issueInvitation(prisma, user.id)

    expect((await accept(token, 'curta1')).statusCode).toBe(422)

    // Still good: a rejected attempt must not cost somebody their only link.
    expect((await accept(token)).statusCode).toBe(200)
  })

  it('spends the link: the second use of the same one is refused', async () => {
    const user = await invitedUser()
    const { token } = await issueInvitation(prisma, user.id)

    expect((await accept(token)).statusCode).toBe(200)

    const again = await accept(token, 'Segona-vegada-2026')
    expect(again.statusCode).toBe(404)
    expect(again.json().error.messageKey).toBe('auth.errors.invitationInvalid')
  })

  it('retires the previous link when a new invitation is sent', async () => {
    const user = await invitedUser()
    const { token: first } = await issueInvitation(prisma, user.id)
    const { token: second } = await issueInvitation(prisma, user.id)

    const stale = await app.inject({ method: 'GET', url: `/api/v1/auth/invitation/${first}` })
    expect(stale.statusCode).toBe(404)

    expect((await accept(second)).statusCode).toBe(200)
  })

  it('says an expired link expired, which is something a person can act on', async () => {
    const user = await invitedUser()
    const { token } = await issueInvitation(prisma, user.id)
    await prisma.userInvitation.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const response = await app.inject({ method: 'GET', url: `/api/v1/auth/invitation/${token}` })

    expect(response.statusCode).toBe(410)
    expect(response.json().error.messageKey).toBe('auth.errors.invitationExpired')
  })

  /**
   * The link in the email is the whole feature: an invitation that pointed at
   * the site root — which is what it used to do — left the person facing a
   * sign-in screen and no password to type into it.
   */
  it('puts a working link in the invitation the administrator sends', async () => {
    const user = await invitedUser()

    // Through the admin route, which means signing in as one: the app above is
    // built against Entra, so this one turn is taken in an app that is not.
    const asAdmin = await createTestApp()
    const invited = await asAdmin.inject({
      method: 'POST',
      url: `/api/v1/users/${user.id}/invite`,
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': await seedCenterId() },
    })
    await asAdmin.close()
    expect(invited.statusCode).toBe(200)

    const job = await prisma.job.findFirst({
      where: { type: 'user.invite' },
      orderBy: { createdAt: 'desc' },
    })
    const url = String((job?.payloadJson as { url?: string } | null)?.url ?? '')
    expect(url).toContain('/activate?token=')

    const token = new URL(url).searchParams.get('token') ?? ''
    const summary = await app.inject({ method: 'GET', url: `/api/v1/auth/invitation/${token}` })
    expect(summary.statusCode).toBe(200)
    expect(summary.json().email).toBe(SEED.otherTeacherEmail)
  })

  it('tells a guessed token nothing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/invitation/${'f'.repeat(64)}`,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.messageKey).toBe('auth.errors.invitationInvalid')
  })

  it('keeps only the hash of the token, never the token', async () => {
    const user = await invitedUser()
    const { token } = await issueInvitation(prisma, user.id)

    const rows = await prisma.userInvitation.findMany({ where: { userId: user.id } })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenHash).not.toBe(token)
    expect(rows[0]?.tokenHash).toHaveLength(64)
  })
})
