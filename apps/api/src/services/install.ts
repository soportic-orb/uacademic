/**
 * Installing the platform from a browser.
 *
 * The dangerous part of a web installer is not writing a file: it is that for
 * a few minutes there is a public endpoint that can point the application at a
 * database and create an administrator. So three things hold at all times.
 *
 * **It exists only before an installation.** The moment a configuration file
 * with a database URL is on disk, every route here answers 410. There is no
 * flag to turn it back on and no "reinstall" — a second install would be a
 * takeover, and recovering a broken configuration is an SSH job.
 *
 * **It is authenticated by the filesystem.** On first boot the API writes a
 * one-time token next to where the configuration will go and prints it in the
 * log. Whoever can read that file is whoever controls the server; anybody who
 * merely found the URL cannot proceed. The token is compared in constant time
 * and dies with the installation.
 *
 * **It writes secrets rather than asking for them.** The session secret and
 * the encryption key are generated here, with the same primitives the rest of
 * the platform uses, because a human choosing a 32-byte key by hand is how
 * installations end up with `changeme` in production.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPrismaClient } from '@uacademic/db'
import { defaultCenterSettings } from '@uacademic/shared'

import { envFilePath } from '../config/env-file.js'
import { hashPassword } from '../lib/password.js'

export interface DatabaseInput {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export interface InstallInput {
  token: string
  database: DatabaseInput
  site: {
    /** Public address of the platform, e.g. `https://uacademic.cat`. */
    url: string
    locale: 'ca' | 'es' | 'en'
    timezone: string
  }
  organisation: {
    university: string
    center: string
    centerCode: string
    /** Optional at install time; tenants can be registered later from the UI. */
    entraTenantId?: string | null
    entraClientId?: string | null
  }
  admin: {
    email: string
    firstName: string
    lastName: string
    password: string
  }
}

export interface InstallState {
  installed: boolean
  /** Where the configuration will be written, so a failure can be diagnosed. */
  envFile: string
  envDirectoryWritable: boolean
  nodeVersion: string
  /** Only ever `true`/`false`: the token itself is never sent to a browser. */
  tokenReady: boolean
}

/* ────────────────────────────── the state ───────────────────────────────── */

/**
 * Installed means: a configuration file exists and names a database. Not "the
 * tables are there" — a half-migrated database is a recovery job, and letting
 * the installer loose on it would make it worse.
 */
export async function readState(source: NodeJS.ProcessEnv = process.env): Promise<InstallState> {
  const envFile = envFilePath(source)
  const directory = dirname(envFile)

  let installed = false
  if (existsSync(envFile)) {
    const contents = await readFile(envFile, 'utf8').catch(() => '')
    installed = /^\s*UACADEMIC_DATABASE_URL\s*=\s*\S+/m.test(contents)
  }

  return {
    installed,
    envFile,
    envDirectoryWritable: existsSync(directory),
    nodeVersion: process.version,
    tokenReady: existsSync(tokenPath(source)),
  }
}

export function tokenPath(source: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(envFilePath(source)), 'install.token')
}

/**
 * Creates the token if there is none, and returns it for the log. Called once
 * at boot, only while the platform is uninstalled.
 */
export async function ensureInstallToken(source: NodeJS.ProcessEnv = process.env): Promise<string> {
  const path = tokenPath(source)

  if (existsSync(path)) {
    const existing = (await readFile(path, 'utf8')).trim()
    if (existing.length >= 16) return existing
  }

  const token = randomBytes(24).toString('base64url')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${token}\n`, { mode: 0o600 })
  await chmod(path, 0o600).catch(() => undefined)

  return token
}

export async function tokenMatches(
  candidate: string,
  source: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const path = tokenPath(source)
  if (!existsSync(path)) return false

  const expected = Buffer.from((await readFile(path, 'utf8')).trim())
  const given = Buffer.from(candidate.trim())

  // Same length first: `timingSafeEqual` throws otherwise, and the length of a
  // token is not a secret worth protecting.
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

/* ───────────────────────────── the database ─────────────────────────────── */

export function databaseUrl(input: DatabaseInput): string {
  // Everything is percent-encoded: passwords with `@`, `/` or `#` are common
  // and a URL that silently truncates at one of them is a bad first hour.
  const user = encodeURIComponent(input.user)
  const password = encodeURIComponent(input.password)
  const host = input.host.includes(':') ? `[${input.host}]` : input.host

  return `mysql://${user}:${password}@${host}:${input.port}/${encodeURIComponent(input.database)}`
}

