import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'

import { type Env, corsOrigins, env as loadEnvironment } from './config/env.js'
import { InMemoryRealtimeBus, type RealtimeTransport } from './lib/realtime.js'
import { registerContext } from './plugins/context.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerCenterRoutes } from './modules/centers/routes.js'
import { registerEventRoutes } from './modules/events/routes.js'
import { registerHealthRoutes } from './modules/health/routes.js'
import { registerMeRoutes } from './modules/me/routes.js'
import { registerSubjectRoutes } from './modules/subjects/routes.js'
import { registerTeacherRoutes } from './modules/teachers/routes.js'

export interface BuildAppOptions {
  env?: Env
  bus?: RealtimeTransport
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnvironment()
  const bus = options.bus ?? new InMemoryRealtimeBus()

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log an identity or a token: the trace id is enough to correlate.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-mock-user"]'],
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  })

  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, {
    origin: corsOrigins(env.WEB_ORIGIN),
    credentials: true,
    allowedHeaders: [
      'content-type',
      'authorization',
      'accept-language',
      'x-center-id',
      'x-cross-center',
      'x-mock-user',
    ],
  })
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  })

  registerErrorHandler(app)
  registerContext(app)

  registerHealthRoutes(app)
  registerMeRoutes(app)
  registerCenterRoutes(app)
  registerTeacherRoutes(app)
  registerSubjectRoutes(app)
  registerEventRoutes(app, bus)

  app.decorate('realtime', bus)

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeTransport
  }
}
