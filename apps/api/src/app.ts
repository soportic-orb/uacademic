import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'

import { type Env, corsOrigins, env as loadEnvironment } from './config/env.js'
import { InMemoryRealtimeBus, type RealtimeTransport } from './lib/realtime.js'
import { registerContext } from './plugins/context.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerAdminResources } from './modules/admin/resources.js'
import { registerUserRoutes } from './modules/admin/users-routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { registerCenterRoutes } from './modules/centers/routes.js'
import { registerImportRoutes } from './modules/imports/routes.js'
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
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-mock-user"]',
        // The Entra access token arrives in the body of the sign-in route.
        'req.body.accessToken',
        'req.body.password',
      ],
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
  await app.register(cookie, { secret: env.SESSION_COOKIE_SECRET })
  await app.register(multipart, {
    limits: { fileSize: env.IMPORT_MAX_FILE_MB * 1024 * 1024, files: 1 },
  })

  registerErrorHandler(app)
  registerContext(app, env)

  registerHealthRoutes(app)
  registerAuthRoutes(app, env)
  registerMeRoutes(app)
  registerCenterRoutes(app)
  registerTeacherRoutes(app)
  registerSubjectRoutes(app)
  registerEventRoutes(app, bus)
  registerAdminResources(app)
  registerUserRoutes(app)
  registerImportRoutes(app, env)

  app.decorate('realtime', bus)

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeTransport
  }
}