export interface DatabaseCheck {
  ok: boolean
  /** An error a person can act on, as an i18n key. */
  errorKey?: string
  detail?: string
  charset?: string
  collation?: string
  /** True when the schema already holds tables: installing over them is refused. */
  hasTables?: boolean
}

/** Eight seconds is generous for a local socket and short enough to act on. */
const CONNECT_TIMEOUT_MS = 8_000
const TCP_TIMEOUT_MS = 3_000

/**
 * Is anything listening at all?
 *
 * Worth asking separately: a refused login and an unreachable host both look
 * like a hung connection from the driver, and sending somebody to check their
 * firewall when the password is wrong wastes an afternoon.
 */
function probeTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (reachable: boolean) => {
      socket.destroy()
      resolve(reachable)
    }

    socket.setTimeout(TCP_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function withTimeout<T>(work: Promise<T>, ms = CONNECT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('connect: timed out')), ms).unref(),
    ),
  ])
}

/**
 * Connects, and reports what it found rather than just yes or no.
 *
 * Bounded on purpose: a wrong host is the commonest thing to type into this
 * form, and the driver would otherwise keep retrying while somebody watches a
 * spinner and learns nothing.
 */
export async function checkDatabase(input: DatabaseInput): Promise<DatabaseCheck> {
  if (!(await probeTcp(input.host, input.port))) {
    return {
      ok: false,
      errorKey: 'installer.errors.databaseUnreachable',
      detail: `no answer from ${input.host}:${input.port}`,
    }
  }

  // Connected to `information_schema`, which always exists, so that "the
  // server is unreachable", "these credentials are wrong" and "that schema is
  // not there" come back as three different answers instead of one timeout.
  const client = createPrismaClient(databaseUrl({ ...input, database: 'information_schema' }))

  try {
    const rows = await withTimeout(
      client.$queryRawUnsafe<{ charset: string; collation: string }[]>(
        `SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation
           FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
        input.database,
      ),
    )

    if (rows.length === 0) {
      return { ok: false, errorKey: 'installer.errors.databaseMissing' }
    }

    const tables = await withTimeout(
      client.$queryRawUnsafe<{ count: bigint | number }[]>(
        `SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
        input.database,
      ),
    )
    const count = Number(tables[0]?.count ?? 0)

    const charset = rows[0]?.charset ?? ''
    const collation = rows[0]?.collation ?? ''

    return {
      ok: true,
      charset,
      collation,
      hasTables: count > 0,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return {
      ok: false,
      // The port answered, so a hung handshake here is the login being
      // refused far more often than the network.
      errorKey: /access denied|not allowed to connect|using password/i.test(message)
        ? 'installer.errors.databaseAccess'
        : /unknown database|does not exist/i.test(message)
          ? 'installer.errors.databaseMissing'
          : /timed out|etimedout/i.test(message)
            ? 'installer.errors.databaseAccess'
            : /econnrefused|enotfound|connect/i.test(message)
              ? 'installer.errors.databaseUnreachable'
              : 'installer.errors.databaseFailed',
      // The driver's own words, which usually name the real problem. No
      // password can appear here: it is not part of the message.
      detail: message.slice(0, 300),
    }
  } finally {
    await client.$disconnect().catch(() => undefined)
  }
}

/* ─────────────────────────── writing the file ───────────────────────────── */

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function renderEnvFile(
  input: InstallInput,
  secrets: { session: string; encryption: string },
) {
  const url = input.site.url.replace(/\/+$/, '')
  const deployRoot = process.env.UACADEMIC_DEPLOY_ROOT ?? ''
  const uploads = deployRoot ? join(deployRoot, 'shared', 'uploads') : './var/uploads'
  const backups = deployRoot ? join(deployRoot, 'backups') : './var/backups'

  return [
    '# UAcademic — written by the installer. Keep it at mode 600.',
    '# Every name carries the UACADEMIC_ prefix: this host may run other apps,',
    '# and a neighbour’s SMTP_HOST is not ours to use.',
    '',
    'NODE_ENV=production',
    `UACADEMIC_DATABASE_URL=${quote(databaseUrl(input.database))}`,
    '',
    '# Generated here rather than chosen by hand. Rotating the session secret',
    '# signs everybody out; rotating the encryption key makes stored calendar',
    '# tokens unreadable and every user has to reconnect.',
    `UACADEMIC_SESSION_COOKIE_SECRET=${quote(secrets.session)}`,
    `UACADEMIC_APP_ENCRYPTION_KEY=${quote(secrets.encryption)}`,
    '',
    `UACADEMIC_WEB_ORIGIN=${quote(url)}`,
    `UACADEMIC_API_PUBLIC_URL=${quote(url)}`,
    `UACADEMIC_APP_URL=${quote(url)}`,
    'UACADEMIC_SESSION_COOKIE_SECURE="true"',
    '',
    '# Sign-in through Microsoft Entra ID. Until a client id is set the platform',
    '# runs on the local superadmin credential only.',
    `UACADEMIC_AUTH_MODE=${quote(input.organisation.entraClientId ? 'entra' : 'local')}`,
    `UACADEMIC_ENTRA_CLIENT_ID=${quote(input.organisation.entraClientId ?? '')}`,
    '',
    `UACADEMIC_UPLOAD_DIR=${quote(uploads)}`,
    `UACADEMIC_BACKUP_DIR=${quote(backups)}`,
    ...(deployRoot ? [`UACADEMIC_DEPLOY_ROOT=${quote(deployRoot)}`] : []),
    'UACADEMIC_HEALTH_CHECK_URL="http://127.0.0.1:3001/health"',
    '',
    '# Optional, and documented in .env.example: SMTP, web push, the assistant,',
    '# embeddings, calendar providers and over-the-air updates.',
    '',
  ].join('\n')
}

/* ──────────────────────────── the installation ──────────────────────────── */

export interface InstallResult {
  ok: boolean
  envFile?: string
  steps: { key: string; ok: boolean; detail?: string }[]
  errorKey?: string
}

/** Where `packages/db` lives, so the Prisma CLI can be run against it. */
export function databasePackageDir(source: NodeJS.ProcessEnv = process.env): string {
  if (source.UACADEMIC_DB_PACKAGE_DIR) return resolve(source.UACADEMIC_DB_PACKAGE_DIR)

  // From `apps/api/dist/services/` up to the workspace root.
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', '..', '..', '..', 'packages', 'db')
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env })
    const output: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    child.on('error', (error) => resolve({ ok: false, output: error.message }))
    child.on('close', (code) =>
      resolve({ ok: code === 0, output: Buffer.concat(output).toString().slice(-2_000) }),
    )
  })
}

