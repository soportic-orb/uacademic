/**
 * Which providers this installation can actually offer, and how to build one.
 *
 * A provider with no credentials configured is not an error: the connections
 * screen simply says it is unavailable and the ICS feed carries on. That is
 * also what a development machine and the e2e suite see.
 */
import type { CalendarProvider } from '@uacademic/shared'

import { env } from '../../config/env.js'
import { GoogleCalendarClient } from './google.js'
import { MicrosoftCalendarClient } from './microsoft.js'
import type { CalendarProviderClient, FetchLike } from './types.js'

/** Test seam: a fake provider replaces the real HTTP client wholesale. */
const overrides = new Map<CalendarProvider, CalendarProviderClient>()

export function setProviderClient(
  provider: CalendarProvider,
  client: CalendarProviderClient | null,
): void {
  if (client) overrides.set(provider, client)
  else overrides.delete(provider)
}

export function redirectUri(provider: CalendarProvider): string {
  return `${env().API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/calendar/connections/${provider}/callback`
}

export function providerConfigured(provider: CalendarProvider): boolean {
  if (overrides.has(provider)) return true
  const configuration = env()

  return provider === 'microsoft'
    ? Boolean(configuration.ENTRA_CLIENT_ID && configuration.ENTRA_CLIENT_SECRET)
    : Boolean(configuration.GOOGLE_CLIENT_ID && configuration.GOOGLE_CLIENT_SECRET)
}

export function providerClient(
  provider: CalendarProvider,
  fetchImpl?: FetchLike,
): CalendarProviderClient | null {
  const override = overrides.get(provider)
  if (override) return override
  if (!providerConfigured(provider)) return null

  const configuration = env()

  if (provider === 'microsoft') {
    return new MicrosoftCalendarClient(
      {
        clientId: configuration.ENTRA_CLIENT_ID ?? '',
        clientSecret: configuration.ENTRA_CLIENT_SECRET ?? '',
        redirectUri: redirectUri('microsoft'),
        fetchImpl,
      },
      configuration.ENTRA_AUTHORITY_TENANT,
    )
  }

  return new GoogleCalendarClient({
    clientId: configuration.GOOGLE_CLIENT_ID ?? '',
    clientSecret: configuration.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: redirectUri('google'),
    fetchImpl,
  })
}
