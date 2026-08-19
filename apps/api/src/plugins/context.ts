import type { AppLocale, Principal, Role, SessionUser } from '@uacademic/shared'
import {
  CENTER_HEADER,
  CROSS_CENTER_HEADER,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  SESSION_COOKIE,
  canAccessCenter,
  isSuperadmin,
  parseAcceptLanguage,
  resolveLocale,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { Env } from '../config/env.js'
import { writeAuditLog } from '../lib/audit.js'
import { AppError } from '../lib/errors.js'
import { type ScopedPrismaClient, prisma, scopedPrisma } from '../lib/prisma.js'
import { type ActiveSession, loadSession } from '../services/auth-service.js'
import { isWebAppRequest, webDistPath } from './web-app.js'

export interface RequestUser extends Principal {
  email: string
  firstName: string
  lastName: string
  locale: AppLocale
  theme: 'light' | 'dark' | 'system'
  avatarUrl: string | null
  status: 'active' | 'invited' | 'pending_activation' | 'suspended'
  entraOid: string | null
  centerNames: Map<string, { name: string; code: string; timezone: string }>
}

export interface MicrosoftAccount {
  objectId: string
  tenantId: string
  username: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser
    session?: ActiveSession
    microsoftAccount?: MicrosoftAccount | null
    locale: AppLocale
    centerId?: string
    crossCenter: boolean
  }
  interface FastifyContextConfig {
    /** Routes that must answer without an identity (health, sign-in). */
    public?: boolean
    /** Roles allowed on this route, checked against the active center. */
    roles?: readonly Role[]
    /** Routes only the platform superadmin may reach, in any center. */
    superadminOnly?: boolean
  }
}

export async function loadUserById(userId: string): Promise<RequestUser | null> {
  return hydrate(await findUser({ id: userId }))
}

export async function loadUserByEmail(email: string): Promise<RequestUser | null> {
  return hydrate(await findUser({ email }))
}

function findUser(where: { id: string } | { email: string }) {
  return prisma().user.findUnique({
    where: where as { id: string },
    include: {
      centerRoles: {
        include: { center: { select: { id: true, name: true, code: true, timezone: true } } },
      },
    },
  })
}

type UserRow = Awaited<ReturnType<typeof findUser>>

function hydrate(user: UserRow): RequestUser | null {
  if (!user) return null

  const centerNames = new Map<string, { name: string; code: string; timezone: string }>()
  for (const membership of user.centerRoles) {
    centerNames.set(membership.centerId, {
      name: membership.center.name,
      code: membership.center.code,
      timezone: membership.center.timezone,
    })
  }

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: (user.locale ?? DEFAULT_LOCALE) as AppLocale,
    theme: user.theme,
    avatarUrl: user.avatarUrl,
    status: user.status,
    entraOid: user.entraOid,
    memberships: user.centerRoles.map((membership) => ({
      centerId: membership.centerId,
      role: membership.role as Role,
    })),
    centerNames,
  }
}

export function requireUser(request: FastifyRequest): RequestUser {
  if (!request.user) throw AppError.unauthorized()
  return request.user
}

/** Routes that touch business data must go through this — never `prisma()`. */
export function requireCenterScope(request: FastifyRequest): {
  centerId: string
  db: ScopedPrismaClient
} {
  const user = requireUser(request)
  if (!request.centerId) throw AppError.tenantRequired()
  if (!canAccessCenter(user, request.centerId) && !request.crossCenter) {
    throw AppError.tenantMismatch()
  }
  return { centerId: request.centerId, db: scopedPrisma(prisma(), request.centerId) }
}

/** The session payload the client receives; roles always come from the DB (R3). */
export async function buildSessionUser(
  userId: string,
  method: 'entra' | 'local',
  expiresAt: Date,
  microsoftAccount: MicrosoftAccount | null,
): Promise<SessionUser> {
  const user = await loadUserById(userId)
  if (!user) throw AppError.unauthorized()

  return {
    id: user.userId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: user.locale,
    theme: user.theme,
    avatarUrl: user.avatarUrl,
    status: user.status,
    authMethod: method,
    microsoftAccount,
    memberships: user.memberships.map((membership) => ({
      centerId: membership.centerId,
      centerName: user.centerNames.get(membership.centerId)?.name ?? '',
      centerCode: user.centerNames.get(membership.centerId)?.code ?? '',
      centerTimezone: user.centerNames.get(membership.centerId)?.timezone ?? DEFAULT_TIMEZONE,
      role: membership.role,
    })),
    expiresAt: expiresAt.toISOString(),
  }
}

