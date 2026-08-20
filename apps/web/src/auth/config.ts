import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '../lib/api'
import { configureEntra } from './msal'

export interface AuthConfig {
  mode: 'mock' | 'entra' | 'local'
  entra: { clientId: string; authority: string } | null
  /** The languages this installation offers, in the order it offers them. */
  locales: ('ca' | 'es' | 'en')[]
}

/**
 * What this installation can sign people in with, asked of the API rather than
 * read from the bundle.
 *
 * An operator who registers the application in Entra ID writes the client id
 * into `shared/.env` and restarts; the browser build cannot see that file, and
 * baking the id in at build time would mean the sign-in button stays greyed out
 * until someone rebuilds the web app — with nothing on screen saying why.
 */
export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: async () => {
      const config = await apiFetch<AuthConfig>('/api/v1/auth/config')
      configureEntra(config.entra)
      return config
    },
    // It changes when the server is restarted, not while a tab is open.
    staleTime: Infinity,
    retry: false,
  })
}
