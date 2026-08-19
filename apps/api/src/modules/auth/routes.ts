import {
  SESSION_COOKIE,
  type SessionUser,
  entraSessionRequestSchema,
  localLoginRequestSchema,
  localPasswordChangeSchema,
} from '@uacademic/shared'
import type { CookieSerializeOptions } from '@fastify/cookie'
import type { FastifyInstance } from 'fastify'

import { acceptedAudiences, entraConfigured, type Env } from '../../config/env.js'
import { writeAuditLog } from '../../lib/audit.js'
import { getEntraVerifier } from '../../lib/entra.js'
import { AppError } from '../../lib/errors.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import {
  createSession,
  loadRegisteredTenants,
  localLogin,
  resolveEntraUser,
  revokeAllUserSessions,
  revokeSession,
} from '../../services/auth-service.js'
import { buildSessionUser, requireUser } from '../../plugins/context.js'

export function registerAuthRoutes(app: FastifyInstance, env: Env): void {
  const cookieOptions = (maxAgeSeconds: number): CookieSerializeOptions => ({
    httpOnly: true,
    // Lax, not Strict: the browser comes back from the Microsoft redirect and
    // must still carry the cookie. Not None — that would allow cross-site use.
    sameSite: 'lax' as const,
    secure: env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === 'production',
    signed: true,
    path: '/',
    maxAge: maxAgeSeconds,
  })

  /**
   * Exchanges a Microsoft access token (obtained by MSAL with PKCE in the
   * browser) for a server session. The token itself never touches the browser
   * storage we rely on afterwards: from here on the cookie is the credential.
   */
  /**
   * What the browser needs to know before anybody can sign in.
   *
   * Served rather than baked. The client id used to reach the bundle through
   * `VITE_UACADEMIC_ENTRA_CLIENT_ID` at build time, so an operator who
   * registered the application and put the id in `shared/.env` — the only file
   * the deployment manual ever tells them about — got a sign-in button that
   * stayed disabled and no way to find out why. Nothing here is secret: the
   * client id is public by design in a PKCE flow, and the authority is the
   * address of Microsoft.
   */
  app.get('/api/v1/auth/config', { config: { public: true } }, async () => ({
    mode: env.AUTH_MODE,
    entra: entraConfigured(env)
      ? {
          clientId: env.ENTRA_CLIENT_ID,
          authority: `https://login.microsoftonline.com/${env.ENTRA_AUTHORITY_TENANT}`,
        }
      : null,
  }))

  app.post(
    '/api/v1/auth/entra/session',
    { config: { public: true } },
    async (request, reply): Promise<SessionUser> => {
      // A fresh installation runs on the break-glass credential until an Entra
      // application is registered. Saying so beats a JWKS error nobody can act
      // on.
      if (!entraConfigured(env)) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'auth.errors.entraNotConfigured')
      }

      const body = parseWith(entraSessionRequestSchema, request.body)
      const client = prisma()

      const verifier = getEntraVerifier({
        jwksUri: env.ENTRA_JWKS_URI,
        audiences: acceptedAudiences(env),
      })

      const tenants = await loadRegisteredTenants(client)
      const identity = await verifier.verify(body.accessToken, tenants)

      const user = await resolveEntraUser(client, identity, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      })

      const session = await createSession(client, {
        userId: user.id,
        method: 'entra',
        entraTid: identity.tenantId,
        ttlHours: env.SESSION_TTL_HOURS,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      })

      void reply.setCookie(SESSION_COOKIE, session.id, cookieOptions(env.SESSION_TTL_HOURS * 3600))

      await writeAuditLog(client, {
        centerId: null,
        userId: user.id,
        entity: 'auth',
        entityId: session.id,
        action: 'sign_in',
        after: { method: 'entra', tenantId: identity.tenantId },
        source: 'user',
        ip: request.ip,
      })

      return buildSessionUser(user.id, 'entra', session.expiresAt, {
        objectId: identity.objectId,
        tenantId: identity.tenantId,
        username: identity.email,
      })
    },
  )

  /** Break-glass path for the platform superadmin. Never for anyone else. */
  app.post(
    '/api/v1/auth/local/session',
    { config: { public: true } },
    async (request, reply): Promise<SessionUser> => {
      const body = parseWith(localLoginRequestSchema, request.body)
      const client = prisma()

      const user = await localLogin(
        client,
        { ...body, encryptionKey: env.APP_ENCRYPTION_KEY },
        { userAgent: request.headers['user-agent'], ip: request.ip },
      )

      const session = await createSession(client, {
        userId: user.id,
        method: 'local',
        ttlHours: env.SESSION_TTL_HOURS,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      })

      void reply.setCookie(SESSION_COOKIE, session.id, cookieOptions(env.SESSION_TTL_HOURS * 3600))

      await writeAuditLog(client, {
        centerId: null,
        userId: user.id,
        entity: 'auth',
        entityId: session.id,
        action: 'sign_in',
        after: { method: 'local' },
        source: 'user',
        ip: request.ip,
      })

      return buildSessionUser(user.id, 'local', session.expiresAt, null)
    },
  )

  /** The session as the client should see it, including the linked account. */
  app.get('/api/v1/auth/session', async (request): Promise<SessionUser> => {
    const user = requireUser(request)
    if (!request.session) throw AppError.unauthorized()

    return buildSessionUser(
      user.userId,
      request.session.method,
      request.session.expiresAt,
      request.microsoftAccount ?? null,
    )
  })

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const client = prisma()
    if (request.session) {
      await revokeSession(client, request.session.id)
      await writeAuditLog(client, {
        centerId: null,
        userId: request.user?.userId ?? null,
        entity: 'auth',
        entityId: request.session.id,
        action: 'sign_out',
        source: 'user',
        ip: request.ip,
      })
    }

    void reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  /**
   * Password change for the local superadmin only. SSO users have no password
   * here by design — their organization owns it.
   */
  app.post('/api/v1/auth/local/password', async (request) => {
    const user = requireUser(request)
    const body = parseWith(localPasswordChangeSchema, request.body)
    const client = prisma()

    const credential = await client.localCredential.findUnique({ where: { userId: user.userId } })
    if (!credential) throw new AppError(403, 'FORBIDDEN', 'auth.errors.localNotAvailable')

    if (!(await verifyPassword(body.currentPassword, credential.passwordHash))) {
      throw new AppError(401, 'UNAUTHORIZED', 'auth.errors.invalidCredentials')
    }

    await client.localCredential.update({
      where: { id: credential.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
    })

    // Changing a password ends every other session; the current one survives.
    const revoked = await revokeAllUserSessions(client, user.userId, request.session?.id)

    await writeAuditLog(client, {
      centerId: null,
      userId: user.userId,
      entity: 'auth',
      entityId: credential.id,
      action: 'password_changed',
      after: { revokedSessions: revoked },
      source: 'user',
      ip: request.ip,
    })

    return { ok: true, revokedSessions: revoked }
  })
}
