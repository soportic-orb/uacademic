/**
 * What the queue actually does.
 *
 * Everything slow or flaky lives here rather than in a request: sending an
 * email, talking to a push service, expiring requests nobody answered and
 * building the daily digest. The queue is a MySQL table (CLAUDE.md §2), so the
 * retries and the backoff come for free — a handler's job is to be idempotent
 * and to fail loudly when it should be retried.
 */
import type { PrismaClient } from '@uacademic/db'
import {
  type AppLocale,
  type NotificationEvent,
  buildDigest,
  eventDefinition,
  hasExpired,
  isAppLocale,
  parseCenterSettings,
  translate,
} from '@uacademic/shared'
import type { Logger } from 'pino'

import { toJson } from '../lib/json.js'
import { type ConnectionRow, pullBusy, syncConnection } from '../services/calendar/sync.js'
import { purgeExpiredTombstones } from '../services/calendar/tombstones.js'
import { indexDocument } from '../services/documents/index-service.js'
import { invalidateVectorCache } from '../services/documents/retrieval.js'
import { sendMail } from '../services/mailer.js'
import { sendPush } from '../services/push.js'
import type { JobHandler } from './worker.js'

interface DeliveryPayload {
  channel?: 'push' | 'email'
  userId: string
  locale: string
  email: string
  title: string
  body: string
  url: string
  event: NotificationEvent
}

function localeOf(value: string): AppLocale {
  return isAppLocale(value) ? value : 'ca'
}

