/**
 * The three data-protection duties, implemented rather than described.
 *
 * **Export** hands somebody everything the platform holds about them, in one
 * machine-readable file. Not a summary: the actual rows, including the ones
 * they never see in the interface.
 *
 * **Erasure** removes the person and keeps the institution's record. A
 * university cannot forget that a class was taught or who approved a change —
 * that is an academic record and an audit trail, kept under a legal
 * obligation and a legitimate interest. What goes is everything that
 * identifies a human being: the name, the address, the devices, the
 * preferences, the assistant transcripts. What survives is anonymised, never
 * silently attributed to somebody else.
 *
 * **Retention** is a center setting, applied by a daily job, because "how long
 * do you keep an audit log?" has a different answer in every institution.
 *
 * Secrets never appear in any of this: an export carries the *existence* of a
 * calendar connection, not its refresh token, and not the ICS feed token
 * either — a data export that leaks a live capability is a breach with good
 * intentions.
 */
import type { PrismaClient } from '@uacademic/db'
import {
  ERASED_ON_REQUEST,
  KEPT_AFTER_ERASURE,
  parseCenterSettings,
  retentionCutoff,
} from '@uacademic/shared'

import { writeAuditLog } from '../lib/audit.js'

export interface PersonalDataExport {
  generatedAt: string
  subject: Record<string, unknown>
  memberships: unknown[]
  teaching: Record<string, unknown[]>
  schedule: Record<string, unknown[]>
  communication: Record<string, unknown[]>
  calendar: Record<string, unknown[]>
  assistant: Record<string, unknown[]>
  documents: unknown[]
  consents: unknown[]
  /** What is *not* in here, and why. Honesty is part of the answer. */
  notIncluded: string[]
}

/**
 * Everything held about one person, across every center they belong to.
 *
 * The right of access is the person's, not the center's, so this deliberately
 * crosses tenants — for one subject, and only for themselves.
 */
export async function exportPersonalData(
  client: PrismaClient,
  userId: string,
): Promise<PersonalDataExport> {
  const user = await client.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      centerRoles: { include: { center: { select: { name: true, code: true } } } },
      consents: true,
      notificationPrefs: true,
      teacherProfiles: {
        include: {
          reductions: true,
          availability: true,
          availabilityExceptions: true,
          skills: { include: { subject: { select: { code: true } } } },
          assignments: true,
        },
      },
    },
  })

  const profileIds = user.teacherProfiles.map((profile) => profile.id)

  const [sessions, changes, absences, messages, notifications, connections, feeds] =
    await Promise.all([
      client.classSession.findMany({
        // Their classes, shared ones included: an export that leaves out the
        // ones they give with a colleague is not their data.
        where: {
          OR: [
            { teacherProfileId: { in: profileIds } },
            { coTeachers: { some: { teacherProfileId: { in: profileIds } } } },
          ],
        },
        select: {
          id: true,
          weekday: true,
          startTime: true,
          endTime: true,
          groupId: true,
          spaceId: true,
        },
        take: 5_000,
      }),
      client.changeRequest.findMany({
        where: { OR: [{ requesterId: userId }, { targetUserId: userId }] },
        take: 2_000,
      }),
      client.absence.findMany({ where: { teacherProfileId: { in: profileIds } }, take: 2_000 }),
      client.message.findMany({
        where: { senderId: userId },
        select: { id: true, conversationId: true, body: true, createdAt: true },
        take: 5_000,
      }),
      client.notification.findMany({ where: { userId }, take: 5_000 }),
      client.calendarConnection.findMany({
        where: { userId },
        // No tokens: their existence is personal data, their value is a key.
        select: {
          provider: true,
          status: true,
          calendarName: true,
          syncDirection: true,
          lastSyncAt: true,
          consentAt: true,
          consentVersion: true,
        },
      }),
      client.calendarFeedToken.findMany({
        where: { userId },
        select: { id: true, createdAt: true, lastFetchedAt: true, revokedAt: true },
      }),
    ])

  const [conversations, interactions, documents] = await Promise.all([
    client.aiConversation.findMany({
      where: { userId },
      include: { messages: { select: { role: true, content: true, createdAt: true } } },
      take: 500,
    }),
    client.aiInteraction.findMany({
      where: { userId },
      select: { prompt: true, response: true, tokensIn: true, tokensOut: true, createdAt: true },
      take: 2_000,
    }),
    client.document.findMany({
      where: { uploadedBy: userId },
      select: { id: true, title: true, type: true, createdAt: true },
      take: 1_000,
    }),
  ])

  await writeAuditLog(client, {
    centerId: user.centerRoles[0]?.centerId ?? null,
    userId,
    entity: 'user',
    entityId: userId,
    action: 'export_personal_data',
    before: null,
    after: { messages: messages.length, sessions: sessions.length },
    source: 'user',
    ip: null,
  })

  return {
    generatedAt: new Date().toISOString(),
    subject: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      theme: user.theme,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      microsoftObjectId: user.entraOid,
    },
    memberships: user.centerRoles.map((role) => ({
      center: role.center.name,
      code: role.center.code,
      role: role.role,
      validFrom: role.validFrom,
      validTo: role.validTo,
    })),
    teaching: {
      profiles: user.teacherProfiles.map((profile) => ({
        id: profile.id,
        category: profile.category,
        dedication: profile.dedication,
        contractedHours: profile.contractedHours,
        reductions: profile.reductions,
        availability: profile.availability,
        availabilityExceptions: profile.availabilityExceptions,
        skills: profile.skills.map((skill) => skill.subject?.code ?? null),
        assignments: profile.assignments,
      })),
    },
    schedule: { sessions, changes, absences },
    communication: { messages, notifications, preferences: user.notificationPrefs },
    calendar: { connections, feeds },
    assistant: { conversations, interactions },
    documents,
    consents: user.consents,
    notIncluded: [
      'calendarAccessTokens',
      'calendarRefreshTokens',
      'icsFeedTokens',
      'passwordHash',
      'totpSecret',
    ],
  }
}

