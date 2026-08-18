/**
 * The synchronisation engine.
 *
 * It is deliberately **one-directional**: UAcademic decides what a teacher
 * teaches, and a remote calendar is a copy. If somebody deletes a class from
 * their phone, the next run puts it back and tells them why — silently
 * accepting the deletion would mean a class nobody is told about.
 *
 * Everything runs from the `jobs` table (CLAUDE.md §2: there is no Redis), so
 * a provider being slow, rate-limited or down costs a retry with backoff and
 * never an HTTP request. The one thing that is *not* retried is a revoked
 * consent: 401, 403 and 410 park the connection and ask the person to
 * reconnect, because hammering a provider with a dead token is how an
 * integration gets blocked.
 */
import {
  type CalendarEventDraft,
  type CalendarProvider,
  CURRENT_CONSENT_VERSION,
  type ConsentScope,
  busyToAvoidEntries,
  classifyFailure,
  eventSignature,
  parseCenterSettings,
  planCalendarSync,
} from '@uacademic/shared'

import { env } from '../../config/env.js'
import { writeAuditLog } from '../../lib/audit.js'
import { decryptSecret, encryptSecret } from '../../lib/crypto.js'
import { toJson } from '../../lib/json.js'
import type { PrismaClient } from '../../lib/prisma.js'
import { enqueueJob } from '../../jobs/worker.js'
import { notify } from '../notify.js'
import { type DraftContext, sessionsForUser, toEventDraft } from './drafts.js'
import { providerClient } from './providers.js'
import { type OAuthTokens, ProviderError } from './types.js'

export interface ConnectionRow {
  id: string
  userId: string
  provider: CalendarProvider
  externalCalendarId: string | null
  accessTokenEnc: string
  refreshTokenEnc: string | null
  expiresAt: Date | null
  status: 'active' | 'expired' | 'revoked' | 'error'
  busySyncEnabled: boolean
  syncToken: string | null
  calendarName: string | null
}

export interface SyncOutcome {
  created: number
  updated: number
  removed: number
  unchanged: number
  restored: number
}

const TOKEN_SKEW_MS = 60_000

/* ─────────────────────────── tokens ─────────────────────────── */

export function encryptTokens(tokens: OAuthTokens): {
  accessTokenEnc: string
  refreshTokenEnc: string | null
  expiresAt: Date | null
  scopes: string | null
} {
  const key = env().APP_ENCRYPTION_KEY

  return {
    accessTokenEnc: encryptSecret(tokens.accessToken, key),
    refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken, key) : null,
    expiresAt: tokens.expiresAt ?? null,
    scopes: tokens.scopes ?? null,
  }
}

/**
 * A usable access token, refreshed if it is about to expire. The refresh token
 * is written back because some providers rotate it on every use — dropping the
 * new one silently kills the connection a day later.
 */
export async function tokensFor(
  client: PrismaClient,
  connection: ConnectionRow,
): Promise<OAuthTokens> {
  const key = env().APP_ENCRYPTION_KEY
  const stored: OAuthTokens = {
    accessToken: decryptSecret(connection.accessTokenEnc, key),
    refreshToken: connection.refreshTokenEnc
      ? decryptSecret(connection.refreshTokenEnc, key)
      : undefined,
    expiresAt: connection.expiresAt ?? undefined,
  }

  const fresh = !stored.expiresAt || stored.expiresAt.getTime() - TOKEN_SKEW_MS > Date.now()
  if (fresh || !stored.refreshToken) return stored

  const provider = providerClient(connection.provider)
  if (!provider) return stored

  const refreshed = await provider.refresh(stored.refreshToken)
  const encrypted = encryptTokens({
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? stored.refreshToken,
  })

  await client.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEnc: encrypted.accessTokenEnc,
      refreshTokenEnc: encrypted.refreshTokenEnc,
      expiresAt: encrypted.expiresAt,
      status: 'active',
    },
  })

  return { ...refreshed, refreshToken: refreshed.refreshToken ?? stored.refreshToken }
}

/* ─────────────────────────── outbox ─────────────────────────── */

/**
 * The outbox: publishing a schedule or applying a change enqueues one job per
 * affected person, and a job already waiting for them absorbs the new one.
 * Ten sessions moving in one publication must not become ten Graph storms.
 */
