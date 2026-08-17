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
   * Phase 0 runs with a simulated identity. Phase 1 replaces this with Entra
   * ID validation (`tid` against the registered tenants, `iss`, `oid`).
   */
  AUTH_MODE: z.enum(['mock', 'entra']).default('mock'),
  /** Fallback identity for the mock mode when no header is sent. */
  MOCK_USER_EMAIL: z.string().optional(),

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
  return parsed.data
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