export function registerContext(app: FastifyInstance, env: Env): void {
  app.decorateRequest('user', undefined)
  app.decorateRequest('session', undefined)
  app.decorateRequest('microsoftAccount', undefined)
  app.decorateRequest('locale', DEFAULT_LOCALE)
  app.decorateRequest('centerId', undefined)
  app.decorateRequest('crossCenter', false)

  // Asked once, at boot: a filesystem check per request would be silly.
  const servesWebApp = webDistPath() !== null

  app.addHook('onRequest', async (request) => {
    request.locale = resolveLocale(parseAcceptLanguage(request.headers['accept-language']))

    if (request.routeOptions.config?.public) return

    // Where this process also serves the web application, its files and its
    // shell are not API calls and have no session to check: the bundle is
    // what a browser needs *before* it can sign in.
    if (servesWebApp && isWebAppRequest(request)) return

    const user = await authenticate(request, env)
    if (!user) throw AppError.unauthorized()

    request.user = user
    // The stored preference wins over the browser header.
    request.locale = user.locale

    resolveActiveCenter(request, user)
    await applyCrossCenter(request, user)
    enforceRouteRoles(request, user)
  })
}

async function authenticate(request: FastifyRequest, env: Env): Promise<RequestUser | null> {
  const cookie = request.cookies[SESSION_COOKIE]
  if (cookie) {
    const unsigned = request.unsignCookie(cookie)
    if (!unsigned.valid || !unsigned.value) return null

    const session = await loadSession(prisma(), unsigned.value)
    if (!session) return null

    const user = await loadUserById(session.userId)
    if (!user) return null

    // A suspended or deactivated account loses access on the next request,
    // without waiting for the session to expire.
    if (user.status !== 'active') return null

    request.session = session
    request.microsoftAccount =
      session.method === 'entra' && user.entraOid && session.entraTid
        ? { objectId: user.entraOid, tenantId: session.entraTid, username: user.email }
        : null

    return user
  }

  // Development and e2e only: refused in production by `loadEnv`.
  if (env.AUTH_MODE === 'mock') {
    const header = request.headers['x-mock-user']
    const email = typeof header === 'string' && header.length > 0 ? header : env.MOCK_USER_EMAIL
    if (!email) return null

    const user = await loadUserByEmail(email)
    if (!user) return null

    // A synthetic session so every route downstream — including
    // `/auth/session`, which the web app calls on boot — behaves exactly as it
    // does with a real cookie.
    request.session = {
      id: 'mock-session',
      userId: user.userId,
      method: 'local',
      entraTid: null,
      expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000),
    }
    request.microsoftAccount = null

    return user
  }

  return null
}

function resolveActiveCenter(request: FastifyRequest, user: RequestUser): void {
  const centerHeader = request.headers[CENTER_HEADER]
  if (typeof centerHeader === 'string' && centerHeader.length > 0) {
    request.centerId = centerHeader
    return
  }

  const centers = new Set(user.memberships.map((membership) => membership.centerId))
  if (centers.size === 1) request.centerId = [...centers][0]
}

async function applyCrossCenter(request: FastifyRequest, user: RequestUser): Promise<void> {
  const crossHeader = request.headers[CROSS_CENTER_HEADER]
  const wantsCrossCenter = crossHeader === 'true' || crossHeader === '1'

  if (wantsCrossCenter) {
    // R2: only SUPERADMIN crosses centers, and the crossing is audited.
    if (!isSuperadmin(user)) throw AppError.forbidden()
    request.crossCenter = true

    await writeAuditLog(prisma(), {
      centerId: request.centerId ?? null,
      userId: user.userId,
      entity: 'center',
      entityId: request.centerId ?? 'all',
      action: 'cross_center_access',
      after: { method: request.method, url: request.url },
      source: 'user',
      ip: request.ip,
    })
  }

  if (request.centerId && !canAccessCenter(user, request.centerId) && !request.crossCenter) {
    throw AppError.tenantMismatch()
  }
}

function enforceRouteRoles(request: FastifyRequest, user: RequestUser): void {
  const config = request.routeOptions.config

  if (config?.superadminOnly && !isSuperadmin(user)) throw AppError.forbidden()

  const allowedRoles = config?.roles
  if (!allowedRoles || allowedRoles.length === 0) return

  if (!request.centerId) throw AppError.tenantRequired()

  const roles = user.memberships
    .filter((membership) => membership.centerId === request.centerId)
    .map((membership) => membership.role)

  if (!isSuperadmin(user) && !roles.some((role) => allowedRoles.includes(role))) {
    throw AppError.forbidden()
  }
}
