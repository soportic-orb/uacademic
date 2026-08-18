/**
 * Google Calendar — level 3, opt-in.
 *
 * It exists because a subscribed ICS feed in Google refreshes on Google's own
 * schedule (8 to 24 hours, with no setting and no manual refresh), which is
 * useless for a room change announced the same morning. The API writes in
 * seconds.
 *
 * Same shape as Microsoft: a dedicated secondary calendar, never the primary
 * one, and free/busy read separately and only as start/end.
 */
import type { CalendarEventDraft } from '@uacademic/shared'

import {
  type BusyResult,
  type CalendarProviderClient,
  type FetchLike,
  type OAuthTokens,
  type ProviderConfig,
  ProviderError,
  RFC_DAYS,
  type RemoteEvent,
} from './types.js'

const API = 'https://www.googleapis.com/calendar/v3'

/**
 * Both are sensitive scopes and both go through Google's verification, which
 * takes weeks — the README says what to prepare. `calendar.events.owned` would
 * be narrower but cannot create the dedicated calendar we insist on.
 */
export const GOOGLE_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar'
export const GOOGLE_BUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export class GoogleCalendarClient implements CalendarProviderClient {
  readonly provider = 'google' as const
  readonly #config: ProviderConfig
  readonly #fetch: FetchLike

  constructor(config: ProviderConfig) {
    this.#config = config
    this.#fetch = config.fetchImpl ?? fetch
  }

  authorizeUrl(input: { state: string; loginHint?: string | undefined }): string {
    const query = new URLSearchParams({
      client_id: this.#config.clientId,
      redirect_uri: this.#config.redirectUri,
      response_type: 'code',
      scope: `${GOOGLE_WRITE_SCOPE} ${GOOGLE_BUSY_SCOPE}`,
      // Without both of these Google hands out no refresh token on a repeat
      // consent, and the connection dies an hour later.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: input.state,
    })
    if (input.loginHint) query.set('login_hint', input.loginHint)

    return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    return this.#token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.#config.redirectUri,
    })
  }

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.#token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  async ensureCalendar(tokens: OAuthTokens, name: string): Promise<string> {
    const list = await this.#request<{ items?: { id: string; summary: string }[] }>(
      tokens,
      'GET',
      '/users/me/calendarList?maxResults=250',
    )
    const found = list.items?.find((calendar) => calendar.summary === name)
    if (found) return found.id

    const created = await this.#request<{ id: string }>(tokens, 'POST', '/calendars', {
      summary: name,
    })
    return created.id
  }

  async deleteCalendar(tokens: OAuthTokens, calendarId: string): Promise<void> {
    await this.#request(tokens, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}`)
  }

  async createEvent(
    tokens: OAuthTokens,
    calendarId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent> {
    const created = await this.#request<{ id: string; etag?: string }>(
      tokens,
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      googleEvent(draft),
    )
    return { id: created.id, etag: created.etag }
  }

  async updateEvent(
    tokens: OAuthTokens,
    calendarId: string,
    eventId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent> {
    const updated = await this.#request<{ id: string; etag?: string }>(
      tokens,
      'PUT',
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      googleEvent(draft),
    )
    return { id: updated.id, etag: updated.etag }
  }

  async deleteEvent(tokens: OAuthTokens, calendarId: string, eventId: string): Promise<void> {
    await this.#request(
      tokens,
      'DELETE',
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    )
  }

  /**
   * Incremental where possible: a `syncToken` returns only what changed since
   * the last read, which is what makes a short polling interval affordable.
   * Google invalidates the token with a 410, and the caller then asks again
   * without one.
   */
  async listBusy(
    tokens: OAuthTokens,
    input: { from: Date; to: Date; syncToken?: string | undefined },
  ): Promise<BusyResult> {
    const query = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '500',
      fields: 'items(start,end,status,transparency),nextSyncToken',
    })

    if (input.syncToken) query.set('syncToken', input.syncToken)
    else {
      query.set('timeMin', input.from.toISOString())
      query.set('timeMax', input.to.toISOString())
    }

    const response = await this.#request<{
      items?: {
        start?: { dateTime?: string; date?: string }
        end?: { dateTime?: string; date?: string }
        status?: string
        transparency?: string
      }[]
      nextSyncToken?: string
    }>(tokens, 'GET', `/calendars/primary/events?${query.toString()}`)

    const windows = (response.items ?? [])
      .filter((event) => event.status !== 'cancelled' && event.transparency !== 'transparent')
      // An all-day entry has `date`, not `dateTime`: it is not a meeting.
      .filter((event) => Boolean(event.start?.dateTime && event.end?.dateTime))
      .map((event) => ({
        startAt: new Date(event.start!.dateTime!),
        endAt: new Date(event.end!.dateTime!),
      }))
      .filter((window) => !Number.isNaN(window.startAt.getTime()))

    return { windows, syncToken: response.nextSyncToken }
  }

  async #token(body: Record<string, string>): Promise<OAuthTokens> {
    const response = await this.#fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        ...body,
      }).toString(),
    })

    if (!response.ok) {
      throw new ProviderError(
        response.status,
        'google',
        'token request failed',
        await text(response),
      )
    }

    const payload = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : undefined,
      scopes: payload.scope,
    }
  }

  async #request<T>(tokens: OAuthTokens, method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (!response.ok) {
      throw new ProviderError(response.status, 'google', `${method} ${path}`, await text(response))
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

async function text(response: Response): Promise<string> {
  return response
    .text()
    .then((value) => value.slice(0, 500))
    .catch(() => '')
}

/** A class as the Calendar API wants it: RFC 5545 recurrence, zoned times. */
export function googleEvent(draft: CalendarEventDraft): Record<string, unknown> {
  const start = firstDate(draft)
  const until = new Date(draft.dateTo.getTime())
  until.setUTCHours(23, 59, 59)

  return {
    summary: draft.summary,
    description: [draft.description, draft.url].filter(Boolean).join('\n\n') || undefined,
    location: draft.location,
    start: { dateTime: `${iso(start)}T${draft.startTime}:00`, timeZone: draft.timezone },
    end: { dateTime: `${iso(start)}T${draft.endTime}:00`, timeZone: draft.timezone },
    ...(draft.recurrence === 'once'
      ? {}
      : {
          recurrence: [
            `RRULE:FREQ=WEEKLY${draft.recurrence === 'biweekly' ? ';INTERVAL=2' : ''};BYDAY=${
              RFC_DAYS[draft.weekday]
            };UNTIL=${until.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
          ],
        }),
    transparency: 'opaque',
    reminders: { useDefault: false },
    source: draft.url ? { title: 'UAcademic', url: draft.url } : undefined,
  }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function firstDate(draft: CalendarEventDraft): Date {
  const start = new Date(
    Date.UTC(
      draft.dateFrom.getUTCFullYear(),
      draft.dateFrom.getUTCMonth(),
      draft.dateFrom.getUTCDate(),
    ),
  )
  const isoWeekday = ((start.getUTCDay() + 6) % 7) + 1
  start.setUTCDate(start.getUTCDate() + ((draft.weekday - isoWeekday + 7) % 7))
  return start
}
