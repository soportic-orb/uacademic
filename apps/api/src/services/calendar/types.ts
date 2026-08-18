/**
 * What a calendar provider has to be able to do, and nothing more.
 *
 * Both implementations (Microsoft Graph, Google Calendar) sit behind this so
 * the sync engine never learns which one it is talking to — and so the tests
 * can drive the whole engine against a fake without a network.
 *
 * `fetchImpl` is injected for the same reason: a provider client is a thin
 * translation layer over HTTP, and the only honest way to test it is to hand
 * it the responses.
 */
import type { CalendarEventDraft, CalendarProvider } from '@uacademic/shared'

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string | undefined
  /** Absolute expiry; providers answer in seconds, we store the instant. */
  expiresAt?: Date | undefined
  scopes?: string | undefined
}

export interface RemoteEvent {
  id: string
  etag?: string | undefined
}

export interface BusyWindow {
  startAt: Date
  endAt: Date
}

export interface BusyResult {
  windows: BusyWindow[]
  /** Cursor for the next incremental read, when the provider offers one. */
  syncToken?: string | undefined
}

/**
 * A provider error that carries the HTTP status, because the status is what
 * decides whether to retry, to recreate the event, or to park the connection
 * and ask the person to reconnect.
 */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly provider: CalendarProvider,
    message: string,
    readonly body?: string,
  ) {
    super(`${provider}: ${message} (${status})`)
    this.name = 'ProviderError'
  }
}

export interface CalendarProviderClient {
  readonly provider: CalendarProvider

  /** Where to send the browser for consent. `state` binds it to this user. */
  authorizeUrl(input: { state: string; loginHint?: string | undefined }): string
  exchangeCode(code: string): Promise<OAuthTokens>
  refresh(refreshToken: string): Promise<OAuthTokens>

  /** Creates the dedicated calendar, or returns the existing one by name. */
  ensureCalendar(tokens: OAuthTokens, name: string): Promise<string>
  deleteCalendar(tokens: OAuthTokens, calendarId: string): Promise<void>

  createEvent(
    tokens: OAuthTokens,
    calendarId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent>
  updateEvent(
    tokens: OAuthTokens,
    calendarId: string,
    eventId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent>
  deleteEvent(tokens: OAuthTokens, calendarId: string, eventId: string): Promise<void>

  /**
   * Busy windows of the *personal* calendar. Start and end only — a provider
   * client must never return a title, and the type is what enforces it.
   */
  listBusy(
    tokens: OAuthTokens,
    input: { from: Date; to: Date; syncToken?: string | undefined },
  ): Promise<BusyResult>
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ProviderConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchImpl?: FetchLike | undefined
}

/** Weekday numbers as each provider spells them out in a recurrence rule. */
export const ICAL_DAYS = [
  '',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export const RFC_DAYS = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
