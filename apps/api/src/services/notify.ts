/**
 * Raising a notification.
 *
 * One entry point for the whole product: `notify()` decides — with the pure
 * catalog in `@uacademic/shared` — which channels each recipient actually
 * gets, writes the in-app row immediately, pushes it over SSE so an open tab
 * updates itself, and queues push and email as jobs so a slow SMTP server
 * never delays an HTTP response.
 *
 * The text is resolved per recipient, in the locale stored on their profile
 * (R1). Nobody is notified in the language of whoever triggered the event.
 */
import type { PrismaClient } from '@uacademic/db'
import {
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPreference,
  eventDefinition,
  parseCenterSettings,
  planDelivery,
  translate,
} from '@uacademic/shared'

import { env } from '../config/env.js'
import { toJson } from '../lib/json.js'
import { type RealtimeTransport, userChannel } from '../lib/realtime.js'

export interface NotifyRecipient {
  userId: string
  /** Values interpolated into the title and the body, per recipient. */
  params?: Record<string, string | number>
}

export interface NotifyInput {
  client: PrismaClient
  bus?: RealtimeTransport | undefined
  centerId: string | null
  event: NotificationEvent
  recipients: readonly NotifyRecipient[]
  /** Shared interpolation values; a recipient's own params win. */
  params?: Record<string, string | number>
  /** Path inside the app the notification links to. */
  url?: string
  /** Extra data the in-app payload carries (a diff, a request id…). */
  data?: Record<string, unknown>
}

export interface NotifyResult {
  notified: number
  queued: { push: number; email: number }
  deferred: number
}

function preferenceFor(
  rows: { eventType: string; inApp: boolean; push: boolean; email: boolean; digest: boolean }[],
  event: NotificationEvent,
): NotificationPreference | undefined {
  const row = rows.find((entry) => entry.eventType === event)
  if (!row) return undefined
  return {
    event,
    inApp: row.inApp,
    push: row.push,
    email: row.email,
    digest: row.digest,
  }
}

/**
 * Sends one event to a set of people. Recipients that do not exist, or that
 * the event does not apply to, are skipped silently: a notification is never
 * worth failing a business operation for.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const definition = eventDefinition(input.event)
  if (!definition || input.recipients.length === 0) {
    return { notified: 0, queued: { push: 0, email: 0 }, deferred: 0 }
  }

  const userIds = [...new Set(input.recipients.map((recipient) => recipient.userId))]

  const [users, preferences, subscriptions, center] = await Promise.all([
    input.client.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, locale: true },
    }),
    input.client.notificationPref.findMany({
      where: { userId: { in: userIds }, eventType: input.event },
    }),
    input.client.pushSubscription.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
    }),
    input.centerId
      ? input.client.center.findUnique({ where: { id: input.centerId } })
      : Promise.resolve(null),
  ])

  const settings = parseCenterSettings(center?.settingsJson)
  const result: NotifyResult = { notified: 0, queued: { push: 0, email: 0 }, deferred: 0 }

  for (const recipient of input.recipients) {
    const user = users.find((entry) => entry.id === recipient.userId)
    if (!user) continue

    const params = { ...(input.params ?? {}), ...(recipient.params ?? {}) }
    const locale = user.locale
    const title = translate(locale, definition.titleKey, params)
    const body = translate(locale, definition.bodyKey, params)

    const plan = planDelivery({
      event: input.event,
      preference: preferenceFor(
        preferences.filter((entry) => entry.userId === recipient.userId),
        input.event,
      ),
      hasPushSubscription: subscriptions.some((entry) => entry.userId === recipient.userId),
      hasEmail: Boolean(user.email),
      digestEnabled: settings.notifications.dailyDigest,
    })

    const payload = {
      event: input.event,
      title,
      body,
      url: input.url ?? null,
      params,
      ...(input.data ?? {}),
    }

    if (plan.channels.includes('inApp')) {
      await input.client.notification.create({
        data: {
          centerId: input.centerId,
          userId: recipient.userId,
          type: input.event,
          payloadJson: toJson(payload),
          channelsSent: toJson(plan.channels),
        },
      })
      input.bus?.publish(userChannel(recipient.userId), 'notification', payload)
      result.notified += 1
    }

    for (const channel of plan.channels.filter(
      (entry): entry is Exclude<NotificationChannel, 'inApp'> => entry !== 'inApp',
    )) {
      await queueDelivery(input.client, {
        channel,
        userId: recipient.userId,
        locale,
        email: user.email,
        title,
        body,
        url: absoluteUrl(input.url),
        event: input.event,
      })
      result.queued[channel] += 1
    }

    if (plan.deferToDigest) {
      // The bell already has it; the digest job picks unread low-priority rows.
      result.deferred += 1
    }
  }

  return result
}

function absoluteUrl(path?: string): string {
  const base = env().APP_URL.replace(/\/$/, '')
  if (!path) return base
  return path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`
}

interface DeliveryJob {
  channel: 'push' | 'email'
  userId: string
  locale: string
  email: string
  title: string
  body: string
  url: string
  event: NotificationEvent
}

/**
 * Push and email travel through the MySQL job queue: it already gives us
 * retries with backoff, and it keeps a flaky SMTP server out of the request
 * path (CLAUDE.md §2 — there is no Redis to lean on).
 */
async function queueDelivery(client: PrismaClient, job: DeliveryJob): Promise<void> {
  await client.job.create({
    data: {
      type: job.channel === 'push' ? 'push.send' : 'email.send',
      payloadJson: toJson(job),
    },
  })
}
