/**
 * R3, end to end: real RS256 tokens, a real JWKS fetch and the real route.
 *
 * The trick that makes this testable without Microsoft: the verifier takes its
 * JWKS URI from configuration, so the suite generates a key pair, serves the
 * public half over localhost and mints tokens with whatever claims it wants —
 * including the ones an attacker would send.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { SESSION_COOKIE } from '@uacademic/shared'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { CryptoKey } from 'jose'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { resetEntraVerifier } from '../src/lib/entra.js'
import { hasDatabase } from './helpers.js'

const CLIENT_ID = '00000000-1111-2222-3333-444444444444'
const OUR_TENANT = '11111111-2222-3333-4444-555555555555'
const FOREIGN_TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const KID = 'test-signing-key'

let privateKey: CryptoKey
let jwksServer: Server
let jwksUri: string

async function startJwksServer(): Promise<void> {
  const { publicKey, privateKey: generated } = await generateKeyPair('RS256', { extractable: true })
  privateKey = generated

  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }

  jwksServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ keys: [jwk] }))
  })

  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve))
  const address = jwksServer.address() as AddressInfo
  jwksUri = `http://127.0.0.1:${address.port}/keys`
}

interface TokenOverrides {
  tid?: string
  iss?: string
  aud?: string
  oid?: string
  email?: string
  name?: string
  expiresIn?: string
}

async function mintToken(overrides: TokenOverrides = {}): Promise<string> {
  const tid = overrides.tid ?? OUR_TENANT

  return new SignJWT({
    tid,
    oid: overrides.oid ?? 'ffffffff-0000-0000-0000-000000000001',
    preferred_username: overrides.email ?? 'marta.puig@demo.uacademic.test',
    name: overrides.name ?? 'Marta Puig Serra',
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(overrides.iss ?? `https://login.microsoftonline.com/${tid}/v2.0`)
    .setAudience(overrides.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '10m')
    .sign(privateKey)
}

describe.skipIf(!hasDatabase)('Entra ID sign-in', () => {
  let app: FastifyInstance
  const prisma = getPrismaClient()

  beforeAll(async () => {
    await startJwksServer()
    resetEntraVerifier()

    app = await buildApp({
      env: loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'entra',
        UACADEMIC_ENTRA_JWKS_URI: jwksUri,
        UACADEMIC_ENTRA_CLIENT_ID: CLIENT_ID,
        UACADEMIC_SESSION_COOKIE_SECRET: 'test-session-secret-that-is-long-enough',
      }),
    })

    // The demo tenant is registered by the seed; the foreign one never is.
    await prisma.entraTenant.upsert({
      where: { tenantId: OUR_TENANT },
      create: { tenantId: OUR_TENANT, displayName: 'Demo tenant', status: 'active' },
      update: { status: 'active' },
    })
  })

  afterAll(async () => {
    await app.close()
    jwksServer.close()
    resetEntraVerifier()
    await disconnectPrisma()
  })

  async function signIn(token: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/entra/session',
      payload: { accessToken: token },
    })
  }

  it('accepts a token from a registered tenant and opens a session', async () => {
    const response = await signIn(await mintToken())

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.email).toBe('marta.puig@demo.uacademic.test')
    expect(body.authMethod).toBe('entra')
    expect(body.microsoftAccount.tenantId).toBe(OUR_TENANT)
    // Roles come from the database, never from the token.
    expect(body.memberships.map((m: { role: string }) => m.role).sort()).toEqual([
      'COORDINATOR',
      'TEACHER',
    ])

    const cookie = response.cookies.find((entry) => entry.name === SESSION_COOKIE)
    expect(cookie).toBeDefined()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax')
  })

  it('refuses a perfectly valid token from an organization we never registered', async () => {
    const response = await signIn(await mintToken({ tid: FOREIGN_TENANT }))

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('UNKNOWN_TENANT')
    expect(response.json().error.messageKey).toBe('auth.errors.tenantNotAuthorized')
  })

  it('refuses a token whose issuer does not match its tenant', async () => {
    const response = await signIn(
      await mintToken({ iss: `https://login.microsoftonline.com/${FOREIGN_TENANT}/v2.0` }),
    )

    expect(response.statusCode).toBe(403)
    expect(response.json().error.details?.[0]?.messageKey).toBe('auth.errors.issuer_mismatch')
  })

  it('refuses a token minted for another application', async () => {
    const response = await signIn(await mintToken({ aud: 'some-other-client-id' }))

    expect(response.statusCode).toBe(401)
    expect(response.json().error.messageKey).toBe('auth.errors.tokenInvalid')
  })

  it('refuses an expired token', async () => {
    const response = await signIn(await mintToken({ expiresIn: '-1m' }))
    expect(response.statusCode).toBe(401)
  })

  it('refuses a token signed by a key that is not in the JWKS', async () => {
    const { privateKey: rogue } = await generateKeyPair('RS256', { extractable: true })
    const forged = await new SignJWT({ tid: OUR_TENANT, oid: 'x' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(`https://login.microsoftonline.com/${OUR_TENANT}/v2.0`)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(rogue)

    expect((await signIn(forged)).statusCode).toBe(401)
  })

  it('refuses a token with no oid: the email is not a stable identity', async () => {
    const token = await new SignJWT({ tid: OUR_TENANT, preferred_username: 'x@demo.test' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(`https://login.microsoftonline.com/${OUR_TENANT}/v2.0`)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey)

    expect((await signIn(token)).statusCode).toBe(401)
  })

  it('carries the session in an httpOnly cookie and revokes it on logout', async () => {
    const signedIn = await signIn(await mintToken())
    const cookie = signedIn.cookies.find((entry) => entry.name === SESSION_COOKIE)
    const header = { cookie: `${SESSION_COOKIE}=${cookie?.value ?? ''}` }

    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: header,
    })
    expect(session.statusCode).toBe(200)
    expect(session.json().microsoftAccount.objectId).toBeDefined()

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: header,
    })
    expect(loggedOut.statusCode).toBe(200)

    // The cookie is now worthless: sessions live server-side for this reason.
    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: header })
    expect(after.statusCode).toBe(401)
  })

  it('rejects a tampered session cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `${SESSION_COOKIE}=not-a-signed-value` },
    })

    expect(response.statusCode).toBe(401)
  })

  describe('just-in-time provisioning', () => {
    // A fresh address per run: the account this creates gets audit entries,
    // and audit rows are never deleted (R4), so the user cannot be cleaned up.
    const NEWCOMER = `nova.professora.${process.pid}@demo.uacademic.test`
    const NEWCOMER_OID = `ffffffff-0000-0000-0000-${String(process.pid).padStart(12, '0').slice(-12)}`

    beforeAll(async () => {
      const center = await prisma.center.findFirst({ where: { code: 'FEC' } })
      if (!center) throw new Error('demo center missing')

      const settings = (center.settingsJson ?? {}) as Record<string, unknown>
      await prisma.center.update({
        where: { id: center.id },
        data: {
          settingsJson: {
            ...settings,
            identity: {
              jitProvisioning: true,
              allowedEmailDomains: ['demo.uacademic.test'],
              defaultRole: 'TEACHER',
              requireActivation: true,
            },
          },
        },
      })
    })

    it('creates the account but keeps it out until someone activates it', async () => {
      const response = await signIn(
        await mintToken({ oid: NEWCOMER_OID, email: NEWCOMER, name: 'Nova Professora' }),
      )

      expect(response.statusCode).toBe(403)
      expect(response.json().error.messageKey).toBe('auth.errors.pendingActivation')

      const created = await prisma.user.findUnique({ where: { email: NEWCOMER } })
      expect(created?.status).toBe('pending_activation')
      expect(created?.entraOid).toBe(NEWCOMER_OID)

      // The provisioning itself is audited: it created a user nobody asked for.
      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'user', entityId: created?.id, action: 'jit_provision' },
      })
      expect(audit?.source).toBe('system')
    })

    it('lets the account in once it has been activated', async () => {
      const user = await prisma.user.findUnique({ where: { email: NEWCOMER } })
      await prisma.user.update({ where: { id: user!.id }, data: { status: 'active' } })

      const response = await signIn(await mintToken({ oid: NEWCOMER_OID, email: NEWCOMER }))

      expect(response.statusCode).toBe(200)
      expect(response.json().memberships).toEqual([expect.objectContaining({ role: 'TEACHER' })])
    })

    it('does not provision for a domain outside the policy', async () => {
      const response = await signIn(
        await mintToken({
          oid: 'ffffffff-0000-0000-0000-000000000098',
          email: 'outsider@gmail.com',
        }),
      )

      expect(response.statusCode).toBe(403)
      expect(await prisma.user.findUnique({ where: { email: 'outsider@gmail.com' } })).toBeNull()
    })
  })
})
