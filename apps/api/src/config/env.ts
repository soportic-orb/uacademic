import { z } from 'zod'

import { loadEnvFile } from './env-file.js'

// Resolved rather than assumed: on a deployed host the file is `shared/.env`,
// reached through a symlink at the release root, while the working directory
// is `apps/api`.
loadEnvFile()

/**
 * R10: every secret and every environment-dependent value arrives here, is
 * validated once, and is never read from `process.env` again.
 *
 * Every name is read with the `UACADEMIC_` prefix and **only** with it. The
 * target hosting is a shared Plesk or CloudPanel server (CLAUDE.md §2), where
 * several applications live side by side with one environment between them:
 * a bare `SMTP_HOST` or `GOOGLE_CLIENT_ID` belonging to the neighbour would
 * otherwise be picked up silently, and UAcademic would post mail through
 * somebody else's server or offer somebody else's OAuth client. Names below
 * are the ones after the prefix is stripped.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Comma-separated list of allowed browser origins. */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  /**
   * AES-256-GCM key for calendar tokens at rest, 32 bytes hex-encoded.
   * Optional in phase 0 because no token is stored yet.
   */
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'APP_ENCRYPTION_KEY must be 32 bytes in hex')
    .optional(),

  /**
   * `entra` is the real thing. `mock` keeps the phase 0 header identity for
   * local development and the e2e suite; it is refused in production below.
   */
  AUTH_MODE: z.enum(['mock', 'entra']).default('entra'),
  /** Fallback identity for the mock mode when no header is sent. */
  MOCK_USER_EMAIL: z.string().optional(),

  /** Signs the session cookie. Rotating it invalidates every open session. */
  SESSION_COOKIE_SECRET: z
    .string()
    .min(32, 'SESSION_COOKIE_SECRET must be at least 32 characters')
    .default('development-only-session-secret-change-me'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(8),
  /** Cookies are Secure in production; plain HTTP localhost cannot use that. */
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),

  /**
   * Multi-tenant JWKS. The `/organizations` endpoint signs tokens for *every*
   * Microsoft organization, which is exactly why `tid` must be checked against
   * our registered tenants afterwards (R3).
   */
  ENTRA_JWKS_URI: z
    .url()
    .default('https://login.microsoftonline.com/organizations/discovery/v2.0/keys'),
  /** Our application (client) id — the expected `aud`. */
  ENTRA_CLIENT_ID: z.string().optional(),
  /** Extra accepted audiences, comma separated (e.g. `api://…`). */
  ENTRA_EXTRA_AUDIENCES: z.string().optional(),
  /**
   * Confidential-client secret, used only by the calendar consent flow: the
   * sign-in itself is a public-client flow and never needs it.
   */
  ENTRA_CLIENT_SECRET: z.string().optional(),
  /** Authority segment for the consent flow. `organizations` = any tenant. */
  ENTRA_AUTHORITY_TENANT: z.string().default('organizations'),

  /**
   * Google Calendar (level 3). Our own OAuth client, with a verification
   * process that takes weeks — see the README before switching it on.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * Public address of this API, used to build the OAuth redirect URIs and the
   * ICS subscription URL. It must match what is registered with each provider,
   * which is why it is configured rather than derived from a request header.
   */
  API_PUBLIC_URL: z.string().default('http://localhost:3001'),

  /**
   * Email (Nodemailer). Without a host the mailer logs what it would have
   * sent instead of failing: a development database must not need an SMTP
   * server to exercise the notification flow.
   */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('UAcademic <no-reply@example.edu>'),

  /** Web Push (VAPID). Push is simply unavailable when these are missing. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.edu'),

  /** Where the web app lives, for the links inside notifications. */
  APP_URL: z.string().default('http://localhost:5173'),

  /**
   * The assistant (phase 5). Without a key the AI panel degrades to a message
   * and every other screen carries on exactly as before — an integration that
   * takes the product down with it is not an integration worth having.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  /**
   * Embeddings for the document library (phase 5B). With none of these set the
   * hashed fallback is used and the hybrid search leans on the full-text half:
   * weaker, but installed everywhere and with nothing leaving the host.
   */
  EMBEDDING_MODEL_PATH: z.string().optional(),
  EMBEDDING_API_URL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('multilingual-e5-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(4_096).default(512),

  /** Message attachments live on disk; there is no object storage on the host. */
  UPLOAD_DIR: z.string().default('./var/uploads'),

  IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(100_000).default(5_000),
  IMPORT_MAX_FILE_MB: z.coerce.number().int().min(1).max(50).default(5),

  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(200).default(5_000),
  JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(5),

  /**
   * Backups (phase 6). `mysqldump` is spawned, so the path matters on a host
   * that keeps it somewhere unusual. Retention zero keeps everything, which is
   * a decision rather than a default.
   */
  BACKUP_DIR: z.string().default('./var/backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(0).max(3_650).default(14),
  MYSQLDUMP_PATH: z.string().default('mysqldump'),

  /**
   * Over-the-air updates (phase 6). The token reads a private repository's
   * releases and is only ever used server-side; without it the platform panel
   * says so and nothing else changes.
   */
  GITHUB_OTA_TOKEN: z.string().optional(),
  GITHUB_OTA_REPO: z.string().default('soportic-orb/uacademic'),
  /** Where releases are unpacked: `<dir>/releases/<version>`, `<dir>/current`. */
  DEPLOY_ROOT: z.string().default('/var/www/uacademic'),
  /** Read after a deployment to decide whether it stands or is rolled back. */
  HEALTH_CHECK_URL: z.string().default('http://127.0.0.1:3001/health'),
  /** The PM2 process group to reload once the symlink has moved. */
  PM2_APP_NAME: z.string().default('uacademic'),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
})