export interface ErasureResult {
  erased: readonly string[]
  kept: readonly string[]
  anonymisedAs: string
}

/**
 * Erases the person and keeps the record.
 *
 * The account is not deleted: rows all over the schema point at it, and
 * cascading them would take the timetable and the audit trail with them. It
 * is emptied of everything identifying, marked suspended so it cannot be used,
 * and left as an anonymous actor the history can still refer to.
 */
export async function erasePersonalData(
  client: PrismaClient,
  input: { userId: string; requestedBy: string; ip?: string | null },
): Promise<ErasureResult> {
  const user = await client.user.findUniqueOrThrow({
    where: { id: input.userId },
    include: { centerRoles: { select: { centerId: true } } },
  })

  const anonymous = `erased-${user.id.slice(0, 8)}`
  const profileIds = (
    await client.teacherProfile.findMany({ where: { userId: user.id }, select: { id: true } })
  ).map((profile) => profile.id)

  // Devices, sessions and connections: nothing here is a record of anything,
  // and every one of them is a way back to a person.
  await client.authSession.deleteMany({ where: { userId: user.id } })
  await client.pushSubscription.deleteMany({ where: { userId: user.id } })
  await client.calendarConnection.deleteMany({ where: { userId: user.id } })
  await client.calendarFeedToken.deleteMany({ where: { userId: user.id } })
  await client.notificationPref.deleteMany({ where: { userId: user.id } })
  await client.notification.deleteMany({ where: { userId: user.id } })
  await client.localCredential.deleteMany({ where: { userId: user.id } })
  await client.externalBusySlot.deleteMany({ where: { teacherProfileId: { in: profileIds } } })

  // Written in the first person, about themselves.
  await client.aiMessage.deleteMany({ where: { conversation: { userId: user.id } } })
  await client.aiConversation.deleteMany({ where: { userId: user.id } })
  await client.aiInteraction.deleteMany({ where: { userId: user.id } })

  // A free-text reason on an availability exception is where somebody writes
  // why they were ill.
  await client.availabilityException.updateMany({
    where: { teacherProfileId: { in: profileIds } },
    data: { reason: null },
  })

  await client.user.update({
    where: { id: user.id },
    data: {
      email: `${anonymous}@erased.invalid`,
      firstName: 'Compte',
      lastName: 'esborrat',
      avatarUrl: null,
      entraOid: null,
      status: 'suspended',
    },
  })

  await writeAuditLog(client, {
    centerId: user.centerRoles[0]?.centerId ?? null,
    userId: input.requestedBy,
    entity: 'user',
    entityId: user.id,
    action: 'erase_personal_data',
    // The audit entry itself must not re-identify what was just erased.
    before: { hadAccount: true },
    after: { anonymisedAs: anonymous },
    source: 'user',
    ip: input.ip ?? null,
  })

  return { erased: ERASED_ON_REQUEST, kept: KEPT_AFTER_ERASURE, anonymisedAs: anonymous }
}

export interface PurgeReport {
  auditLog: number
  notifications: number
  aiInteractions: number
  authSessions: number
}

/**
 * Applies each center's retention policy.
 *
 * The audit log is INSERT-only (R4), which is about nobody editing history —
 * not about keeping it for ever. A center that has to delete after six years
 * says so here, and this is where it happens.
 */
export async function applyRetention(
  client: PrismaClient,
  now: Date = new Date(),
): Promise<PurgeReport> {
  const centers = await client.center.findMany({ select: { id: true, settingsJson: true } })
  const report: PurgeReport = { auditLog: 0, notifications: 0, aiInteractions: 0, authSessions: 0 }

  for (const center of centers) {
    const privacy = parseCenterSettings(center.settingsJson).privacy

    const auditBefore = retentionCutoff(privacy.auditLogDays, now)
    if (auditBefore) {
      const deleted = await client.auditLog.deleteMany({
        where: { centerId: center.id, createdAt: { lt: auditBefore } },
      })
      report.auditLog += deleted.count
    }

    const notificationsBefore = retentionCutoff(privacy.notificationDays, now)
    if (notificationsBefore) {
      const deleted = await client.notification.deleteMany({
        where: { centerId: center.id, createdAt: { lt: notificationsBefore } },
      })
      report.notifications += deleted.count
    }

    const aiBefore = retentionCutoff(privacy.aiInteractionDays, now)
    if (aiBefore) {
      const deleted = await client.aiInteraction.deleteMany({
        where: { centerId: center.id, createdAt: { lt: aiBefore } },
      })
      report.aiInteractions += deleted.count
    }
  }

  // Sessions are not center-scoped: the shortest policy any center set wins,
  // because an expired session is not evidence of anything.
  const shortest = Math.min(
    ...centers.map((center) => parseCenterSettings(center.settingsJson).privacy.authSessionDays),
    365,
  )
  const sessionsBefore = retentionCutoff(shortest, now)
  if (sessionsBefore) {
    const deleted = await client.authSession.deleteMany({
      where: { expiresAt: { lt: sessionsBefore } },
    })
    report.authSessions += deleted.count
  }

  return report
}
