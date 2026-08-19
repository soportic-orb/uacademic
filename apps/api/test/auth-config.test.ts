/**
 * What the browser is told about signing in.
 *
 * The client id used to be baked into the web bundle at build time, so an
 * operator who registered the application in Entra ID after installing had a
 * permanently greyed-out Microsoft button and no way to reach it short of
 * rebuilding the front end. It is served from the running configuration now,
 * and these tests pin that: the credentials in `shared/.env` are enough.
 */
import { describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

async function configFor(overrides: Record<string, string>) {
  const app = await buildApp({
    env: loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      UACADEMIC_LOG_LEVEL: 'silent',
      ...overrides,
    }),
  })

  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/config' })
    expect(response.statusCode).toBe(200)
    return response.json()
  } finally {
    await app.close()
  }
}

describe('the sign-in configuration the browser reads', () => {
  it('is public: it is what the sign-in screen needs before there is a session', async () => {
    const body = await configFor({ UACADEMIC_AUTH_MODE: 'local' })

    expect(body.mode).toBe('local')
  })

  it('offers Microsoft on a client id alone, without also flipping the auth mode', async () => {
    const body = await configFor({
      UACADEMIC_AUTH_MODE: 'local',
      UACADEMIC_ENTRA_CLIENT_ID: 'a-registered-application',
      UACADEMIC_ENTRA_AUTHORITY_TENANT: 'organizations',
    })

    expect(body.entra).toEqual({
      clientId: 'a-registered-application',
      authority: 'https://login.microsoftonline.com/organizations',
    })
  })

  it('offers nothing when no application is registered', async () => {
    const body = await configFor({ UACADEMIC_AUTH_MODE: 'local', UACADEMIC_ENTRA_CLIENT_ID: '' })

    expect(body.entra).toBeNull()
  })

  it('keeps Microsoft out of mock mode, where identity comes from a header', async () => {
    const body = await configFor({
      UACADEMIC_AUTH_MODE: 'mock',
      UACADEMIC_ENTRA_CLIENT_ID: 'a-registered-application',
    })

    expect(body.entra).toBeNull()
  })
})