export type Env = z.infer<typeof envSchema>

/** Every variable this application reads carries it. Nothing else is read. */
export const ENV_PREFIX = 'UACADEMIC_'

/**
 * `NODE_ENV` is the one exception: it is a Node convention rather than an
 * application setting, and the tooling (vitest, tsx, PM2) sets it itself.
 */
const UNPREFIXED = ['NODE_ENV'] as const

const SCHEMA_KEYS = Object.keys(envSchema.shape)

/**
 * Picks this application's variables out of an environment that may belong to
 * several. `UACADEMIC_SMTP_HOST` is ours; `SMTP_HOST` is not, however tempting
 * it looks.
 */
export function scopeEnv(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const scoped: Record<string, string | undefined> = {}

  for (const key of SCHEMA_KEYS) {
    const value = (UNPREFIXED as readonly string[]).includes(key)
      ? source[key]
      : source[`${ENV_PREFIX}${key}`]

    if (value !== undefined) scoped[key] = value
  }

  return scoped
}

/**
 * Names another application on the same host may have set, which we are
 * deliberately ignoring. Reported once at boot so an operator who renamed only
 * half of their configuration finds out immediately rather than by noticing
 * that no email ever arrives.
 */
export function ignoredLegacyNames(source: NodeJS.ProcessEnv = process.env): string[] {
  return SCHEMA_KEYS.filter(
    (key) =>
      !(UNPREFIXED as readonly string[]).includes(key) &&
      source[key] !== undefined &&
      source[`${ENV_PREFIX}${key}`] === undefined,
  ).sort()
}

let cached: Env | undefined

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(scopeEnv(source))
  if (!parsed.success) {
    // Reported under the name an operator has to set, prefix included: being
    // told that "DATABASE_URL is required" would send them to the wrong one.
    const details = parsed.error.issues
      .map((issue) => {
        const key = String(issue.path[0] ?? '')
        const name = (UNPREFIXED as readonly string[]).includes(key)
          ? key
          : `${ENV_PREFIX}${key || '(root)'}`
        return `  - ${name}: ${issue.message}`
      })
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${details}`)
  }

  const env = parsed.data

  // Guards that a schema cannot express, checked once at boot rather than
  // discovered in production.
  if (env.NODE_ENV === 'production') {
    if (env.AUTH_MODE === 'mock') {
      throw new Error(
        `${ENV_PREFIX}AUTH_MODE=mock is refused in production: it accepts any identity by header.`,
      )
    }
    if (env.SESSION_COOKIE_SECRET.startsWith('development-only')) {
      throw new Error(`${ENV_PREFIX}SESSION_COOKIE_SECRET still holds its development default.`)
    }
    if (!env.APP_ENCRYPTION_KEY) {
      throw new Error(
        `${ENV_PREFIX}APP_ENCRYPTION_KEY is required in production: it encrypts TOTP secrets and calendar tokens.`,
      )
    }
  }

  if (env.AUTH_MODE === 'entra' && !env.ENTRA_CLIENT_ID) {
    throw new Error(
      `${ENV_PREFIX}ENTRA_CLIENT_ID is required when ${ENV_PREFIX}AUTH_MODE=entra: it is the expected audience.`,
    )
  }

  return env
}

export function acceptedAudiences(env: Env): string[] {
  return [env.ENTRA_CLIENT_ID, ...(env.ENTRA_EXTRA_AUDIENCES ?? '').split(',')]
    .map((audience) => audience?.trim())
    .filter((audience): audience is string => Boolean(audience && audience.length > 0))
}

/**
 * The configuration the running app was built with.
 *
 * `buildApp` publishes its own environment here so that a service reaching for
 * `env()` — the mailer, the notification links — sees the same values the app
 * was given rather than re-reading `process.env`. Without this, an app built
 * with an injected configuration (every test, and the e2e runner) would parse
 * the ambient environment again and fail on rules that do not apply to it.
 */
export function setEnv(value: Env): void {
  cached = value
}

export function env(): Env {
  cached ??= loadEnv()
  return cached
}

export function corsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}
