import 'dotenv/config'

import { z } from 'zod'

/**
 * R10: every secret and every environment-dependent value arrives here, is
 * validated once, and is never read from `process.env` again.
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
  ENTRA_JWKS_URI: z.url().default('https://login.microsoftonline.com/organizations/discovery/v2.0/keys'),
  /** Our application (client) id — the expected `aud`. */
  ENTRA_CLIENT_ID: z.string().optional(),
  /** Extra accepted audiences, comma separated (e.g. `api://…`). */
  ENTRA_EXTRA_AUDIENCES: z.string().optional(),

  IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(100_000).default(5_000),
  IMPORT_MAX_FILE_MB: z.coerce.number().int().min(1).max(50).default(5),

  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(200).default(5_000),
  JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(5),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | undefined

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${details}`)
  }

  const env = parsed.data

  // Guards that a schema cannot express, checked once at boot rather than
  // discovered in production.
  if (env.NODE_ENV === 'production') {
    if (env.AUTH_MODE === 'mock') {
      throw new Error('AUTH_MODE=mock is refused in production: it accepts any identity by header.')
    }
    if (env.SESSION_COOKIE_SECRET.startsWith('development-only')) {
      throw new Error('SESSION_COOKIE_SECRET still holds its development default.')
    }
    if (!env.APP_ENCRYPTION_KEY) {
      throw new Error('APP_ENCRYPTION_KEY is required in production: TOTP secrets are stored with it.')
    }
  }

  if (env.AUTH_MODE === 'entra' && !env.ENTRA_CLIENT_ID) {
    throw new Error('ENTRA_CLIENT_ID is required when AUTH_MODE=entra: it is the expected audience.')
  }

  return env
}

export function acceptedAudiences(env: Env): string[] {
  return [env.ENTRA_CLIENT_ID, ...(env.ENTRA_EXTRA_AUDIENCES ?? '').split(',')]
    .map((audience) => audience?.trim())
    .filter((audience): audience is string => Boolean(audience && audience.length > 0))
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
