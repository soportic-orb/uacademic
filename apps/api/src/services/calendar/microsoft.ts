/**
 * Microsoft Graph — the recommended level, because the sign-in is already
 * Entra ID and the classes then appear in Outlook, in the mobile app, and in
 * Apple's Calendar for anybody who has their work account on the device.
 *
 * Two decisions matter here. The consent is asked for **separately** from the
 * login: signing in must never quietly buy write access to somebody's
 * calendar. And everything is written into a **dedicated calendar**, never the
 * default one, so the teacher can hide it, recolour it or delete it without
 * touching anything of their own — and disconnecting is one DELETE.
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

const GRAPH = 'https://graph.microsoft.com/v1.0'

/**
 * `offline_access` is what makes a refresh token possible; without it the
 * connection would die silently an hour after the teacher set it up.
 */
export const MICROSOFT_SCOPES = 'offline_access Calendars.ReadWrite'

export class MicrosoftCalendarClient implements CalendarProviderClient {
  readonly provider = 'microsoft' as const
  readonly #config: ProviderConfig
  readonly #fetch: FetchLike
  readonly #tenant: string

  constructor(config: ProviderConfig, tenant = 'organizations') {
    this.#config = config
    this.#fetch = config.fetchImpl ?? fetch
    this.#tenant = tenant
  }

  authorizeUrl(input: { state: string; loginHint?: string | undefined }): string {
    const query = new URLSearchParams({
      client_id: this.#config.clientId,
      response_type: 'code',
      redirect_uri: this.#config.redirectUri,
      response_mode: 'query',
      scope: MICROSOFT_SCOPES,
      state: input.state,
      // Asking explicitly: this is a new permission, not the login's.
      prompt: 'consent',
    })
    if (input.loginHint) query.set('login_hint', input.loginHint)

    return `https://login.microsoftonline.com/${this.#tenant}/oauth2/v2.0/authorize?${query.toString()}`
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
    const existing = await this.#request<{ value: { id: string; name: string }[] }>(
      tokens,
      'GET',
      '/me/calendars?$select=id,name&$top=100',
    )
    const found = existing.value.find((calendar) => calendar.name === name)
    if (found) return found.id

    const created = await this.#request<{ id: string }>(tokens, 'POST', '/me/calendars', { name })
    return created.id
  }

  async deleteCalendar(tokens: OAuthTokens, calendarId: string): Promise<void> {
    await this.#request(tokens, 'DELETE', `/me/calendars/${calendarId}`)
  }

  async createEvent(
    tokens: OAuthTokens,
    calendarId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent> {
    const created = await this.#request<{ id: string; '@odata.etag'?: string }>(
      tokens,
      'POST',
      `/me/calendars/${calendarId}/events`,
      graphEvent(draft),
    )
    return { id: created.id, etag: created['@odata.etag'] }
  }

  async updateEvent(
    tokens: OAuthTokens,
    calendarId: string,
    eventId: string,
    draft: CalendarEventDraft,
  ): Promise<RemoteEvent> {
    const updated = await this.#request<{ id: string; '@odata.etag'?: string }>(
      tokens,
      'PATCH',
      `/me/calendars/${calendarId}/events/${eventId}`,
      graphEvent(draft),
    )
    return { id: updated.id, etag: updated['@odata.etag'] }
  }

  async deleteEvent(tokens: OAuthTokens, calendarId: string, eventId: string): Promise<void> {
    await this.#request(tokens, 'DELETE', `/me/calendars/${calendarId}/events/${eventId}`)
  }

  /**
   * Free/busy of the *default* calendar view. `$select` is the promise made to
   * the user in the consent screen: start, end and nothing else leaves Graph.
   */
  async listBusy(tokens: OAuthTokens, input: { from: Date; to: Date }): Promise<BusyResult> {
    const query = new URLSearchParams({
      startDateTime: input.from.toISOString(),
      endDateTime: input.to.toISOString(),
      $select: 'start,end,showAs,isAllDay',
      $top: '500',
    })

    const response = await this.#request<{
      value: {
        start: { dateTime: string; timeZone: string }
        end: { dateTime: string; timeZone: string }
        showAs?: string
        isAllDay?: boolean
      }[]
    }>(tokens, 'GET', `/me/calendarView?${query.toString()}`)

    const windows = response.value
      .filter((event) => event.showAs !== 'free' && !event.isAllDay)
      .map((event) => ({
        startAt: new Date(`${event.start.dateTime}Z`.replace(/Z+$/, 'Z')),
        endAt: new Date(`${event.end.dateTime}Z`.replace(/Z+$/, 'Z')),
      }))
      .filter((window) => !Number.isNaN(window.startAt.getTime()))

    return { windows }
  }

  async #token(body: Record<string, string>): Promise<OAuthTokens> {
    const response = await this.#fetch(
      `https://login.microsoftonline.com/${this.#tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.#config.clientId,
          client_secret: this.#config.clientSecret,
          scope: MICROSOFT_SCOPES,
          ...body,
        }).toString(),
      },
    )

    if (!response.ok) {
      throw new ProviderError(
        response.status,
        'microsoft',
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
    const response = await this.#fetch(`${GRAPH}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (!response.ok) {
      throw new ProviderError(
        response.status,
        'microsoft',
        `${method} ${path}`,
        await text(response),
      )
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

/** A class as Graph wants it: local wall-clock times plus the zone. */
export function graphEvent(draft: CalendarEventDraft): Record<string, unknown> {
  const start = firstDate(draft)

  return {
    subject: draft.summary,
    body: draft.description ? { contentType: 'text', content: describe(draft) } : undefined,
    location: draft.location ? { displayName: draft.location } : undefined,
    start: { dateTime: `${iso(start)}T${draft.startTime}:00`, timeZone: draft.timezone },
    end: { dateTime: `${iso(start)}T${draft.endTime}:00`, timeZone: draft.timezone },
    ...(draft.recurrence === 'once'
      ? {}
      : {
          recurrence: {
            pattern: {
              type: 'weekly',
              interval: draft.recurrence === 'biweekly' ? 2 : 1,
              daysOfWeek: [
                ['', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][
                  draft.weekday
                ],
              ],
            },
            range: {
              type: 'endDate',
              startDate: iso(start),
              endDate: iso(draft.dateTo),
            },
          },
        }),
    // Ours to overwrite, and never a meeting request: nobody is invited.
    isReminderOn: false,
    showAs: 'busy',
    transactionId: draft.sessionId,
  }
}

function describe(draft: CalendarEventDraft): string {
  return [draft.description, draft.url].filter(Boolean).join('\n\n')
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** First occurrence: the same rule the ICS feed uses, so both agree. */
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

export { RFC_DAYS }
