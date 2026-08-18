import { centerChannel, formatSseFrame, userChannel } from '../../lib/realtime.js'
import type { RealtimeEvent, RealtimeTransport } from '../../lib/realtime.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'
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
 *
 * Two channels travel together: the center's, which carries what everybody in
 * it may see, and the caller's own, which carries their notifications. The
 * client cannot ask for anybody else's — the subscription is derived from the
 * session, never from a parameter.
 */
export function registerEventRoutes(app: FastifyInstance, bus: RealtimeTransport): void {
  app.get('/api/v1/events/stream', async (request, reply) => {
    const { centerId } = requireCenterScope(request)
    const user = requireUser(request)
    const channels = [centerChannel(centerId), userChannel(user.userId)]

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(': connected\n\n')

    const unsubscribers = channels.map((channel) =>
      bus.subscribe(channel, (event) => {
        reply.raw.write(formatSseFrame(event))
      }),
    )

    // Nginx closes idle upstream connections; a comment every 25 s keeps the
    // stream alive without sending an event the client would have to handle.
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 25_000)

    request.raw.on('close', () => {
      clearInterval(keepAlive)
      for (const unsubscribe of unsubscribers) unsubscribe()
    })

    await reply
  })

  app.get('/api/v1/events/poll', async (request) => {
    const { centerId } = requireCenterScope(request)
    const user = requireUser(request)
    const { after } = parseWith(pollQuerySchema, request.query)

    // The sequence is process-wide, so merging two channels and sorting by id
    // gives the client exactly the order the events were published in.
    const events: RealtimeEvent[] = [
      ...bus.since(centerChannel(centerId), after),
      ...bus.since(userChannel(user.userId), after),
    ].sort((a, b) => a.id - b.id)

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