/** `prisma migrate deploy` against the database the operator just gave us. */
export async function runMigrations(
  url: string,
  source: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; output: string }> {
  const cwd = databasePackageDir(source)
  const env = { ...process.env, UACADEMIC_DATABASE_URL: url }

  const attempts: [string, string[]][] = [
    ['pnpm', ['exec', 'prisma', 'migrate', 'deploy']],
    ['npx', ['--yes', 'prisma@7.9.1', 'migrate', 'deploy']],
  ]

  let last = { ok: false, output: 'no migration runner available' }
  for (const [command, args] of attempts) {
    last = await run(command, args, { cwd, env })
    if (last.ok) return last
  }

  return last
}

/**
 * The whole thing, in the order that lets each step fail without leaving a
 * mess behind: check, migrate, create the first people, and only then write
 * the file that turns this endpoint off.
 */
export async function install(
  input: InstallInput,
  hooks: {
    migrate?: (url: string) => Promise<{ ok: boolean; output: string }>
    bootstrap?: (url: string, input: InstallInput) => Promise<void>
  } = {},
  source: NodeJS.ProcessEnv = process.env,
): Promise<InstallResult> {
  const steps: InstallResult['steps'] = []
  const url = databaseUrl(input.database)

  const check = await checkDatabase(input.database)
  steps.push({ key: 'database', ok: check.ok, ...(check.detail ? { detail: check.detail } : {}) })
  if (!check.ok) {
    return { ok: false, steps, ...(check.errorKey ? { errorKey: check.errorKey } : {}) }
  }

  const migration = await (hooks.migrate ?? runMigrations)(url, source)
  steps.push({
    key: 'migrations',
    ok: migration.ok,
    ...(migration.ok ? {} : { detail: migration.output }),
  })
  if (!migration.ok) return { ok: false, steps, errorKey: 'installer.errors.migrationsFailed' }

  try {
    await (hooks.bootstrap ?? bootstrapInstallation)(url, input)
    steps.push({ key: 'organisation', ok: true })
  } catch (error) {
    steps.push({
      key: 'organisation',
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 300) : String(error),
    })
    return { ok: false, steps, errorKey: 'installer.errors.bootstrapFailed' }
  }

  const secrets = {
    session: randomBytes(32).toString('base64url'),
    encryption: randomBytes(32).toString('hex'),
  }

  const envFile = envFilePath(source)
  try {
    await mkdir(dirname(envFile), { recursive: true })
    await writeFile(envFile, renderEnvFile(input, secrets), { mode: 0o600 })
    await chmod(envFile, 0o600).catch(() => undefined)
    steps.push({ key: 'configuration', ok: true })
  } catch (error) {
    steps.push({
      key: 'configuration',
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 300) : String(error),
    })
    return { ok: false, steps, errorKey: 'installer.errors.configurationFailed' }
  }

  // The token is spent. Even if the file above were removed by hand, the next
  // attempt would need a fresh one from the server's own log.
  await writeFile(tokenPath(source), '', { mode: 0o600 }).catch(() => undefined)

  return { ok: true, envFile, steps }
}

