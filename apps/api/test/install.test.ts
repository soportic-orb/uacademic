/**
 * The web installer.
 *
 * The tests worth having here are the refusals: a stranger who finds the URL
 * gets nowhere without the token on the server's disk, an installation cannot
 * be run twice, and the file that comes out has 600 on it and no secret an
 * operator had to invent.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { parse as parseEnvFile } from 'dotenv'
import type { FastifyInstance } from 'fastify'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadEnv } from '../src/config/env.js'
import { buildApp } from '../src/app.js'
import { buildInstallerApp } from '../src/modules/install/app.js'
import {
  databaseUrl,
  ensureInstallToken,
  install,
  readState,
  renderEnvFile,
} from '../src/services/install.js'
import { createTestApp, hasDatabase } from './helpers.js'

const DATABASE = {
  host: '127.0.0.1',
  port: 3306,
  database: 'uacademic',
  user: 'root',
  password: '',
}

const INPUT = {
  token: 'placeholder',
  database: DATABASE,
  site: { url: 'https://uacademic.cat', locale: 'ca' as const, timezone: 'Europe/Madrid' },
  organisation: {
    university: 'Universitat de Prova',
    center: 'Facultat de Prova',
    centerCode: 'FPT',
    entraTenantId: null,
    entraClientId: null,
  },
  admin: {
    email: 'installer-test@uacademic.cat',
    firstName: 'Aina',
    lastName: 'Prova',
    password: 'una-contrasenya-prou-llarga',
  },
}

describe('the installer', () => {
  let app: FastifyInstance
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'uacademic-install-'))
    process.env.UACADEMIC_ENV_FILE = join(directory, '.env')
    app = await buildInstallerApp({ logLevel: 'silent' })
  })

  afterEach(async () => {
    await app.close()
    delete process.env.UACADEMIC_ENV_FILE
  })

  describe('before anything is configured', () => {
    it('says the platform is not installed and where the file will go', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/install/status' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ installed: false, tokenReady: false })
      expect(response.json().envFile).toBe(join(directory, '.env'))
    })

    it('refuses a stranger who found the URL but not the token', async () => {
      await ensureInstallToken()

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/install/database',
        payload: { token: 'x'.repeat(32), database: DATABASE },
      })

      expect(response.statusCode).toBe(401)
    })

    it('writes a token only readable by the account that runs the server', async () => {
      const token = await ensureInstallToken()
      const info = await stat(join(directory, 'install.token'))

      expect(token.length).toBeGreaterThanOrEqual(24)
      expect(info.mode & 0o777).toBe(0o600)
      // Asking twice hands back the same one: a restart must not invalidate
      // the token an operator has already copied.
      expect(await ensureInstallToken()).toBe(token)
    })

    it('hands every cluster worker the same token', async () => {
      // PM2 starts the API with two instances, which boot together and each
      // ask for a token. If they generated one apiece, one worker would print
      // a token that opens nothing and the operator would copy it half the
      // time.
      const tokens = await Promise.all(Array.from({ length: 8 }, () => ensureInstallToken()))

      expect(new Set(tokens).size).toBe(1)
      expect(tokens[0]).toBe((await readFile(join(directory, 'install.token'), 'utf8')).trim())
    })
  })

  describe('once it is installed', () => {
    it('answers 410 rather than quietly doing nothing', async () => {
      await writeFile(join(directory, '.env'), 'UACADEMIC_DATABASE_URL="mysql://x@127.0.0.1/y"\n')

      const status = await app.inject({ method: 'GET', url: '/api/v1/install/status' })
      expect(status.json().installed).toBe(true)

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/install/run',
        payload: { ...INPUT, token: await ensureInstallToken() },
      })

      expect(response.statusCode).toBe(410)
    })
  })

  describe('the database URL it builds', () => {
    it('survives a password with the characters people actually use', () => {
      const url = databaseUrl({ ...DATABASE, user: 'ua ser', password: 'p@ss/w#rd:1' })

      // Parsed back, it is still the same credential — no silent truncation
      // at the first `@` or `/`.
      const parsed = new URL(url)
      expect(decodeURIComponent(parsed.username)).toBe('ua ser')
      expect(decodeURIComponent(parsed.password)).toBe('p@ss/w#rd:1')
      expect(parsed.pathname).toBe('/uacademic')
    })
  })

  describe('the configuration it writes', () => {
    const rendered = () =>
      renderEnvFile(INPUT, { session: 'a'.repeat(43), encryption: 'b'.repeat(64) })

    it('carries the secrets it generated, not ones a person chose', () => {
      const file = rendered()

      expect(file).toContain('UACADEMIC_SESSION_COOKIE_SECRET="aaa')
      expect(file).toContain('UACADEMIC_APP_ENCRYPTION_KEY="bbb')
      expect(file).toContain('NODE_ENV=production')
      expect(file).toContain('UACADEMIC_SESSION_COOKIE_SECURE="true"')
    })

    it('points the three public URLs at the address that was given', () => {
      const file = rendered()

      for (const name of ['WEB_ORIGIN', 'API_PUBLIC_URL', 'APP_URL']) {
        expect(file).toContain(`UACADEMIC_${name}="https://uacademic.cat"`)
      }
    })

    it('is a configuration the platform can actually boot on', () => {
      // The defect this stands guard over: the installer wrote a value the
      // API's own schema refused, so a brand-new installation came up on the
      // installer, completed, and then would not start.
      const env = loadEnv(parseEnvFile(rendered()))

      expect(env.AUTH_MODE).toBe('local')
      expect(env.NODE_ENV).toBe('production')
      expect(env.APP_ENCRYPTION_KEY).toBe('b'.repeat(64))
    })

    it('stays on local sign-in until an Entra client id exists', () => {
      expect(rendered()).toContain('UACADEMIC_AUTH_MODE="local"')

      const withEntra = renderEnvFile(
        {
          ...INPUT,
          organisation: {
            ...INPUT.organisation,
            entraClientId: '00000000-1111-2222-3333-444444444444',
          },
        },
        { session: 'a'.repeat(43), encryption: 'b'.repeat(64) },
      )
      expect(withEntra).toContain('UACADEMIC_AUTH_MODE="entra"')
    })
  })

  describe.skipIf(!hasDatabase)('against a real database', () => {
    const prisma = getPrismaClient()

    afterAll(async () => {
      await prisma.localCredential.deleteMany({
        where: { user: { email: INPUT.admin.email } },
      })
      await prisma.userCenterRole.deleteMany({ where: { user: { email: INPUT.admin.email } } })
      await prisma.user.deleteMany({ where: { email: INPUT.admin.email } })

      const center = await prisma.center.findFirst({ where: { code: 'FPT' } })
      if (center) {
        await prisma.settingProvenance.deleteMany({ where: { centerId: center.id } })
        await prisma.centerSettingsVersion.deleteMany({ where: { centerId: center.id } })
        await prisma.center.update({ where: { id: center.id }, data: { settingsVersionId: null } })
        await prisma.centerSettingsVersion.deleteMany({ where: { centerId: center.id } })
        await prisma.center.delete({ where: { id: center.id } })
      }
      await prisma.university.deleteMany({ where: { name: INPUT.organisation.university } })
      await disconnectPrisma()
    })

    it('reports what it found rather than just yes or no', async () => {
      const url = new URL(process.env.UACADEMIC_DATABASE_URL ?? '')
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/install/database',
        payload: {
          token: await ensureInstallToken(),
          database: {
            host: url.hostname,
            port: Number(url.port || 3306),
            database: url.pathname.slice(1),
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
          },
        },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().ok).toBe(true)
      expect(response.json().charset).toContain('utf8')
    })

    it('names a database that is not there instead of failing obscurely', async () => {
      const url = new URL(process.env.UACADEMIC_DATABASE_URL ?? '')
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/install/database',
        payload: {
          token: await ensureInstallToken(),
          database: {
            host: url.hostname,
            port: Number(url.port || 3306),
            database: 'uacademic_does_not_exist',
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
          },
        },
      })

      expect(response.json().ok).toBe(false)
      expect(response.json().errorKey).toBe('installer.errors.databaseMissing')
    })

    it('creates the first center and superadmin, and locks itself out', async () => {
      const url = new URL(process.env.UACADEMIC_DATABASE_URL ?? '')
      const database = {
        host: url.hostname,
        port: Number(url.port || 3306),
        database: url.pathname.slice(1),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      }

      const result = await install(
        { ...INPUT, database, token: await ensureInstallToken() },
        // The migrations already ran for this test database; what is under
        // test is everything around them.
        { migrate: async () => ({ ok: true, output: 'skipped' }) },
      )

      expect(result.ok).toBe(true)
      expect(result.steps.map((step) => step.key)).toEqual([
        'database',
        'migrations',
        'organisation',
        'configuration',
      ])

      const created = await prisma.user.findUniqueOrThrow({
        where: { email: INPUT.admin.email },
        include: { centerRoles: true, localCredential: true },
      })
      expect(created.centerRoles[0]?.role).toBe('SUPERADMIN')
      // A password to get in with when Entra ID is down, and no second factor
      // nobody chose.
      expect(created.localCredential?.passwordHash).toMatch(/^\$argon2id\$/)
      expect(created.localCredential?.totpConfirmedAt).toBeNull()

      const contents = await readFile(join(directory, '.env'), 'utf8')
      expect(contents).toContain('UACADEMIC_DATABASE_URL=')
      const info = await stat(join(directory, '.env'))
      expect(info.mode & 0o777).toBe(0o600)

      // And it is over: the state says installed and the token is spent.
      expect((await readState()).installed).toBe(true)
      expect((await readFile(join(directory, 'install.token'), 'utf8')).trim()).toBe('')
    })
  })
})

describe.skipIf(!hasDatabase)('the installed platform', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('says the installer is gone rather than pretending it is not there', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/v1/install/status' })
    expect(status.json()).toMatchObject({ installed: true })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/install/run',
      payload: { token: 'x'.repeat(32) },
    })
    expect(response.statusCode).toBe(410)
  })
})

describe.skipIf(!hasDatabase)('an installation with no Entra application yet', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'local',
        UACADEMIC_SESSION_COOKIE_SECRET: 'test-session-secret-that-is-long-enough',
      }),
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('says Microsoft sign-in is not configured instead of failing at the JWKS', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/entra/session',
      payload: { accessToken: 'anything' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.messageKey).toBe('auth.errors.entraNotConfigured')
  })
})
