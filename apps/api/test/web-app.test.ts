/**
 * The API as the web server.
 *
 * Only relevant where a panel proxies every path to Node — the documented
 * deployment has Nginx serving these files and Node never seeing them. What
 * has to hold either way: the shell is public, the API is not, and a request
 * for JSON never gets HTML back.
 */
import type { FastifyInstance } from 'fastify'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildInstallerApp } from '../src/modules/install/app.js'
import { webDistPath } from '../src/plugins/web-app.js'
import { createTestApp, hasDatabase } from './helpers.js'

const built = webDistPath() !== null

describe('serving the web application', () => {
  it('does nothing at all when the application has not been built', () => {
    // A deployment where Nginx serves the SPA must not change behaviour: the
    // path is resolved, found empty, and no route is registered.
    expect(webDistPath({ UACADEMIC_WEB_DIST: '/nowhere/at/all' })).toBeNull()
  })

  describe.skipIf(!built)('in setup mode', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      // Somewhere with no configuration, so "not installed" is a fact rather
      // than whatever this machine happens to have lying around.
      process.env.UACADEMIC_ENV_FILE = join(
        await mkdtemp(join(tmpdir(), 'uacademic-webapp-')),
        '.env',
      )
      app = await buildInstallerApp({ logLevel: 'silent' })
    })

    afterAll(async () => {
      await app.close()
      delete process.env.UACADEMIC_ENV_FILE
    })

    it('serves the wizard itself, so a bare server needs no web server', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/install',
        headers: { accept: 'text/html' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      // The shell, never cached: that is how a browser gets stuck on an old
      // version of the very page that updates the platform.
      expect(response.headers['cache-control']).toBe('no-cache')
    })

    it('still answers the installer API as an API', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/install/status' })

      expect(response.headers['content-type']).toContain('application/json')
      expect(response.json().installed).toBe(false)
    })
  })

  describe.skipIf(!built || !hasDatabase)('on the installed platform', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = await createTestApp()
    })

    afterAll(async () => {
      await app.close()
    })

    it('answers a deep link with the shell, because its routes are the SPA’s', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/planning',
        headers: { accept: 'text/html' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
    })

    it('asks for no session to hand over the bundle', async () => {
      // Whoever has not signed in yet needs the application before they can:
      // requiring a session for the bundle would lock everybody out.
      const response = await app.inject({ method: 'GET', url: '/manifest.webmanifest' })

      expect(response.statusCode).toBe(200)
    })

    it('keeps every check on the API itself', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { accept: 'text/html' },
      })

      // Even asking for HTML: an API path is an API path.
      expect(response.statusCode).toBe(401)
      expect(response.headers['content-type']).toContain('application/json')
    })
  })
})