export async function enqueueCalendarSync(
  client: PrismaClient,
  userIds: readonly string[],
  options: { reason?: string; delayMs?: number } = {},
): Promise<number> {
  const unique = [...new Set(userIds)]
  let queued = 0

  for (const userId of unique) {
    const connections = await client.calendarConnection.count({
      where: { userId, status: 'active' },
    })
    if (connections === 0) continue

    const pending = await client.job.findFirst({
      where: { type: 'calendar.sync', status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    // Cheap de-duplication: a pending job for the same person is enough.
    const duplicate =
      pending &&
      typeof pending.payloadJson === 'object' &&
      pending.payloadJson !== null &&
      (pending.payloadJson as { userId?: string }).userId === userId

    if (duplicate) continue

    await enqueueJob(
      client,
      'calendar.sync',
      { userId, reason: options.reason ?? 'schedule' },
      { runAt: new Date(Date.now() + (options.delayMs ?? 0)) },
    )
    queued += 1
  }

  return queued
}

/* ─────────────────────────── context ─────────────────────────── */

async function draftContext(client: PrismaClient, userId: string): Promise<DraftContext | null> {
  const membership = await client.userCenterRole.findFirst({
    where: { userId },
    include: { center: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!membership) return null

  const settings = parseCenterSettings(membership.center.settingsJson)

  return {
    timezone: membership.center.timezone,
    centerName: membership.center.name,
    settings: settings.calendar,
    appUrl: env().APP_URL,
  }
}

export async function draftsForUser(
  client: PrismaClient,
  userId: string,
): Promise<CalendarEventDraft[]> {
  const context = await draftContext(client, userId)
  if (!context) return []

  const sessions = await sessionsForUser(client, userId)
  return sessions.map((session) => toEventDraft(session, context))
}

/* ─────────────────────────── push ─────────────────────────── */

/**
 * Brings one connection in line with the timetable: creates what is missing,
 * updates what moved, removes what is no longer this person's, and re-creates
 * whatever the provider says it has lost.
 */
export async function syncConnection(
  client: PrismaClient,
  connection: ConnectionRow,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { created: 0, updated: 0, removed: 0, unchanged: 0, restored: 0 }
  const provider = providerClient(connection.provider)
  if (!provider) return outcome

  const context = await draftContext(client, connection.userId)
  if (!context) return outcome

  try {
    const tokens = await tokensFor(client, connection)

    const calendarName = connection.calendarName ?? `UAcademic – ${context.centerName}`
    const calendarId =
      connection.externalCalendarId ?? (await provider.ensureCalendar(tokens, calendarName))

    if (calendarId !== connection.externalCalendarId) {
      await client.calendarConnection.update({
        where: { id: connection.id },
        data: { externalCalendarId: calendarId, calendarName },
      })
    }

    const drafts = await draftsForUser(client, connection.userId)
    const mappings = await client.calendarEventMap.findMany({
      where: { connectionId: connection.id },
    })

    const plan = planCalendarSync(
      drafts,
      mappings.map((mapping) => ({
        sessionId: mapping.sessionId,
        externalEventId: mapping.externalEventId,
        signature: mapping.etag ?? '',
      })),
    )
    outcome.unchanged = plan.unchanged

    for (const draft of plan.create) {
      const remote = await provider.createEvent(tokens, calendarId, draft)
      await client.calendarEventMap.create({
        data: {
          connectionId: connection.id,
          sessionId: draft.sessionId,
          externalEventId: remote.id,
          etag: eventSignature(draft),
          sequence: draft.sequence,
        },
      })
      outcome.created += 1
    }

    for (const entry of plan.update) {
      const restored = await writeEvent(
        client,
        provider,
        tokens,
        calendarId,
        connection,
        entry.draft,
        entry.externalEventId,
      )
      if (restored) outcome.restored += 1
      outcome.updated += 1
    }

    for (const entry of plan.remove) {
      await provider
        .deleteEvent(tokens, calendarId, entry.externalEventId)
        // Already gone remotely is the outcome we wanted anyway.
        .catch((error: unknown) => {
          if (error instanceof ProviderError && classifyFailure(error.status) === 'missing') return
          throw error
        })

      await client.calendarEventMap.deleteMany({
        where: { connectionId: connection.id, sessionId: entry.sessionId },
      })
      outcome.removed += 1
    }

    await client.calendarConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date(), lastError: null, status: 'active' },
    })

    if (outcome.restored > 0) {
      // The teacher deleted a class from their own calendar. It is back, and
      // saying so is the difference between a bug and a rule.
      await notify({
        client,
        centerId: null,
        event: 'calendar.restored',
        url: '/connections',
        recipients: [{ userId: connection.userId }],
        params: { count: outcome.restored },
      })
    }

    return outcome
  } catch (error) {
    await handleFailure(client, connection, error)
    throw error
  }
}

/**
 * Writes one event, recreating it when the provider says it is gone. This is
 * the point where "UAcademic is the source of truth" stops being a slogan.
 */
async function writeEvent(
  client: PrismaClient,
  provider: NonNullable<ReturnType<typeof providerClient>>,
  tokens: OAuthTokens,
  calendarId: string,
  connection: ConnectionRow,
  draft: CalendarEventDraft,
  externalEventId: string,
): Promise<boolean> {
  try {
    const remote = await provider.updateEvent(tokens, calendarId, externalEventId, draft)
    await client.calendarEventMap.updateMany({
      where: { connectionId: connection.id, sessionId: draft.sessionId },
      data: {
        externalEventId: remote.id,
        etag: eventSignature(draft),
        sequence: draft.sequence,
        lastSyncedAt: new Date(),
      },
    })
    return false
  } catch (error) {
    if (!(error instanceof ProviderError) || classifyFailure(error.status) !== 'missing')
      throw error

    const remote = await provider.createEvent(tokens, calendarId, draft)
    await client.calendarEventMap.updateMany({
      where: { connectionId: connection.id, sessionId: draft.sessionId },
      data: {
        externalEventId: remote.id,
        etag: eventSignature(draft),
        sequence: draft.sequence,
        lastSyncedAt: new Date(),
      },
    })
    return true
  }
}

/**
 * A dead connection is parked, not retried. The person is told once, in their
 * own language, and nothing else happens until they reconnect.
 */
async function handleFailure(
  client: PrismaClient,
  connection: ConnectionRow,
  error: unknown,
): Promise<void> {
  const status = error instanceof ProviderError ? error.status : 0
  const message = error instanceof Error ? error.message : String(error)

  if (status && classifyFailure(status) === 'dead') {
    await client.calendarConnection.update({
      where: { id: connection.id },
      data: { status: 'revoked', lastError: message.slice(0, 1000) },
    })

    await notify({
      client,
      centerId: null,
      event: 'calendar.disconnected',
      url: '/connections',
      recipients: [{ userId: connection.userId }],
      params: { provider: connection.provider },
    })

    await writeAuditLog(client, {
      centerId: null,
      userId: connection.userId,
      entity: 'calendar_connection',
      entityId: connection.id,
      action: 'revoked',
      before: { status: connection.status },
      after: { status: 'revoked', reason: status },
      source: 'system',
    })
    return
  }

  await client.calendarConnection.update({
    where: { id: connection.id },
    data: { status: 'error', lastError: message.slice(0, 1000) },
  })
}

/* ─────────────────────────── busy (reverse) ─────────────────────────── */

export interface BusyPullResult {
  windows: number
  slots: number
}

/**
 * Reads the personal calendar's **busy time only** — start and end, never a
 * title — and stores it so the planner can treat those hours as "better
 * avoided". Retention is short and deliberately without history: this is
 * somebody's private diary, borrowed for one decision.
 */
export async function pullBusy(
  client: PrismaClient,
  connection: ConnectionRow,
): Promise<BusyPullResult> {
  if (!connection.busySyncEnabled) return { windows: 0, slots: 0 }

  const provider = providerClient(connection.provider)
  const context = await draftContext(client, connection.userId)
  if (!provider || !context) return { windows: 0, slots: 0 }

  const profiles = await client.teacherProfile.findMany({
    where: { userId: connection.userId },
    select: { id: true },
  })
  if (profiles.length === 0) return { windows: 0, slots: 0 }

  const settings = await centerSettings(client, connection.userId)
  const from = new Date()
  const to = new Date(from.getTime() + settings.busyRetentionDays * 86_400_000)

  try {
    const tokens = await tokensFor(client, connection)
    const result = await provider.listBusy(tokens, {
      from,
      to,
      syncToken: connection.syncToken ?? undefined,
    })

    await client.externalBusySlot.deleteMany({ where: { connectionId: connection.id } })

    for (const profile of profiles) {
      await client.externalBusySlot.createMany({
        data: result.windows.map((window) => ({
          teacherProfileId: profile.id,
          connectionId: connection.id,
          startAt: window.startAt,
          endAt: window.endAt,
          source: connection.provider,
        })),
      })
    }

    await client.calendarConnection.update({
      where: { id: connection.id },
      data: { syncToken: result.syncToken ?? null, lastBusySyncAt: new Date() },
    })

    return { windows: result.windows.length, slots: result.windows.length * profiles.length }
  } catch (error) {
    // A stale cursor is the provider telling us to start over, not a failure.
    if (error instanceof ProviderError && error.status === 410 && connection.syncToken) {
      await client.calendarConnection.update({
        where: { id: connection.id },
        data: { syncToken: null },
      })
      return { windows: 0, slots: 0 }
    }

    await handleFailure(client, connection, error)
    throw error
  }
}

async function centerSettings(client: PrismaClient, userId: string) {
  const membership = await client.userCenterRole.findFirst({
    where: { userId },
    include: { center: true },
    orderBy: { createdAt: 'asc' },
  })
  return parseCenterSettings(membership?.center.settingsJson).calendar
}

/**
 * The busy time of one teacher, as weekly slots the engine can read. Only what
 * repeats counts — a one-off dentist appointment should not reshape a term.
 */
export async function externalAvoidEntries(
  client: PrismaClient,
  teacherProfileId: string,
  timezone: string,
  options: { slotMinutes: number; minOccurrences: number },
) {
  const slots = await client.externalBusySlot.findMany({
    where: { teacherProfileId },
    select: { startAt: true, endAt: true },
    take: 2_000,
  })

  return busyToAvoidEntries(slots, {
    timezone,
    slotMinutes: options.slotMinutes,
    minOccurrences: options.minOccurrences,
  })
}

/* ─────────────────────────── consent ─────────────────────────── */

export async function recordConsent(
  client: PrismaClient,
  input: { userId: string; scope: ConsentScope; ip?: string | null; details?: unknown },
): Promise<void> {
  await client.consentRecord.create({
    data: {
      userId: input.userId,
      scope: input.scope,
      version: CURRENT_CONSENT_VERSION,
      ip: input.ip ?? null,
      detailsJson: input.details ? toJson(input.details) : undefined,
    },
  })

  await writeAuditLog(client, {
    centerId: null,
    userId: input.userId,
    entity: 'consent',
    entityId: input.scope,
    action: 'grant',
    before: null,
    after: { scope: input.scope, version: CURRENT_CONSENT_VERSION },
    source: 'user',
    ip: input.ip ?? null,
  })
}

export async function revokeConsent(
  client: PrismaClient,
  input: { userId: string; scope: ConsentScope; ip?: string | null },
): Promise<void> {
  await client.consentRecord.updateMany({
    where: { userId: input.userId, scope: input.scope, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  await writeAuditLog(client, {
    centerId: null,
    userId: input.userId,
    entity: 'consent',
    entityId: input.scope,
    action: 'revoke',
    before: { scope: input.scope },
    after: null,
    source: 'user',
    ip: input.ip ?? null,
  })
}

/* ─────────────────────────── disconnect ─────────────────────────── */

/**
 * Leaving cleanly: the dedicated calendar can be deleted with everything in
 * it, which is the point of never having written into the personal one.
 */
export async function disconnect(
  client: PrismaClient,
  connection: ConnectionRow,
  options: { deleteRemote: boolean; ip?: string | null },
): Promise<{ remoteDeleted: boolean }> {
  let remoteDeleted = false

  if (options.deleteRemote && connection.externalCalendarId) {
    const provider = providerClient(connection.provider)
    if (provider) {
      try {
        const tokens = await tokensFor(client, connection)
        await provider.deleteCalendar(tokens, connection.externalCalendarId)
        remoteDeleted = true
      } catch {
        // A calendar we cannot reach is not a reason to keep the connection.
        remoteDeleted = false
      }
    }
  }

  await client.externalBusySlot.deleteMany({ where: { connectionId: connection.id } })
  await client.calendarEventMap.deleteMany({ where: { connectionId: connection.id } })
  await client.calendarConnection.delete({ where: { id: connection.id } })

  await revokeConsent(client, {
    userId: connection.userId,
    scope: `calendar.write.${connection.provider}` as ConsentScope,
    ip: options.ip ?? null,
  })

  await writeAuditLog(client, {
    centerId: null,
    userId: connection.userId,
    entity: 'calendar_connection',
    entityId: connection.id,
    action: 'disconnect',
    before: { provider: connection.provider, calendarId: connection.externalCalendarId },
    after: { remoteDeleted },
    source: 'user',
    ip: options.ip ?? null,
  })

  return { remoteDeleted }
}
