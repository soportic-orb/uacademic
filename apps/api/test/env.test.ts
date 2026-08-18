/**
 * The configuration boundary.
 *
 * UAcademic is deployed on shared hosting where several applications share one
 * environment (CLAUDE.md §2). These tests are the guarantee that a neighbour's
 * variables can never become ours — the failure they prevent is quiet and
 * expensive: mail sent through somebody else's SMTP server, an OAuth client
 * that is not ours, or a migration run against the wrong database.
 */
import { describe, expect, it } from 'vitest'

import { ENV_PREFIX, ignoredLegacyNames, loadEnv, scopeEnv } from '../src/config/env.js'

const BASE = {
  NODE_ENV: 'test',
  UACADEMIC_DATABASE_URL: 'mysql://user:pass@127.0.0.1:3306/uacademic',
  UACADEMIC_AUTH_MODE: 'mock',
}

describe('the environment', () => {
  it('reads only its own names', () => {
    const env = loadEnv({
      ...BASE,
      // A neighbouring application's configuration, in the same environment.
      SMTP_HOST: 'smtp.someone-else.example',
      SMTP_USER: 'someone-else',
      GOOGLE_CLIENT_ID: 'not-ours.apps.googleusercontent.com',
      APP_URL: 'https://someone-else.example',
    })

    expect(env.SMTP_HOST).toBeUndefined()
    expect(env.SMTP_USER).toBeUndefined()
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
    // Falls back to its own default rather than to the neighbour's value.
    expect(env.APP_URL).toBe('http://localhost:5173')
  })

  it('reads the prefixed name when there is one', () => {
    const env = loadEnv({
      ...BASE,
      SMTP_HOST: 'smtp.someone-else.example',
      UACADEMIC_SMTP_HOST: 'smtp.uacademic.example',
    })

    expect(env.SMTP_HOST).toBe('smtp.uacademic.example')
  })

  it('leaves NODE_ENV alone, because it is Node’s and not ours', () => {
    expect(scopeEnv({ NODE_ENV: 'production' }).NODE_ENV).toBe('production')
    expect(scopeEnv({ UACADEMIC_NODE_ENV: 'production' }).NODE_ENV).toBeUndefined()
  })

  it('reports the names it recognised and ignored, so a half-done rename shows', () => {
    const ignored = ignoredLegacyNames({
      SMTP_HOST: 'smtp.someone-else.example',
      GOOGLE_CLIENT_ID: 'not-ours',
      UACADEMIC_APP_URL: 'https://uacademic.example',
      // Already renamed: nothing to report about this one.
      UACADEMIC_SMTP_USER: 'ours',
      SMTP_USER: 'theirs',
      // Not a name we read at all.
      SUPABASE_URL: 'https://not-a-thing.example',
    })

    expect(ignored).toContain('SMTP_HOST')
    expect(ignored).toContain('GOOGLE_CLIENT_ID')
    expect(ignored).not.toContain('SMTP_USER')
    expect(ignored).not.toContain('SUPABASE_URL')
  })

  it('names the prefix in the errors an operator will actually see', () => {
    expect(() => loadEnv({ ...BASE, UACADEMIC_AUTH_MODE: 'entra' })).toThrow(
      `${ENV_PREFIX}ENTRA_CLIENT_ID`,
    )

    // A missing value is reported under the name that has to be set.
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(`${ENV_PREFIX}DATABASE_URL`)

    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: 'production',
        UACADEMIC_AUTH_MODE: 'mock',
        UACADEMIC_SESSION_COOKIE_SECRET: 'a-long-enough-production-secret-value',
        UACADEMIC_APP_ENCRYPTION_KEY: 'a'.repeat(64),
      }),
    ).toThrow(`${ENV_PREFIX}AUTH_MODE=mock is refused in production`)
  })
})
