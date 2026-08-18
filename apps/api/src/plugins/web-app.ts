import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/**
 * Serving the web application from the API.
 *
 * The documented deployment has Nginx serving `apps/web/dist` and proxying
 * only `/api/` — and where that holds, none of this ever runs: Nginx answers
 * those requests and Node never sees them.
 *
 * It exists for the deployment panels actually produce. CloudPanel's Node.js
 * site, and Plesk's, proxy *every* path to the application port, which leaves
 * nobody serving the SPA: `/install` reaches the API, finds no route, and
 * returns 404 — on a server where the whole point of the installer was that
 * nothing had to be configured by hand first. So when the built application is
 * on disk next to us, we serve it.
 *
 * Registered on both applications: the installer needs it to show its own
 * wizard, and the real one needs it for every screen after that.
 */

/** The built SPA, if there is one. `null` in development, where Vite serves it. */
export function webDistPath(source: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = source.UACADEMIC_WEB_DIST
    ? [resolve(source.UACADEMIC_WEB_DIST)]
    : // Compiled to `apps/api/dist/plugins/`, run from source at
      // `apps/api/src/plugins/`: three levels up is `apps/` either way.
      [join(dirname(fileURLToPath(import.meta.url)), '../../../web/dist')]

  return candidates.find((path) => existsSync(join(path, 'index.html'))) ?? null
}

/**
 * The policy the SPA needs, matching `scripts/deploy/nginx.conf.example` — the
 * two must agree, because which one applies depends on who serves the file.
 * `connect-src` also names the Microsoft login endpoints, which MSAL contacts
 * from the browser.
 */
export const WEB_APP_CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'", 'https://login.microsoftonline.com'],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
}

/** The API answers JSON and serves documents as attachments; it renders nothing. */
export const API_ONLY_CSP = {
  defaultSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
}

/** A year for hashed assets; nothing for what carries the version. */
const IMMUTABLE = /\/assets\/|\.(?:woff2?|png|svg|ico)$/
const NEVER_CACHE = new Set(['index.html', 'sw.js', 'sw.mjs', 'manifest.webmanifest'])

export async function registerWebApp(app: FastifyInstance): Promise<string | null> {
  const root = webDistPath()
  if (!root) return null

  await app.register(fastifyStatic, {
    root,
    // No wildcard route: each file on disk gets its own, and anything else
    // falls through to the not-found handler, which is where the SPA's own
    // routing is answered. An unknown `/api/` path keeps its JSON 404.
    wildcard: false,
    index: false,
    setHeaders: (reply, path) => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      if (NEVER_CACHE.has(name)) {
        // A cached shell or worker is how a browser gets stuck on last
        // month's version — the same rule as the Nginx configuration.
        void reply.header('cache-control', 'no-cache')
      } else if (IMMUTABLE.test(path)) {
        void reply.header('cache-control', 'public, max-age=31536000, immutable')
      }
    },
  })

  return root
}

/**
 * The SPA shell, for a browser asking for a page rather than a resource.
 *
 * Called from the not-found handler: reloading `/planning` has to return the
 * application, not a 404, and a request for JSON has to keep getting JSON.
 */
export function isWebAppRequest(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false

  // Everything the platform itself answers. The bundle and the shell are
  // public by definition — Nginx serves them to anybody in the documented
  // layout — while `/api/` keeps every check it has.
  return !request.url.startsWith('/api/') && !request.url.startsWith('/health')
}

export function serveWebApp(request: FastifyRequest, reply: FastifyReply): boolean {
  // `sendFile` exists only where the plugin above registered; this is the
  // whole check for "is this installation serving the web app".
  const sendFile = (reply as { sendFile?: (path: string) => FastifyReply }).sendFile
  if (typeof sendFile !== 'function') return false

  if (!isWebAppRequest(request)) return false
  if (!(request.headers.accept ?? '').includes('text/html')) return false

  void reply.header('cache-control', 'no-cache')
  sendFile.call(reply, 'index.html')
  return true
}
