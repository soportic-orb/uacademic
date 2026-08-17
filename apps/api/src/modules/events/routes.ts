import { centerChannel, formatSseFrame } from '../../lib/realtime.js'
import type { RealtimeTransport } from '../../lib/realtime.js'
import { requireCenterScope } from '../../plugins/context.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { parseWith } from '../../lib/validate.js'

const pollQuerySchema = z.object({
  /** Last event id the client already has; 0 means "everything buffered". */
  after: z.coerce.number().int().min(0).default(0),
})

/**
 * Realtime for hosts where WebSockets may be blocked: Server-Sent Events, with
 * a polling endpoint that returns the same events for clients (or proxies)
 * that cannot keep a stream open.
 */
export function registerEventRoutes(app: FastifyInstance, bus: RealtimeTransport): void {
  app.get('/api/v1/events/stream', async (request, reply) => {
    const { centerId } = requireCenterScope(request)
    const channel = centerChannel(centerId)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(': connected\n\n')

    const unsubscribe = bus.subscribe(channel, (event) => {
      reply.raw.write(formatSseFrame(event))
    })

    // Nginx closes idle upstream connections; a comment every 25 s keeps the
    // stream alive without sending an event the client would have to handle.
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 25_000)

    request.raw.on('close', () => {
      clearInterval(keepAlive)
      unsubscribe()
    })

    await reply
  })

  app.get('/api/v1/events/poll', async (request) => {
    const { centerId } = requireCenterScope(request)
    const { after } = parseWith(pollQuerySchema, request.query)

    const events = bus.since(centerChannel(centerId), after)
    return {
      lastEventId: events.at(-1)?.id ?? after,
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    }
  })
}
