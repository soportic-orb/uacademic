/**
 * Connecting a personal calendar.
 *
 * Three levels, and the screen behind these routes is honest about all three:
 * a subscription (works everywhere, refreshes when the client feels like it),
 * Microsoft Graph (the recommended one — the login is already Entra ID), and
 * Google (its own OAuth, and its subscriptions are too slow to rely on).
 *
 * The consent for writing into somebody's calendar is asked for **here**, not
 * at sign-in, and it is recorded with the version of what was agreed to (RGPD).
 */
import {
  CALENDAR_PROVIDERS,
  type CalendarProvider,
  CURRENT_CONSENT_VERSION,
  type ConsentScope,
  latencyFor,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { enqueueJob } from '../../jobs/worker.js'
import { providerClient, providerConfigured } from '../../services/calendar/providers.js'
import {
  type ConnectionRow,
  disconnect,
  encryptTokens,
  recordConsent,
  revokeConsent,
} from '../../services/calendar/sync.js'
import { requireUser } from '../../plugins/context.js'

const STATE_TTL_MS = 10 * 60_000

const providerSchema = z.enum(['microsoft', 'google'])

const patchSchema = z.object({
  /** Reading free/busy back is its own opt-in, with its own consent record. */
  busySyncEnabled: z.boolean(),
})

/**
 * The `state` parameter, signed so a callback cannot be replayed or aimed at
 * somebody else's account. It carries who started the flow and when.
 */
function signState(payload: string): string {
  return createHmac('sha256', env().SESSION_COOKIE_SECRET).update(payload).digest('base64url')
}

export function buildState(userId: string, provider: CalendarProvider): string {
  const payload = `${userId}.${provider}.${Date.now()}.${randomBytes(8).toString('hex')}`
  return `${Buffer.from(payload).toString('base64url')}.${signState(payload)}`
}

export function readState(state: string): { userId: string; provider: CalendarProvider } | null {
  const [encoded, signature] = state.split('.')
  if (!encoded || !signature) return null

  const payload = Buffer.from(encoded, 'base64url').toString('utf8')
  const expected = Buffer.from(signState(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

  const [userId, provider, issuedAt] = payload.split('.')
  if (!userId || !provider || !issuedAt) return null
  if (Date.now() - Number(issuedAt) > STATE_TTL_MS) return null
  if (provider !== 'microsoft' && provider !== 'google') return null

  return { userId, provider }
}

export function registerCalendarConnectionRoutes(app: FastifyInstance): void {
  /** What this installation can offer, and where each connection stands. */
  app.get('/api/v1/calendar/connections', async (request) => {
    const user = requireUser(request)

    const [connections, consents] = await Promise.all([
      prisma().calendarConnection.findMany({ where: { userId: user.userId } }),
      prisma().consentRecord.findMany({ where: { userId: user.userId, revokedAt: null } }),
    ])

    return {
      consentVersion: CURRENT_CONSENT_VERSION,
      providers: CALENDAR_PROVIDERS.map((provider) => {
        const connection = connections.find((entry) => entry.provider === provider)

        return {
          provider,
          configured: providerConfigured(provider),
          connected: Boolean(connection),
          status: connection?.status ?? null,
          calendarName: connection?.calendarName ?? null,
          lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
          lastBusySyncAt: connection?.lastBusySyncAt?.toISOString() ?? null,
          lastError: connection?.lastError ?? null,
          busySyncEnabled: connection?.busySyncEnabled ?? false,
          consentVersion: connection?.consentVersion ?? null,
          latency: latencyFor('api'),
        }
      }),
      consents: consents.map((consent) => ({
        scope: consent.scope,
        version: consent.version,
        grantedAt: consent.grantedAt.toISOString(),
      })),
      /** What a subscription can promise, per client. Shown as-is in the UI. */
      icsLatency: {
        apple: latencyFor('ics.apple'),
        outlook: latencyFor('ics.outlook'),
        google: latencyFor('ics.google'),
      },
    }
  })

  /**
   * Step one of the consent: a URL the browser is sent to. Nothing is stored
   * until the provider comes back — an abandoned consent leaves no trace.
   */
  app.post(
    '/api/v1/calendar/connections/:provider/authorize',
    async (request: FastifyRequest<{ Params: { provider: string } }>) => {
      const user = requireUser(request)
      const provider = parseWith(providerSchema, request.params.provider)

      const client = providerClient(provider)
      if (!client)
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'connections.errors.notConfigured')

      return {
        url: client.authorizeUrl({
          state: buildState(user.userId, provider),
          loginHint: user.email,
        }),
      }
    },
  )

  /**
   * Where the provider sends the browser back. It runs with the person's own
   * session — a top-level navigation carries the cookie — and the signed state
   * has to name that same person.
   */
  app.get(
    '/api/v1/calendar/connections/:provider/callback',
    async (
      request: FastifyRequest<{
        Params: { provider: string }
        Querystring: { code?: string; state?: string; error?: string }
      }>,
      reply,
    ) => {
      const user = requireUser(request)
      const provider = parseWith(providerSchema, request.params.provider)
      const app_url = env().APP_URL.replace(/\/$/, '')

      if (request.query.error || !request.query.code || !request.query.state) {
        return reply.redirect(`${app_url}/connections?error=${provider}`)
      }

      const state = readState(request.query.state)
      if (!state || state.provider !== provider || state.userId !== user.userId) {
        throw AppError.forbidden()
      }

      const client = providerClient(provider)
      if (!client)
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'connections.errors.notConfigured')

      const tokens = await client.exchangeCode(request.query.code)
      const encrypted = encryptTokens(tokens)

      const existing = await prisma().calendarConnection.findFirst({
        where: { userId: user.userId, provider },
      })

      const connection = await prisma().calendarConnection.upsert({
        where: { userId_provider: { userId: user.userId, provider } },
        create: {
          userId: user.userId,
          provider,
          accessTokenEnc: encrypted.accessTokenEnc,
          refreshTokenEnc: encrypted.refreshTokenEnc,
          expiresAt: encrypted.expiresAt,
          scopes: encrypted.scopes,
          status: 'active',
          consentAt: new Date(),
          consentVersion: CURRENT_CONSENT_VERSION,
        },
        update: {
          accessTokenEnc: encrypted.accessTokenEnc,
          // A provider that does not re-issue a refresh token keeps the old one.
          ...(encrypted.refreshTokenEnc ? { refreshTokenEnc: encrypted.refreshTokenEnc } : {}),
          expiresAt: encrypted.expiresAt,
          scopes: encrypted.scopes,
          status: 'active',
          lastError: null,
          consentAt: new Date(),
          consentVersion: CURRENT_CONSENT_VERSION,
        },
      })

      await recordConsent(prisma(), {
        userId: user.userId,
        scope: `calendar.write.${provider}` as ConsentScope,
        ip: request.ip,
        details: { scopes: encrypted.scopes },
      })

      await writeAuditLog(prisma(), {
        centerId: null,
        userId: user.userId,
        entity: 'calendar_connection',
        entityId: connection.id,
        action: existing ? 'reconnect' : 'connect',
        before: existing ? { status: existing.status } : null,
        after: { provider, status: 'active' },
        source: 'user',
        ip: request.ip,
      })

      // The first synchronisation is queued, not run: the browser is waiting.
      await enqueueJob(prisma(), 'calendar.sync', {
        userId: user.userId,
        reason: 'connect',
      })

      return reply.redirect(`${app_url}/connections?connected=${provider}`)
    },
  )

  app.patch(
    '/api/v1/calendar/connections/:provider',
    async (request: FastifyRequest<{ Params: { provider: string } }>) => {
      const user = requireUser(request)
      const provider = parseWith(providerSchema, request.params.provider)
      const input = parseWith(patchSchema, request.body)

      const connection = await prisma().calendarConnection.findFirst({
        where: { userId: user.userId, provider },
      })
      if (!connection) throw AppError.notFound()

      await prisma().calendarConnection.update({
        where: { id: connection.id },
        data: {
          busySyncEnabled: input.busySyncEnabled,
          syncDirection: input.busySyncEnabled ? 'both' : 'push',
          // Turning it off drops the cursor: the next opt-in starts clean.
          ...(input.busySyncEnabled ? {} : { syncToken: null }),
        },
      })

      if (input.busySyncEnabled) {
        await recordConsent(prisma(), {
          userId: user.userId,
          scope: 'calendar.busy.read',
          ip: request.ip,
          details: { provider, reads: ['start', 'end'] },
        })
        await enqueueJob(prisma(), 'calendar.busy.pull', { connectionId: connection.id })
      } else {
        await revokeConsent(prisma(), {
          userId: user.userId,
          scope: 'calendar.busy.read',
          ip: request.ip,
        })
        // Consent withdrawn means the data goes, not just the switch.
        await prisma().externalBusySlot.deleteMany({ where: { connectionId: connection.id } })
      }

      await writeAuditLog(prisma(), {
        centerId: null,
        userId: user.userId,
        entity: 'calendar_connection',
        entityId: connection.id,
        action: 'busy_sync',
        before: { busySyncEnabled: connection.busySyncEnabled },
        after: { busySyncEnabled: input.busySyncEnabled },
        source: 'user',
        ip: request.ip,
      })

      return { provider, busySyncEnabled: input.busySyncEnabled }
    },
  )

  /** A synchronisation on demand, for the person who cannot wait for the queue. */
  app.post(
    '/api/v1/calendar/connections/:provider/sync',
    async (request: FastifyRequest<{ Params: { provider: string } }>) => {
      const user = requireUser(request)
      const provider = parseWith(providerSchema, request.params.provider)

      const connection = await prisma().calendarConnection.findFirst({
        where: { userId: user.userId, provider },
      })
      if (!connection) throw AppError.notFound()

      await enqueueJob(prisma(), 'calendar.sync', {
        userId: user.userId,
        connectionId: connection.id,
        reason: 'manual',
      })

      return { queued: true }
    },
  )

  app.delete(
    '/api/v1/calendar/connections/:provider',
    async (
      request: FastifyRequest<{
        Params: { provider: string }
        Querystring: { deleteRemote?: string }
      }>,
    ) => {
      const user = requireUser(request)
      const provider = parseWith(providerSchema, request.params.provider)

      const connection = await prisma().calendarConnection.findFirst({
        where: { userId: user.userId, provider },
      })
      if (!connection) throw AppError.notFound()

      const result = await disconnect(prisma(), connection as ConnectionRow, {
        deleteRemote: request.query.deleteRemote === 'true',
        ip: request.ip,
      })

      return { disconnected: true, remoteDeleted: result.remoteDeleted }
    },
  )
}
