import type { AppLocale, Principal, Role } from '@uacademic/shared'
import { CENTER_HEADER, CROSS_CENTER_HEADER, canAccessCenter, isSuperadmin } from '@uacademic/shared'
import { DEFAULT_LOCALE, parseAcceptLanguage, resolveLocale } from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import { writeAuditLog } from '../lib/audit.js'
import { AppError } from '../lib/errors.js'
import { type ScopedPrismaClient, prisma, scopedPrisma } from '../lib/prisma.js'

export interface RequestUser extends Principal {
  email: string
  firstName: string
  lastName: string
  locale: AppLocale
  theme: 'light' | 'dark' | 'system'
  avatarUrl: string | null
  centerNames: Map<string, { name: string; code: string }>
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser
    locale: AppLocale
    centerId?: string
    crossCenter: boolean
  }
  interface FastifyContextConfig {
    /** Routes that must answer without an identity (health, metrics). */
    public?: boolean
    /** Roles allowed on this route, checked against the active center. */
    roles?: readonly Role[]
  }
}

/**
 * Phase 0 identity. The mock reads a header and resolves the user in our
 * database; phase 1 swaps the header for an Entra ID token and validates
 * `tid`, `iss` and `oid` — but the roles keep coming from `user_center_roles`,
 * never from the token (R3).
 */
export async function loadUserByEmail(email: string): Promise<RequestUser | null> {
  const client = prisma()
  const user = await client.user.findUnique({
    where: { email },
    include: {
      centerRoles: {
        include: { center: { select: { id: true, name: true, code: true } } },
      },
    },
  })
  if (!user) return null

  const centerNames = new Map<string, { name: string; code: string }>()
  for (const membership of user.centerRoles) {
    centerNames.set(membership.centerId, {
      name: membership.center.name,
      code: membership.center.code,
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
  return {
    centerId: request.centerId,
    db: scopedPrisma(prisma(), request.centerId),
  }
}

export function registerContext(app: FastifyInstance): void {
  app.decorateRequest('user', undefined)
  app.decorateRequest('locale', DEFAULT_LOCALE)
  app.decorateRequest('centerId', undefined)
  app.decorateRequest('crossCenter', false)

  app.addHook('onRequest', async (request) => {
    request.locale = resolveLocale(parseAcceptLanguage(request.headers['accept-language']))

    if (request.routeOptions.config?.public) return

    const headerEmail = request.headers['x-mock-user']
    const email =
      typeof headerEmail === 'string' && headerEmail.length > 0
        ? headerEmail
        : process.env.MOCK_USER_EMAIL

    if (!email) throw AppError.unauthorized()

    const user = await loadUserByEmail(email)
    if (!user) throw AppError.unauthorized()

    request.user = user
    // The user's stored preference wins over the browser header.
    request.locale = user.locale

    const centerHeader = request.headers[CENTER_HEADER]
    if (typeof centerHeader === 'string' && centerHeader.length > 0) {
      request.centerId = centerHeader
    } else if (user.memberships.length === 1) {
      request.centerId = user.memberships[0]?.centerId
    }

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

    const allowedRoles = request.routeOptions.config?.roles
    if (allowedRoles && allowedRoles.length > 0) {
      if (!request.centerId) throw AppError.tenantRequired()
      const roles = user.memberships
        .filter((membership) => membership.centerId === request.centerId)
        .map((membership) => membership.role)
      const allowed = isSuperadmin(user) || roles.some((role) => allowedRoles.includes(role))
      if (!allowed) throw AppError.forbidden()
    }
  })
}
