/**
 * The application that runs when there is nothing to run yet.
 *
 * No database, no identity, no configuration — so none of the usual plugins
 * apply and none of the usual routes exist. It answers three calls from the
 * installer and a health check, and it is replaced by the real application as
 * soon as the operator restarts the process.
 *
 * Rate limiting is tighter here than anywhere else in the platform: this is an
 * unauthenticated endpoint that talks to a database, and the token is the only
 * thing between it and the internet.
 */
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'

import { registerErrorHandler } from '../../plugins/error-handler.js'
import { API_ONLY_CSP, WEB_APP_CSP, registerWebApp, webDistPath } from '../../plugins/web-app.js'
import { registerInstallRoutes } from './routes.js'

export interface InstallerOptions {
  logLevel?: string
}

export async function buildInstallerApp(options: InstallerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      name: 'installer',
      // A database password arrives in the body of one of these routes.
      redact: ['req.body.database.password', 'req.body.admin.password', 'req.body.token'],
    },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  })

  // Serving the wizard as well as answering it needs a policy that allows the
  // bundle to run; answering only, nothing at all.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: webDistPath() ? WEB_APP_CSP : API_ONLY_CSP },
  })

  // The wizard is served from the same origin by Nginx; during a local install
  // it may be the Vite dev server instead.
  await app.register(cors, {
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'accept-language'],
  })

  await app.register(rateLimit, { max: 30, timeWindow: 60_000 })

  const webRoot = await registerWebApp(app)

  registerErrorHandler(app)
  registerInstallRoutes(app)

  if (webRoot) app.log.info({ webRoot }, 'serving the installer page from the API')

  app.get('/health', async () => ({ status: 'setup', checks: { database: 'unknown' } }))

  return app
}
