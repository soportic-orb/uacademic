/**
 * Web Push delivery (VAPID).
 *
 * Two things make push different from every other channel: a subscription can
 * die at any moment (the browser is cleared, the user uninstalls the PWA), and
 * on iOS it only exists inside an installed app. The first is handled here —
 * a 404 or 410 from the push service means the subscription is gone and the
 * row is deleted rather than retried forever. The second is handled in the UI.
 */
import type { PrismaClient } from '@uacademic/db'
import webpush from 'web-push'

import { env } from '../config/env.js'

let configured = false

export function pushAvailable(): boolean {
  const configuration = env()
  return Boolean(configuration.VAPID_PUBLIC_KEY && configuration.VAPID_PRIVATE_KEY)
}

export function publicVapidKey(): string | null {
  return env().VAPID_PUBLIC_KEY ?? null
}

function configure(): boolean {
  if (!pushAvailable()) return false
  if (configured) return true

  const configuration = env()
  webpush.setVapidDetails(
    configuration.VAPID_SUBJECT,
    configuration.VAPID_PUBLIC_KEY!,
    configuration.VAPID_PRIVATE_KEY!,
  )
  configured = true
  return true
}

export interface PushPayload {
  title: string
  body: string
  /** Where clicking the notification takes the reader. */
  url?: string
  tag?: string
}

export interface PushResult {
  sent: number
  removed: number
  skipped: boolean
}

/** Sends to every live subscription of one person, pruning the dead ones. */
export async function sendPush(
  client: PrismaClient,
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  if (!configure()) return { sent: 0, removed: 0, skipped: true }

  const subscriptions = await client.pushSubscription.findMany({ where: { userId } })
  let sent = 0
  let removed = 0

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      )
      sent += 1
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await client.pushSubscription.delete({ where: { id: subscription.id } })
        removed += 1
      } else {
        throw error
      }
    }
  }

  return { sent, removed, skipped: false }
}

export function resetPush(): void {
  configured = false
}
