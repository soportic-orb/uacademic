import type { PrismaClient } from '@uacademic/db'
import {
  type JitCandidateCenter,
  type RegisteredTenant,
  canSignIn,
  decideJitProvisioning,
  parseCenterSettings,
  signInBlockedMessageKey,
} from '@uacademic/shared'

import { writeAuditLog } from '../lib/audit.js'
import type { VerifiedIdentity } from '../lib/entra.js'
import { AppError } from '../lib/errors.js'
import { isLockedOut, nextLockout, verifyPassword } from '../lib/password.js'
import { decryptSecret } from '../lib/crypto.js'
import { verifyTotp } from '../lib/totp.js'

export interface SessionRequestInfo {
  userAgent?: string | undefined
  ip?: string | undefined
}

/** Tenants a token may legitimately come from (R3). */
export async function loadRegisteredTenants(prisma: PrismaClient): Promise<RegisteredTenant[]> {
  const tenants = await prisma.entraTenant.findMany({
    select: { tenantId: true, issuer: true, status: true },
  })
  return tenants.map((tenant) => ({
    tenantId: tenant.tenantId,
    issuer: tenant.issuer,
    status: tenant.status,
  }))
}

async function jitCandidates(prisma: PrismaClient, tenantId: string): Promise<JitCandidateCenter[]> {
  const centers = await prisma.center.findMany({
    where: { entraTenantId: tenantId },
    select: { id: true, entraTenantId: true, settingsJson: true },
  })

  return centers.map((center) => {
    const identity = parseCenterSettings(center.settingsJson).identity
    return {
      centerId: center.id,
      entraTenantId: center.entraTenantId,
      policy: {
        enabled: identity.jitProvisioning,
        allowedEmailDomains: identity.allowedEmailDomains,
        defaultRole: identity.defaultRole,
        requireActivation: identity.requireActivation,
      },
    }
  })
}

export interface ResolvedUser {
  id: string
  email: string
  status: 'active' | 'invited' | 'pending_activation' | 'suspended'
}

/**
 * Maps a verified Microsoft identity onto one of our users.
 *
 * Three paths, in order: a known `oid`; an account that was pre-created for
 * that email and is now claiming its `oid` for the first time; and finally
 * just-in-time provisioning when the center allows it. Roles are never taken
 * from the token — they are read from `user_center_roles` afterwards (R3).
 */
export async function resolveEntraUser(
  prisma: PrismaClient,
  identity: VerifiedIdentity,
  info: SessionRequestInfo = {},
): Promise<ResolvedUser> {
  const byOid = await prisma.user.findUnique({ where: { entraOid: identity.objectId } })

  if (byOid) {
    await prisma.user.update({
      where: { id: byOid.id },
      data: {
        lastLoginAt: new Date(),
        ...(identity.email && identity.email !== byOid.email ? { email: identity.email } : {}),
      },
    })
    return assertCanSignIn({ id: byOid.id, email: byOid.email, status: byOid.status })
  }

  if (identity.email) {
    const byEmail = await prisma.user.findUnique({
      where: { email: identity.email },
      include: { centerRoles: { include: { center: { select: { entraTenantId: true } } } } },
    })

    if (byEmail) {
      if (byEmail.entraOid && byEmail.entraOid !== identity.objectId) {
        // The address is already bound to a different Microsoft identity.
        throw new AppError(403, 'FORBIDDEN', 'auth.errors.tokenInvalid')
      }

      // Claiming an existing account is only allowed from the tenant that
      // account's center is bound to: otherwise a user of another registered
      // organization could take over an address that happens to match.
      const sameTenant = byEmail.centerRoles.some(
        (membership) =>
          (membership.center.entraTenantId ?? '').toLowerCase() === identity.tenantId.toLowerCase(),
      )
      if (!sameTenant) {
        throw new AppError(403, 'FORBIDDEN', 'auth.errors.tenantNotAuthorized')
      }

      const linked = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          entraOid: identity.objectId,
          lastLoginAt: new Date(),
          // An invitation is accepted by signing in for the first time.
          ...(byEmail.status === 'invited' ? { status: 'active' as const } : {}),
        },
      })

      await writeAuditLog(prisma, {
        centerId: null,
        userId: linked.id,
        entity: 'user',
        entityId: linked.id,
        action: 'entra_link',
        after: { entraOid: identity.objectId, tenantId: identity.tenantId },
        source: 'system',
        ip: info.ip ?? null,
      })

      return assertCanSignIn({ id: linked.id, email: linked.email, status: linked.status })
    }
  }

  // Nothing matched: provision only if a center bound to this tenant allows it.
  if (!identity.email) throw new AppError(403, 'FORBIDDEN', 'auth.errors.tokenInvalid')

  const decision = decideJitProvisioning(
    { tenantId: identity.tenantId, email: identity.email },
    await jitCandidates(prisma, identity.tenantId),
  )

  if (!decision.provision) {
    throw new AppError(403, 'FORBIDDEN', 'auth.errors.tenantNotAuthorized', [
      { path: 'jit', messageKey: `auth.errors.jit.${decision.reason}` },
    ])
  }

  const [firstName, ...rest] = (identity.displayName ?? identity.email.split('@')[0] ?? '').split(' ')
  const created = await prisma.user.create({
    data: {
      entraOid: identity.objectId,
      email: identity.email,
      firstName: firstName && firstName.length > 0 ? firstName : identity.email,
      lastName: rest.join(' ') || '—',
      status: decision.status,
      lastLoginAt: new Date(),
      centerRoles: {
        create: { centerId: decision.centerId, role: decision.role },
      },
    },
  })

  await writeAuditLog(prisma, {
    centerId: decision.centerId,
    userId: created.id,
    entity: 'user',
    entityId: created.id,
    action: 'jit_provision',
    after: {
      email: created.email,
      role: decision.role,
      status: decision.status,
      tenantId: identity.tenantId,
    },
    source: 'system',
    ip: info.ip ?? null,
  })

  return assertCanSignIn({ id: created.id, email: created.email, status: created.status })
}

