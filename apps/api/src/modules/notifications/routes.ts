/**
 * The notification centre: what a person was told, how they want to be told,
 * and the push subscription that makes the "how" possible.
 *
 * Preferences are per event and per channel, with a digest flag for the noisy
 * ones. The catalog they are built from lives in `@uacademic/shared`, so a new
 * event appears here the moment it is defined, with sensible defaults rather
 * than silence.
 */
import {
  NOTIFICATION_EVENTS,
  defaultPreference,
  eventDefinition,
  type NotificationEvent,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { publicVapidKey, pushAvailable } from '../../services/push.js'
import { requireUser } from '../../plugins/context.js'

const listSchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

const preferenceSchema = z.object({
  event: z.string().min(1),
  inApp: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
  digest: z.boolean(),
})

const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(400).optional(),
})

export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/notifications', async (request) => {
    const user = requireUser(request)
    const query = parseWith(listSchema, request.query)

    const rows = await prisma().notification.findMany({
      where: { userId: user.userId, ...(query.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    })

    const unread = await prisma().notification.count({
      where: { userId: user.userId, readAt: null },
    })

    return {
      unread,
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payloadJson,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  })

  app.post(
    '/api/v1/notifications/:id/read',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = requireUser(request)
      const updated = await prisma().notification.updateMany({
        where: { id: request.params.id, userId: user.userId, readAt: null },
        data: { readAt: new Date() },
      })
      if (updated.count === 0) throw AppError.notFound()
      return reply.code(204).send()
    },
  )

  app.post('/api/v1/notifications/read-all', async (request, reply) => {
    const user = requireUser(request)
    await prisma().notification.updateMany({
      where: { userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    })
    return reply.code(204).send()
  })

  /** The full catalog, merged with whatever the user has chosen so far. */
  app.get('/api/v1/notifications/preferences', async (request) => {
    const user = requireUser(request)
    const stored = await prisma().notificationPref.findMany({ where: { userId: user.userId } })

    return {
      push: { available: pushAvailable(), publicKey: publicVapidKey() },
      items: NOTIFICATION_EVENTS.map((definition) => {
        const row = stored.find((entry) => entry.eventType === definition.event)
        const preference = row
          ? {
              event: definition.event,
              inApp: row.inApp,
              push: row.push,
              email: row.email,
              digest: row.digest,
            }
          : defaultPreference(definition)

        return {
          ...preference,
          priority: definition.priority,
          mandatory: definition.mandatory ?? [],
        }
      }),
    }
  })

  app.put('/api/v1/notifications/preferences', async (request) => {
    const user = requireUser(request)
    const input = parseWith(z.object({ items: z.array(preferenceSchema).max(50) }), request.body)

    for (const item of input.items) {
      const definition = eventDefinition(item.event as NotificationEvent)
      if (!definition) continue

      // A mandatory channel cannot be switched off, however the form arrives.
      const mandatory = definition.mandatory ?? []
      await prisma().notificationPref.upsert({
        where: { userId_eventType: { userId: user.userId, eventType: item.event } },
        create: {
          userId: user.userId,
          eventType: item.event,
          inApp: item.inApp || mandatory.includes('inApp'),
          push: item.push || mandatory.includes('push'),
          email: item.email || mandatory.includes('email'),
          digest: item.digest,
        },
        update: {
          inApp: item.inApp || mandatory.includes('inApp'),
          push: item.push || mandatory.includes('push'),
          email: item.email || mandatory.includes('email'),
          digest: item.digest,
        },
      })
    }

    return { updated: input.items.length }
  })

  /**
   * The browser subscribes after an explicit gesture (never on load, and on
   * iOS only from an installed PWA — the UI enforces that part).
   */
  app.post('/api/v1/notifications/push', async (request, reply) => {
    const user = requireUser(request)
    const input = parseWith(subscriptionSchema, request.body)
    const endpointHash = createHash('sha256').update(input.endpoint).digest('hex')

    await prisma().pushSubscription.upsert({
      where: { endpointHash },
      create: {
        userId: user.userId,
        endpoint: input.endpoint,
        endpointHash,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
      update: {
        userId: user.userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
    })

    return reply.code(201).send({ subscribed: true })
  })

  app.delete('/api/v1/notifications/push', async (request, reply) => {
    const user = requireUser(request)
    const input = parseWith(z.object({ endpoint: z.url() }), request.body)

    await prisma().pushSubscription.deleteMany({
      where: {
        userId: user.userId,
        endpointHash: createHash('sha256').update(input.endpoint).digest('hex'),
      },
    })

    return reply.code(204).send()
  })
}
