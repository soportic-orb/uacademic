/**
 * The installer's HTTP surface.
 *
 * Registered on two different applications: the setup-mode one that runs when
 * there is no configuration yet, and the real one — where every route below
 * answers 410 and says so. That is deliberate: a browser that lands on
 * `/install` after the platform is up gets a clear "already installed" rather
 * than a form that quietly does nothing.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { AppError } from '../../lib/errors.js'
import { parseWith } from '../../lib/validate.js'
import {
  type InstallInput,
  checkDatabase,
  install,
  readState,
  tokenMatches,
} from '../../services/install.js'

const databaseSchema = z.object({
  host: z.string().trim().min(1).max(255).default('127.0.0.1'),
  port: z.coerce.number().int().min(1).max(65_535).default(3306),
  database: z
    .string()
    .trim()
    .min(1)
    .max(64)
    // MySQL identifiers, and nothing that could travel into a URL as syntax.
    .regex(/^[A-Za-z0-9_-]+$/, 'invalid database name'),
  user: z.string().trim().min(1).max(80),
  password: z.string().max(256),
})

const installSchema = z.object({
  token: z.string().min(16).max(200),
  database: databaseSchema,
  site: z.object({
    url: z.url(),
    locale: z.enum(['ca', 'es', 'en']).default('ca'),
    timezone: z.string().trim().min(1).max(64).default('Europe/Madrid'),
  }),
  organisation: z.object({
    university: z.string().trim().min(2).max(200),
    center: z.string().trim().min(2).max(200),
    centerCode: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/, 'invalid center code'),
    entraTenantId: z.uuid().nullish(),
    entraClientId: z.uuid().nullish(),
  }),
  admin: z.object({
    email: z.email(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(150),
    // Long rather than ornate: this one is typed once and then kept in a
    // password manager for the day Entra ID is down.
    password: z.string().min(12).max(200),
  }),
})

/**
 * On the running platform: the installer is over. Answering 410 rather than
 * 404 is the honest code — the resource existed and is deliberately gone.
 */
export function registerInstallDisabledRoutes(app: FastifyInstance): void {
  app.get('/api/v1/install/status', { config: { public: true } }, async () => ({
    installed: true,
    tokenReady: false,
  }))

  for (const path of ['/api/v1/install/database', '/api/v1/install/run']) {
    app.post(path, { config: { public: true } }, async () => {
      throw new AppError(410, 'GONE', 'installer.errors.alreadyInstalled')
    })
  }
}

/** In setup mode: the three calls the wizard makes, and nothing else. */
export function registerInstallRoutes(app: FastifyInstance): void {
  app.get('/api/v1/install/status', async () => {
    const state = await readState()

    // The path is useful to whoever is installing and useless to anybody
    // else; the token never travels.
    return {
      installed: state.installed,
      tokenReady: state.tokenReady,
      envFile: state.envFile,
      nodeVersion: state.nodeVersion,
    }
  })

  /** Tries the connection and reports what it found. Writes nothing. */
  app.post('/api/v1/install/database', async (request) => {
    const input = parseWith(
      z.object({ token: z.string().min(16).max(200), database: databaseSchema }),
      request.body,
    )

    if (!(await tokenMatches(input.token))) {
      throw new AppError(401, 'UNAUTHORIZED', 'installer.errors.badToken')
    }

    return checkDatabase(input.database)
  })

  /**
   * The installation itself. Runs migrations, creates the first center and
   * superadmin, writes the configuration, and takes this endpoint with it.
   */
  app.post('/api/v1/install/run', async (request, reply) => {
    const input = parseWith(installSchema, request.body)

    if (!(await tokenMatches(input.token))) {
      throw new AppError(401, 'UNAUTHORIZED', 'installer.errors.badToken')
    }

    const state = await readState()
    if (state.installed) {
      throw new AppError(410, 'GONE', 'installer.errors.alreadyInstalled')
    }

    const result = await install(input as InstallInput)

    if (!result.ok) {
      return reply.code(422).send(result)
    }

    request.log.info({ envFile: result.envFile }, 'installation completed')
    return result
  })
}