function assertCanSignIn(user: ResolvedUser): ResolvedUser {
  if (!canSignIn(user.status)) {
    throw new AppError(403, 'FORBIDDEN', signInBlockedMessageKey(user.status))
  }
  return user
}

export interface LocalLoginInput {
  email: string
  password: string
  totp?: string | undefined
  encryptionKey?: string | undefined
}

/**
 * Break-glass sign-in for the platform superadmin: email, argon2id password
 * and TOTP, with no dependency on Microsoft. Deliberately the only account
 * type that has a password at all.
 */
export async function localLogin(
  prisma: PrismaClient,
  input: LocalLoginInput,
  info: SessionRequestInfo = {},
): Promise<ResolvedUser> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { localCredential: true, centerRoles: true },
  })

  const credential = user?.localCredential
  if (!user || !credential) {
    // Same answer whether the account exists or not.
    throw new AppError(401, 'UNAUTHORIZED', 'auth.errors.invalidCredentials')
  }

  if (isLockedOut(credential.lockedUntil)) {
    throw new AppError(403, 'FORBIDDEN', 'auth.errors.locked')
  }

  // The local path exists for the platform administrator, nobody else.
  if (!user.centerRoles.some((membership) => membership.role === 'SUPERADMIN')) {
    throw new AppError(403, 'FORBIDDEN', 'auth.errors.localNotAvailable')
  }

  const passwordOk = await verifyPassword(input.password, credential.passwordHash)
  if (!passwordOk) {
    const failedAttempts = credential.failedAttempts + 1
    await prisma.localCredential.update({
      where: { id: credential.id },
      data: { failedAttempts, lockedUntil: nextLockout(failedAttempts) },
    })
    await writeAuditLog(prisma, {
      centerId: null,
      userId: user.id,
      entity: 'auth',
      entityId: user.id,
      action: 'local_login_failed',
      after: { failedAttempts },
      source: 'system',
      ip: info.ip ?? null,
    })
    throw new AppError(401, 'UNAUTHORIZED', 'auth.errors.invalidCredentials')
  }

  if (credential.totpConfirmedAt && credential.totpSecretEnc) {
    if (!input.totp) throw new AppError(401, 'UNAUTHORIZED', 'auth.errors.totpRequired')

    const secret = decryptSecret(credential.totpSecretEnc, input.encryptionKey)
    if (!verifyTotp(secret, input.totp)) {
      const failedAttempts = credential.failedAttempts + 1
      await prisma.localCredential.update({
        where: { id: credential.id },
        data: { failedAttempts, lockedUntil: nextLockout(failedAttempts) },
      })
      throw new AppError(401, 'UNAUTHORIZED', 'auth.errors.invalidTotp')
    }
  }

  await prisma.localCredential.update({
    where: { id: credential.id },
    data: { failedAttempts: 0, lockedUntil: null },
  })
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  return assertCanSignIn({ id: user.id, email: user.email, status: user.status })
}

export interface CreatedSession {
  id: string
  expiresAt: Date
}

export async function createSession(
  prisma: PrismaClient,
  params: {
    userId: string
    method: 'entra' | 'local'
    entraTid?: string | null
    ttlHours: number
  } & SessionRequestInfo,
): Promise<CreatedSession> {
  const expiresAt = new Date(Date.now() + params.ttlHours * 60 * 60 * 1000)

  const session = await prisma.authSession.create({
    data: {
      userId: params.userId,
      method: params.method,
      entraTid: params.entraTid ?? null,
      expiresAt,
      userAgent: params.userAgent?.slice(0, 400) ?? null,
      ip: params.ip ?? null,
    },
  })

  return { id: session.id, expiresAt: session.expiresAt }
}

export interface ActiveSession {
  id: string
  userId: string
  method: 'entra' | 'local'
  entraTid: string | null
  expiresAt: Date
}

/**
 * Sessions live server-side precisely so they can be cut off: a revoked or
 * expired row means the cookie is worthless from the next request on.
 */
export async function loadSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<ActiveSession | null> {
  const session = await prisma.authSession.findUnique({ where: { id: sessionId } })
  if (!session) return null
  if (session.revokedAt) return null
  if (session.expiresAt.getTime() <= Date.now()) return null

  // Cheap heartbeat: only written once a minute to avoid a write per request.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    })
  }

  return {
    id: session.id,
    userId: session.userId,
    method: session.method,
    entraTid: session.entraTid,
    expiresAt: session.expiresAt,
  }
}

export async function revokeSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeAllUserSessions(
  prisma: PrismaClient,
  userId: string,
  except?: string,
): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null, ...(except ? { id: { not: except } } : {}) },
    data: { revokedAt: new Date() },
  })
  return result.count
}
