/**
 * Where the API is.
 *
 * Same origin in a production build, and it has to be: the deployment serves
 * `/api/` from the same host — whether Nginx proxies it or the API serves this
 * page itself — and the session cookie is first-party precisely because of
 * that. A bundle carrying an absolute address sends every browser that loads
 * it to whatever host was named at build time; with `localhost` as the
 * default, that host is the *reader's own machine*, and the platform fails for
 * everybody with an error no server log explains.
 *
 * In development the two servers are on different ports, so there the default
 * names the one the API listens on.
 */
export function resolveApiBaseUrl(configured: string | undefined, dev: boolean): string {
  if (configured) return configured
  return dev ? 'http://localhost:3001' : ''
}

export const API_BASE_URL: string = resolveApiBaseUrl(
  import.meta.env.VITE_UACADEMIC_API_URL,
  import.meta.env.DEV,
)
