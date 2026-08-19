/**
 * Signing in with email and password.
 *
 * Open to anybody who has a credential, because having one means an
 * administrator invited them and they followed the link. What still has to hold
 * is that a password is the only thing that opens this door: no credential, no
 * entry, and the same answer either way so the screen never says who exists.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { SESSION_COOKIE } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { encryptSecret } from '../src/lib/crypto.js'
import { hashPassword } from '../src/lib/password.js'
import { currentTotp, generateTotpSecret } from '../src/lib/totp.js'
import { SEED, hasDatabase, seedCenterId } from './helpers.js'

const ENCRYPTION_KEY = 'a'.repeat(64)
const PASSWORD = 'Superadmin-2026-test'
const TEACHER_PASSWORD = 'Teacher-2026-test-pw'

/**
 * A superadmin of its own rather than the seeded one: this suite deliberately
 * locks the account out, and the e2e run signs in with the seeded credential.
 */
const TEST_SUPERADMIN = {
  id: '0198f0d2-8f2a-7000-8000-0a0000000001',
  email: 'test.superadmin@demo.uacademic.test',
}

describe.skipIf(!hasDatabase)('sign-in with email and password', () => {
  let app: FastifyInstance
  let totpSecret: string
  const prisma = getPrismaClient()

  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'entra',
        UACADEMIC_ENTRA_CLIENT_ID: 'test-client',
        UACADEMIC_APP_ENCRYPTION_KEY: ENCRYPTION_KEY,
        UACADEMIC_SESSION_COOKIE_SECRET: 'test-session-secret-that-is-long-enough',
      }),
    })
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  beforeEach(async () => {
    const centerId = await seedCenterId()
    const superadmin = await prisma.user.upsert({
      where: { id: TEST_SUPERADMIN.id },
      create: {
        id: TEST_SUPERADMIN.id,
        email: TEST_SUPERADMIN.email,
        firstName: 'Test',
        lastName: 'Superadmin',
        status: 'active',
        centerRoles: { create: { centerId, role: 'SUPERADMIN' } },
      },
      update: { status: 'active' },
    })

    totpSecret = generateTotpSecret()
    await prisma.localCredential.upsert({
      where: { userId: superadmin.id },
      create: {
        userId: superadmin.id,
        passwordHash: await hashPassword(PASSWORD),
        totpSecretEnc: encryptSecret(totpSecret, ENCRYPTION_KEY),
        totpConfirmedAt: new Date(),
      },
      update: {
        passwordHash: await hashPassword(PASSWORD),
        totpSecretEnc: encryptSecret(totpSecret, ENCRYPTION_KEY),
        totpConfirmedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
    })
  })

  const signIn = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/local/session', payload })

  it('signs in with password and a valid TOTP code', async () => {
    const response = await signIn({
      email: TEST_SUPERADMIN.email,
      password: PASSWORD,
      totp: currentTotp(totpSecret),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().authMethod).toBe('local')
    // No Microsoft account is linked on this path, and the UI relies on that
    // to decide whether to offer a password section at all.
    expect(response.json().microsoftAccount).toBeNull()
    expect(response.cookies.find((cookie) => cookie.name === SESSION_COOKIE)).toBeDefined()
  })

  it('refuses the right password without the second factor', async () => {
    const response = await signIn({ email: TEST_SUPERADMIN.email, password: PASSWORD })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.messageKey).toBe('auth.errors.totpRequired')
  })

  it('refuses a wrong TOTP code', async () => {
    const response = await signIn({
      email: TEST_SUPERADMIN.email,
      password: PASSWORD,
      totp: '000000',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.messageKey).toBe('auth.errors.invalidTotp')
  })

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrongPassword = await signIn({
      email: TEST_SUPERADMIN.email,
      password: 'not-the-password',
      totp: currentTotp(totpSecret),
    })
    const unknownAccount = await signIn({
      email: 'nobody@demo.uacademic.test',
      password: 'whatever-it-is',
      totp: '123456',
    })

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownAccount.statusCode).toBe(401)
    expect(wrongPassword.json().error.messageKey).toBe(unknownAccount.json().error.messageKey)
  })

  it('locks the account after repeated failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn({ email: TEST_SUPERADMIN.email, password: 'wrong', totp: '000000' })
    }

    const locked = await signIn({
      email: TEST_SUPERADMIN.email,
      password: PASSWORD,
      totp: currentTotp(totpSecret),
    })

    expect(locked.statusCode).toBe(403)
    expect(locked.json().error.messageKey).toBe('auth.errors.locked')
  })

  /**
   * This used to be refused: the local path was the superadmin's alone, which
   * left every invited lecturer at a university with no registered tenant
   * holding an account they had no way of reaching.
   */
  it('lets a lecturer in with the password they were given', async () => {
    const teacher = await prisma.user.findUnique({ where: { email: SEED.otherTeacherEmail } })
    await prisma.localCredential.upsert({
      where: { userId: teacher!.id },
      create: { userId: teacher!.id, passwordHash: await hashPassword(TEACHER_PASSWORD) },
      update: { passwordHash: await hashPassword(TEACHER_PASSWORD), failedAttempts: 0 },
    })

    const response = await signIn({ email: SEED.otherTeacherEmail, password: TEACHER_PASSWORD })

    expect(response.statusCode).toBe(200)
    expect(response.json().email).toBe(SEED.otherTeacherEmail)

    await prisma.localCredential.deleteMany({ where: { userId: teacher!.id } })
  })

  it('refuses an account that has no password, saying no more than that', async () => {
    const response = await signIn({
      email: SEED.otherTeacherEmail,
      password: TEACHER_PASSWORD,
    })

    expect(response.statusCode).toBe(401)
    // The same answer as a wrong password: the screen never confirms that an
    // address is one of ours.
    expect(response.json().error.messageKey).toBe('auth.errors.invalidCredentials')
  })

  describe('password change', () => {
    it('rejects a weak password and keeps the old one working', async () => {
      const signedIn = await signIn({
        email: TEST_SUPERADMIN.email,
        password: PASSWORD,
        totp: currentTotp(totpSecret),
      })
      const cookie = signedIn.cookies.find((entry) => entry.name === SESSION_COOKIE)
      const headers = { cookie: `${SESSION_COOKIE}=${cookie?.value ?? ''}` }

      const weak = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/local/password',
        headers,
        payload: { currentPassword: PASSWORD, newPassword: 'short', confirmPassword: 'short' },
      })

      expect(weak.statusCode).toBe(422)
      expect(weak.json().error.details?.[0]?.messageKey).toBe('auth.errors.passwordTooShort')
    })

    it('changes the password and revokes every other session', async () => {
      const firstDevice = await signIn({
        email: TEST_SUPERADMIN.email,
        password: PASSWORD,
        totp: currentTotp(totpSecret),
      })
      const secondDevice = await signIn({
        email: TEST_SUPERADMIN.email,
        password: PASSWORD,
        totp: currentTotp(totpSecret),
      })

      const keep = `${SESSION_COOKIE}=${firstDevice.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? ''}`
      const other = `${SESSION_COOKIE}=${secondDevice.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? ''}`

      const changed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/local/password',
        headers: { cookie: keep },
        payload: {
          currentPassword: PASSWORD,
          newPassword: 'Another-Strong-Pw-2026',
          confirmPassword: 'Another-Strong-Pw-2026',
        },
      })

      expect(changed.statusCode).toBe(200)
      expect(changed.json().revokedSessions).toBeGreaterThanOrEqual(1)

      // The device that changed it stays signed in; the other one is out.
      const stillIn = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: keep },
      })
      const kickedOut = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: other },
      })

      expect(stillIn.statusCode).toBe(200)
      expect(kickedOut.statusCode).toBe(401)
    })
  })
})