/**
 * The first university, center, tenant and superadmin — the same thing
 * `packages/db`'s bootstrap script does, run in-process so a browser install
 * needs no shell.
 */
export async function bootstrapInstallation(url: string, input: InstallInput): Promise<void> {
  const client = createPrismaClient(url)

  try {
    if (input.organisation.entraTenantId) {
      await client.entraTenant.upsert({
        where: { tenantId: input.organisation.entraTenantId },
        create: {
          tenantId: input.organisation.entraTenantId,
          displayName: input.organisation.university,
          issuer: `https://login.microsoftonline.com/${input.organisation.entraTenantId}/v2.0`,
          status: 'active',
        },
        update: { status: 'active' },
      })
    }

    const university =
      (await client.university.findFirst({ where: { name: input.organisation.university } })) ??
      (await client.university.create({ data: { name: input.organisation.university } }))

    const code = input.organisation.centerCode.toUpperCase()
    const center =
      (await client.center.findFirst({ where: { universityId: university.id, code } })) ??
      (await client.center.create({
        data: {
          universityId: university.id,
          name: input.organisation.center,
          code,
          timezone: input.site.timezone,
          localeDefault: input.site.locale,
          entraTenantId: input.organisation.entraTenantId ?? null,
          settingsJson: defaultCenterSettings as never,
        },
      }))

    if (!center.settingsVersionId) {
      const version = await client.centerSettingsVersion.create({
        data: {
          centerId: center.id,
          settingsJson: defaultCenterSettings as never,
          source: 'manual',
          notes: 'Initial configuration (platform defaults).',
        },
      })
      await client.center.update({
        where: { id: center.id },
        data: { settingsVersionId: version.id },
      })
    }

    const user = await client.user.upsert({
      where: { email: input.admin.email.toLowerCase() },
      create: {
        email: input.admin.email.toLowerCase(),
        firstName: input.admin.firstName,
        lastName: input.admin.lastName,
        locale: input.site.locale,
        status: 'active',
      },
      update: { status: 'active' },
    })

    await client.userCenterRole.upsert({
      where: {
        userId_centerId_role: { userId: user.id, centerId: center.id, role: 'SUPERADMIN' },
      },
      create: { userId: user.id, centerId: center.id, role: 'SUPERADMIN' },
      update: {},
    })

    // The break-glass credential. Everybody else signs in through Entra ID,
    // but on the first day nobody has done that yet — and when Entra is down,
    // somebody still has to be able to get in.
    //
    // Password only: a second factor is enrolled deliberately, later, and an
    // unconfirmed secret written here would be a secret nobody chose.
    const passwordHash = await hashPassword(input.admin.password)
    const existing = await client.localCredential.findUnique({ where: { userId: user.id } })

    if (existing) {
      await client.localCredential.update({ where: { userId: user.id }, data: { passwordHash } })
    } else {
      await client.localCredential.create({ data: { userId: user.id, passwordHash } })
    }
  } finally {
    await client.$disconnect().catch(() => undefined)
  }
}