export function buildJobHandlers(client: PrismaClient, logger: Logger): Record<string, JobHandler> {
  return {
    'email.send': async (payload) => {
      const job = payload as DeliveryPayload
      const locale = localeOf(job.locale)

      const result = await sendMail({
        to: job.email,
        locale,
        subject: job.title,
        blocks: [{ title: job.title, body: job.body }],
        action: { label: translate(locale, 'email.openApp'), url: job.url },
      })

      if (result.simulated) {
        logger.info({ to: job.email, subject: job.title }, 'email.send: no SMTP host, logged only')
      }
    },

    'push.send': async (payload) => {
      const job = payload as DeliveryPayload
      const result = await sendPush(client, job.userId, {
        title: job.title,
        body: job.body,
        url: job.url,
        tag: job.event,
      })

      if (result.skipped) logger.info('push.send: VAPID keys are not configured')
      if (result.removed > 0) logger.info({ removed: result.removed }, 'pruned dead subscriptions')
    },

    /**
     * Requests nobody answered in time. Expiring them is a *system* action:
     * it is recorded as such (R4) and the people involved are told, because a
     * silent expiry is how a class ends up uncovered.
     */
    'changes.expire': async () => {
      const now = new Date()
      const open = await client.changeRequest.findMany({
        where: {
          status: { in: ['requested', 'accepted_by_teacher', 'approved_by_coordinator'] },
          expiresAt: { not: null, lte: now },
        },
        take: 200,
      })

      for (const request of open) {
        if (!hasExpired({ status: request.status, expiresAt: request.expiresAt }, now)) continue

        await client.changeRequest.update({
          where: { id: request.id },
          data: { status: 'expired', resolvedAt: now },
        })

        await client.auditLog.create({
          data: {
            centerId: request.centerId,
            userId: null,
            entity: 'change_request',
            entityId: request.id,
            action: 'expire',
            beforeJson: toJson({ status: request.status }),
            afterJson: toJson({ status: 'expired' }),
            source: 'system',
          },
        })

        const definition = eventDefinition('change.expired')
        const recipients = [request.requesterId, request.targetUserId].filter((id): id is string =>
          Boolean(id),
        )

        for (const userId of recipients) {
          const user = await client.user.findUnique({
            where: { id: userId },
            select: { locale: true },
          })
          if (!user || !definition) continue

          await client.notification.create({
            data: {
              centerId: request.centerId,
              userId,
              type: 'change.expired',
              payloadJson: toJson({
                event: 'change.expired',
                title: translate(user.locale, definition.titleKey, {}),
                body: translate(user.locale, definition.bodyKey, {}),
                url: `/changes/${request.id}`,
                changeRequestId: request.id,
              }),
            },
          })
        }
      }

      if (open.length > 0) logger.info({ expired: open.length }, 'change requests expired')
    },

    /**
     * One email a day with everything a person chose not to be interrupted
     * for. Sent per user in their own locale, and only when there is something
     * to say.
     */
    'notification.digest': async () => {
      const users = await client.user.findMany({
        where: { status: 'active' },
        select: { id: true, email: true, locale: true, digestSentAt: true },
      })

      for (const user of users) {
        const since = user.digestSentAt ?? new Date(Date.now() - 24 * 3600_000)

        const notifications = await client.notification.findMany({
          where: { userId: user.id, createdAt: { gt: since }, readAt: null },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })

        const digestable = notifications.filter((notification) => {
          const definition = eventDefinition(notification.type as NotificationEvent)
          return definition?.priority === 'low'
        })

        if (digestable.length === 0) continue

        const locale = localeOf(user.locale)
        const digest = buildDigest(
          locale,
          digestable.map((notification) => {
            const payload = notification.payloadJson as { title?: string; body?: string }
            return {
              event: notification.type as NotificationEvent,
              titleKey: payload.title ?? notification.type,
              bodyKey: payload.body ?? '',
              params: {},
              createdAt: notification.createdAt,
            }
          }),
        )

        await sendMail({
          to: user.email,
          locale,
          subject: translate(locale, 'email.digestSubject', { count: digestable.length }),
          blocks: digest.groups.map((group) => ({
            title: translate(locale, `notify.${group.event}.title`, {}),
            body: translate(locale, 'email.digestGroup', { count: group.count }),
            items: group.entries.map((entry) => entry.bodyKey).filter(Boolean),
          })),
          action: { label: translate(locale, 'email.openApp'), url: '/' },
        })

        await client.user.update({ where: { id: user.id }, data: { digestSentAt: new Date() } })
      }
    },
    /**
     * One person's calendars, brought in line with the timetable.
     *
     * The job is per user rather than per session on purpose: a publication
     * that moves thirty classes must cost one round of provider calls, not
     * thirty. Failures bubble up so the queue retries with backoff — except a
     * revoked consent, which `syncConnection` parks instead.
     */
    'calendar.sync': async (payload) => {
      const job = payload as { userId: string; connectionId?: string }

      const connections = await client.calendarConnection.findMany({
        where: {
          userId: job.userId,
          status: 'active',
          ...(job.connectionId ? { id: job.connectionId } : {}),
        },
      })

      for (const connection of connections) {
        const outcome = await syncConnection(client, connection as ConnectionRow)
        logger.info({ provider: connection.provider, ...outcome }, 'calendar.sync')
      }
    },

    /**
     * Free/busy in the other direction, for whoever opted in. Only start and
     * end are ever read, and the rows are short-lived by design.
     */
    'calendar.busy.pull': async (payload) => {
      const job = payload as { connectionId?: string }

      const connections = await client.calendarConnection.findMany({
        where: {
          status: 'active',
          busySyncEnabled: true,
          ...(job.connectionId ? { id: job.connectionId } : {}),
        },
      })

      for (const connection of connections) {
        const result = await pullBusy(client, connection as ConnectionRow)
        logger.info({ provider: connection.provider, ...result }, 'calendar.busy.pull')
      }
    },

    /**
     * A document, from a file to something the assistant can cite. It runs in
     * the worker because a 25 MB scan is not an HTTP request's business, and
     * because reading one with the model's vision takes minutes.
     */
    'documents.index': async (payload) => {
      const job = payload as { documentId: string; useOcr?: boolean }
      const result = await indexDocument(client, job.documentId, { useOcr: job.useOcr })

      const document = await client.document.findUnique({
        where: { id: job.documentId },
        select: { centerId: true },
      })
      if (document) invalidateVectorCache(document.centerId)

      logger.info({ documentId: job.documentId, ...result }, 'documents.index')
    },

    /**
     * Housekeeping: cancellations stop being announced once every client has
     * had time to read them, and borrowed busy time is not kept as history.
     */
    'calendar.purge': async () => {
      const tombstones = await purgeExpiredTombstones(client)

      const centers = await client.center.findMany({ select: { settingsJson: true } })
      const retentionDays = Math.max(
        1,
        ...centers.map(
          (center) => parseCenterSettings(center.settingsJson).calendar.busyRetentionDays,
        ),
      )
      const busy = await client.externalBusySlot.deleteMany({
        where: { fetchedAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
      })

      if (tombstones > 0 || busy.count > 0) {
        logger.info({ tombstones, busySlots: busy.count }, 'calendar.purge')
      }
    },
  }
}

export async function enqueuePeriodicJobs(client: PrismaClient): Promise<void> {
  const types = ['changes.expire', 'notification.digest', 'calendar.busy.pull', 'calendar.purge']

  for (const type of types) {
    const pending = await client.job.count({ where: { type, status: 'pending' } })
    if (pending > 0) continue

    const runAt = type === 'notification.digest' ? nextDigestRun(client) : new Date()
    await client.job.create({
      data: { type, payloadJson: toJson({}), runAt: await runAt },
    })
  }
}

/** The center's own digest hour, in its own timezone (R9). */
async function nextDigestRun(client: PrismaClient): Promise<Date> {
  const center = await client.center.findFirst()
  const settings = parseCenterSettings(center?.settingsJson)

  const next = new Date()
  next.setUTCMinutes(0, 0, 0)
  if (next.getUTCHours() >= settings.notifications.digestHour) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  next.setUTCHours(settings.notifications.digestHour)
  return next
}
