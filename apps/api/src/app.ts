import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'

import { type Env, corsOrigins, env as loadEnvironment, setEnv } from './config/env.js'
import { InMemoryRealtimeBus, type RealtimeTransport } from './lib/realtime.js'
import { registerContext } from './plugins/context.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerAdminResources } from './modules/admin/resources.js'
import { registerUserRoutes } from './modules/admin/users-routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { registerAbsenceRoutes } from './modules/absences/routes.js'
import { registerAuditRoutes } from './modules/audit/routes.js'
import { registerAiRoutes } from './modules/ai/routes.js'
import { registerDocumentRoutes } from './modules/documents/routes.js'
import { registerInstallDisabledRoutes } from './modules/install/routes.js'
import { registerPlatformRoutes } from './modules/platform/routes.js'
import { registerPrivacyRoutes } from './modules/privacy/routes.js'
import { registerSettingsRoutes } from './modules/settings/routes.js'
import { registerCalendarRoutes } from './modules/calendar/routes.js'
import { registerChangeRoutes } from './modules/changes/routes.js'
import { registerMessagingRoutes } from './modules/messaging/routes.js'
import { registerNotificationRoutes } from './modules/notifications/routes.js'
import { registerCenterRoutes } from './modules/centers/routes.js'
import { registerImportRoutes } from './modules/imports/routes.js'
import { registerEventRoutes } from './modules/events/routes.js'
import { registerHealthRoutes } from './modules/health/routes.js'
import { registerMeRoutes } from './modules/me/routes.js'
import { registerPlannerRoutes } from './modules/planner/routes.js'
import { registerSubjectRoutes } from './modules/subjects/routes.js'
import { registerTeacherRoutes } from './modules/teachers/routes.js'

export interface BuildAppOptions {
  env?: Env
  bus?: RealtimeTransport
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnvironment()
  // Services that read the configuration on their own (the mailer, the links
  // inside notifications) must see this app's environment, not the ambient one.
  setEnv(env)
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
    // A JSON body has no business being megabytes: uploads go through the
    // multipart routes, which have their own, larger limit.
    bodyLimit: 1024 * 1024,
  })

  await app.register(helmet, {
    // The API answers JSON and serves documents as attachments; it never
    // renders HTML, so the policy can be as narrow as it looks. The SPA is
    // served by Nginx and carries its own headers (see the deployment manual).
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only where there is TLS to insist on.
    hsts: env.NODE_ENV === 'production' ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  })
  await app.register(cors, {
    origin: corsOrigins(env.WEB_ORIGIN),
    credentials: true,
    // Spelled out: the browser preflight refuses anything not listed here, and
    // the admin screens use PATCH and DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
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
    // Behind Nginx every request arrives from the proxy, so the count has to
    // follow the person: the session cookie first, the forwarded address next.
    keyGenerator: (request) =>
      (request.cookies?.uacademic_session ?? '').slice(0, 32) || request.ip,
  })
  await app.register(cookie, { secret: env.SESSION_COOKIE_SECRET })
  await app.register(multipart, {
    // The document library allows larger files than a spreadsheet import, so
    // the ceiling here is the higher of the two and each route checks its own
    // limit against the center's settings before a byte is written.
    limits: {
      fileSize: Math.max(env.IMPORT_MAX_FILE_MB, 50) * 1024 * 1024,
      files: 1,
      fields: 30,
    },
  })

  registerErrorHandler(app)
  registerContext(app, env)

  registerHealthRoutes(app)
  registerInstallDisabledRoutes(app)
  registerAuthRoutes(app, env)
  registerMeRoutes(app)
  registerCenterRoutes(app)
  registerTeacherRoutes(app)
  registerSubjectRoutes(app)
  registerPlannerRoutes(app, bus)
  registerCalendarRoutes(app)
  registerChangeRoutes(app, bus)
  registerAbsenceRoutes(app, bus)
  registerMessagingRoutes(app, bus)
  registerNotificationRoutes(app)
  registerAuditRoutes(app)
  registerAiRoutes(app)
  registerDocumentRoutes(app)
  registerSettingsRoutes(app)
  registerPrivacyRoutes(app)
  registerPlatformRoutes(app)
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
