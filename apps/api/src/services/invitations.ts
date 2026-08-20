/**
 * Invitations: how somebody who has never signed in gets a password.
 *
 * The platform hands out accounts rather than letting people register, so an
 * account exists before its owner does anything. The invitation is the one
 * bridge between the two: a link, good once and not for long, that proves the
 * person reading that mailbox is the person the account was created for.
 *
 * Only the SHA-256 of the token is stored (CLAUDE.md §5). It is a bearer
 * capability in a URL — whoever holds it can set a password — so a database
 * dump must yield no working invitation, and withdrawing one is a single row.
 */
import type { PrismaClient } from '@uacademic/db'
import type { InvitationSummary } from '@uacademic/shared'
import { createHash, randomBytes } from 'node:crypto'

import { AppError } from '../lib/errors.js'
import { hashPassword } from '../lib/password.js'
import { writeAuditLog } from '../lib/audit.js'

/**
 * A week. Long enough to survive a holiday and a forgotten mailbox, short
 * enough that a link left in an inbox for a term is no longer a way in — and
 * an expired one is not a dead end: any administrator can send another.
 */
export const INVITATION_TTL_HOURS = 7 * 24

/**
 * Two hours for a reset somebody asked for themselves.
 *
 * The invitation's week is sized for a mailbox nobody has opened yet; a person
 * who has just clicked "I forgot my password" is reading their mail now, and a
 * link that stays live for a week is a week of somebody else's chances.
 */
export const PASSWORD_RESET_TTL_HOURS = 2

export function generateInvitationToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface IssuedInvitation {
  token: string
  expiresAt: Date
}

/**
 * Issues one, retiring whatever came before it.
 *
 * Re-inviting somebody is the same act as inviting them, and two live links to
 * the same account is one more than anybody needs: the older one stops working
 * the moment a new one is sent.
 */
export async function issueInvitation(
  prisma: PrismaClient,
  userId: string,
  options: { ttlHours?: number } = {},
): Promise<IssuedInvitation> {
  await prisma.userInvitation.updateMany({
    where: { userId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  const token = generateInvitationToken()
  const expiresAt = new Date(Date.now() + (options.ttlHours ?? INVITATION_TTL_HOURS) * 3_600_000)

  await prisma.userInvitation.create({
    data: { userId, tokenHash: hashInvitationToken(token), expiresAt },
  })

  return { token, expiresAt }
}

interface LiveInvitation {
  id: string
  userId: string
  summary: InvitationSummary
}

/**
 * The invitation behind a token, or the reason there is none.
 *
 * Spent, withdrawn and never-existed are one answer on purpose: they differ
 * only to somebody guessing tokens. Expired is its own, because it is the one
 * a person can act on — ask for another.
 */
export async function readInvitation(prisma: PrismaClient, token: string): Promise<LiveInvitation> {
  const invitation = await prisma.userInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: {
      user: {
        include: {
          centerRoles: { include: { center: { select: { name: true } } } },
        },
      },
    },
  })

  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw new AppError(404, 'NOT_FOUND', 'auth.errors.invitationInvalid')
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'GONE', 'auth.errors.invitationExpired')
  }

  const user = invitation.user
  if (user.status === 'suspended') {
    throw new AppError(403, 'FORBIDDEN', 'auth.errors.suspended')
  }

  return {
    id: invitation.id,
    userId: user.id,
    summary: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      centerName: user.centerRoles[0]?.center.name ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
      hasMicrosoftAccount: user.entraOid !== null,
    },
  }
}

export interface AcceptInvitationInput {
  token: string
  password: string
  ip?: string | null
}

/**
 * Sets the password and opens the account.
 *
 * One statement marks the invitation spent, so two browsers racing the same
 * link cannot both succeed: the second finds nothing left to accept.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  input: AcceptInvitationInput,
): Promise<{ userId: string }> {
  const invitation = await readInvitation(prisma, input.token)
  const passwordHash = await hashPassword(input.password)

  const spent = await prisma.userInvitation.updateMany({
    where: { id: invitation.id, acceptedAt: null, revokedAt: null },
    data: { acceptedAt: new Date() },
  })
  if (spent.count === 0) {
    throw new AppError(404, 'NOT_FOUND', 'auth.errors.invitationInvalid')
  }

  await prisma.localCredential.upsert({
    where: { userId: invitation.userId },
    create: { userId: invitation.userId, passwordHash },
    // Re-inviting somebody who forgot their password is how it is reset, so
    // the counters that locked them out go with it.
    update: {
      passwordHash,
      passwordChangedAt: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    },
  })

  await prisma.user.update({
    where: { id: invitation.userId },
    data: { status: 'active' },
  })

  await writeAuditLog(prisma, {
    centerId: null,
    userId: invitation.userId,
    entity: 'user',
    entityId: invitation.userId,
    action: 'invitation_accepted',
    after: { status: 'active', credential: 'set' },
    source: 'user',
    ip: input.ip ?? null,
  })

  return { userId: invitation.userId }
}
