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
  type ExtractionBlock,
  type NotificationEvent,
  buildDigest,
  eventDefinition,
  hasExpired,
  isAppLocale,
  parseCenterSettings,
  translate,
} from '@uacademic/shared'
import type { Logger } from 'pino'

import { spawn } from 'node:child_process'

import { env } from '../config/env.js'
import { toJson } from '../lib/json.js'
import { scopedPrisma } from '../lib/prisma.js'
import { type ConnectionRow, pullBusy, syncConnection } from '../services/calendar/sync.js'
import { purgeExpiredTombstones } from '../services/calendar/tombstones.js'
import { indexDocument } from '../services/documents/index-service.js'
import { invalidateVectorCache } from '../services/documents/retrieval.js'
import { createBackup } from '../services/backup.js'
import { INVITATION_TTL_HOURS, PASSWORD_RESET_TTL_HOURS } from '../services/invitations.js'
import { buildSchedulePdf } from '../services/schedule-pdf.js'
import { sendMail } from '../services/mailer.js'
import { type ReleaseInfo, applyUpdate } from '../services/updates.js'
import { applyRetention } from '../services/privacy.js'
import { runExtractionBlock } from '../services/settings/extraction-run.js'
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

    /**
     * Telling somebody they now have an account.
     *
     * Its own type rather than a notification: nobody has preferences yet —
     * they have never signed in — so there is nothing to consult and nothing
     * to fall back to. It is the one email the platform sends to a person who
     * is not yet a user of it.
     */
    'user.invite': async (payload) => {
      const job = payload as {
        email: string
        locale: string
        firstName: string
        centerName: string
        url: string
      }
      const locale = localeOf(job.locale)

      const result = await sendMail({
        to: job.email,
        locale,
        subject: translate(locale, 'email.inviteSubject', { center: job.centerName }),
        blocks: [
          {
            title: translate(locale, 'email.inviteTitle', { name: job.firstName }),
            body: translate(locale, 'email.inviteBody', {
              center: job.centerName,
              days: Math.round(INVITATION_TTL_HOURS / 24),
            }),
          },
        ],
        action: { label: translate(locale, 'email.inviteAction'), url: job.url },
      })

      if (result.simulated) {
        logger.warn(
          { to: job.email },
          'user.invite: no SMTP host, the invitation was logged and not sent',
        )
      }
    },

    /**
     * The link somebody asked for after forgetting their password.
     *
     * Its own type rather than reusing the invitation: the subject line and
     * the sentence differ, and telling somebody they have been "given access"
     * when they asked to get back into an account they already have is the
     * kind of small wrongness that makes people distrust a mail.
     */
    'user.passwordReset': async (payload) => {
      const job = payload as {
        email: string
        locale: string
        firstName: string
        centerName: string
        url: string
      }
      const locale = localeOf(job.locale)

      const result = await sendMail({
        to: job.email,
        locale,
        subject: translate(locale, 'email.resetSubject'),
        blocks: [
          {
            title: translate(locale, 'email.resetTitle', { name: job.firstName }),
            body: translate(locale, 'email.resetBody', {
              hours: PASSWORD_RESET_TTL_HOURS,
            }),
          },
        ],
        action: { label: translate(locale, 'email.resetAction'), url: job.url },
      })

      if (result.simulated) {
        logger.warn(
          { to: job.email },
          'user.passwordReset: no SMTP host, the link was logged and not sent',
        )
      }
    },

    /**
     * A teacher's own timetable, printed and posted to them.
     *
     * Built here rather than in the request that asked for it: a center with
     * ninety lecturers is ninety documents, and a coordinator pressing send
     * should not be holding a connection open while they are drawn.
     */
    'teacher.schedule': async (payload) => {
      const job = payload as {
        teacherProfileId: string
        centerId: string
        email: string
        firstName: string
        locale: string
        from: string
        to: string
      }
      const locale = localeOf(job.locale)

      const pdf = await buildSchedulePdf(
        { centerId: job.centerId, db: scopedPrisma(client, job.centerId) },
        job.teacherProfileId,
        { from: job.from, to: job.to },
        locale,
      )

      const result = await sendMail({
        to: job.email,
        locale,
        subject: translate(locale, 'email.scheduleSubject'),
        blocks: [
          {
            title: translate(locale, 'email.scheduleTitle', { name: job.firstName }),
            body: translate(locale, 'email.scheduleBody', { from: job.from, to: job.to }),
          },
        ],
        attachments: [
          {
            filename: `uacademic-${job.from}.pdf`,
            content: pdf.buffer,
            contentType: 'application/pdf',
          },
        ],
      })

      if (result.simulated) {
        logger.warn(
          { to: job.email },
          'teacher.schedule: no SMTP host, the timetable was logged and not sent',
        )
      }
    },

    /**
     * Installing a release, from the one process the release does not reload.
     *
     * `applyUpdate` finishes with `pm2 reload uacademic`. Run from inside the
     * API that is being reloaded, that kills the procedure and everything it
     * spawned; run from here it is somebody else's problem, so the health
     * check and the rollback still have a process to happen in.
     */
    'platform.update': async (payload) => {
      const job = payload as { release: ReleaseInfo; userId: string; ip?: string | null }

      const result = await applyUpdate(client, {
        release: job.release,
        userId: job.userId,
        ip: job.ip ?? null,
      })

      logger.info({ version: result.version, status: result.status }, 'platform.update')

      if (result.status !== 'applied') return

      // And now this process, which is still running the previous release.
      // Detached and delayed: the restart must not arrive before this handler
      // returns, or the job stays locked and is retried as a stale one — which
      // would install the same release a second time.
      const configuration = env()
      const restart = spawn(
        'sh',
        [
          '-c',
          `sleep 10; ${JSON.stringify(configuration.PM2_PATH)} restart ${JSON.stringify(`${configuration.PM2_APP_NAME}-worker`)}`,
        ],
        { detached: true, stdio: 'ignore' },
      )
      restart.unref()
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
     * One block of one regulation, read into proposals.
     *
     * A block at a time, each retriable on its own: a model that returns
     * nothing usable for the categories should not cost the center the eight
     * parameters of the capacity block that came back fine.
     */
    'settings.extract': async (payload) => {
      const job = payload as { runId: string; block: ExtractionBlock }
      const result = await runExtractionBlock(client, job.runId, job.block)

      logger.info({ runId: job.runId, block: job.block, ...result }, 'settings.extract')
    },

    /**
     * The nightly backup. Kept close to the update procedure on purpose: the
     * same function runs before a deployment touches a migration.
     */
    'db.backup': async () => {
      const result = await createBackup()
      logger.info(
        { file: result.file, bytes: result.bytes, pruned: result.pruned.length },
        'db.backup',
      )
    },

    /**
     * Retention. Each center says how long it keeps an audit trail, a
     * notification, an assistant transcript; this is where saying it has an
     * effect. The audit log is INSERT-only, which is about nobody rewriting
     * history — not about keeping it for ever (R4).
     */
    'privacy.retention': async () => {
      const report = await applyRetention(client)
      logger.info(report, 'privacy.retention')
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
  const types = [
    'changes.expire',
    'notification.digest',
    'calendar.busy.pull',
    'calendar.purge',
    'privacy.retention',
    'db.backup',
  ]

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
