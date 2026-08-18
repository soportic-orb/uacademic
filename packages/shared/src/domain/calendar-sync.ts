/**
 * The rules of pushing a timetable into somebody else's calendar.
 *
 * Everything decidable lives here (R7): what has to be created, updated or
 * cancelled in a remote calendar, when a connection is dead rather than merely
 * failing, and how a personal calendar's busy time becomes a soft constraint
 * for the planner. The HTTP — Microsoft Graph, Google Calendar — is the API's
 * business; none of it is in this file.
 *
 * One rule shapes all of it: **UAcademic is the source of truth**. A teacher
 * who deletes a class from their phone has not cancelled the class; the next
 * synchronisation puts it back and tells them so.
 */
import type { AvailabilityEntry, AvailabilityLevel } from './availability.js'
import type { Recurrence } from './conflicts.js'
import { zoneOffsetMinutes } from './ics.js'
import { type ClockTime, type Weekday, toMinutes } from './time.js'

export type CalendarProvider = 'microsoft' | 'google'

export const CALENDAR_PROVIDERS: readonly CalendarProvider[] = ['microsoft', 'google']

/**
 * Expected delay between a change here and the same change showing up in the
 * teacher's calendar. It is shown in the UI verbatim: a subscription is pull,
 * and pretending otherwise is how people miss a room change.
 */
export interface DeliveryLatency {
  /** Typical minutes until a client refreshes, best case. */
  minMinutes: number
  /** Worst case in practice. */
  maxMinutes: number
  /** True when the client, not us, decides — and the user cannot change it. */
  clientControlled: boolean
}

export const LATENCY_ICS_APPLE: DeliveryLatency = {
  minMinutes: 5,
  maxMinutes: 60,
  clientControlled: true,
}
export const LATENCY_ICS_OUTLOOK: DeliveryLatency = {
  minMinutes: 60,
  maxMinutes: 240,
  clientControlled: true,
}
/** Google refreshes subscribed feeds on its own schedule and offers no knob. */
export const LATENCY_ICS_GOOGLE: DeliveryLatency = {
  minMinutes: 480,
  maxMinutes: 1440,
  clientControlled: true,
}
/** An API write is visible as soon as the queue drains. */
export const LATENCY_API: DeliveryLatency = {
  minMinutes: 0,
  maxMinutes: 5,
  clientControlled: false,
}

export function latencyFor(
  method: 'ics.apple' | 'ics.google' | 'ics.outlook' | 'api',
): DeliveryLatency {
  if (method === 'ics.apple') return LATENCY_ICS_APPLE
  if (method === 'ics.google') return LATENCY_ICS_GOOGLE
  if (method === 'ics.outlook') return LATENCY_ICS_OUTLOOK
  return LATENCY_API
}

/** One class, as a remote calendar needs to hear about it. */
export interface CalendarEventDraft {
  sessionId: string
  summary: string
  description?: string
  location?: string
  url?: string
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  dateFrom: Date
  dateTo: Date
  recurrence: Recurrence
  timezone: string
  /** Revision, so a provider that keeps one can be told what it is. */
  sequence: number
}

export interface EventMapping {
  sessionId: string
  externalEventId: string
  /** Signature of the draft as it was last written. */
  signature: string
}

export interface SyncPlan {
  create: CalendarEventDraft[]
  update: { draft: CalendarEventDraft; externalEventId: string }[]
  remove: { sessionId: string; externalEventId: string }[]
  unchanged: number
}

/**
 * Everything about a class a calendar entry can show. Two drafts with the same
 * signature produce the same event, so the sync can skip them — which is what
 * keeps a republication from rewriting three hundred untouched events.
 */
export function eventSignature(draft: CalendarEventDraft): string {
  return [
    draft.weekday,
    draft.startTime,
    draft.endTime,
    draft.dateFrom.toISOString().slice(0, 10),
    draft.dateTo.toISOString().slice(0, 10),
    draft.recurrence,
    draft.timezone,
    draft.summary,
    draft.location ?? '',
    draft.description ?? '',
  ].join('|')
}

/**
 * What to do with a remote calendar so it matches the timetable.
 *
 * A mapping without a draft is a class that no longer exists for this person —
 * cancelled, moved to a colleague, or dropped from the published version — and
 * it has to be *removed remotely*, not forgotten locally.
 */
export function planCalendarSync(
  desired: readonly CalendarEventDraft[],
  mappings: readonly EventMapping[],
): SyncPlan {
  const bySession = new Map(mappings.map((mapping) => [mapping.sessionId, mapping]))
  const plan: SyncPlan = { create: [], update: [], remove: [], unchanged: 0 }

  for (const draft of desired) {
    const mapping = bySession.get(draft.sessionId)
    if (!mapping) {
      plan.create.push(draft)
      continue
    }

    if (mapping.signature === eventSignature(draft)) plan.unchanged += 1
    else plan.update.push({ draft, externalEventId: mapping.externalEventId })
  }

  const wanted = new Set(desired.map((draft) => draft.sessionId))
  for (const mapping of mappings) {
    if (!wanted.has(mapping.sessionId)) {
      plan.remove.push({ sessionId: mapping.sessionId, externalEventId: mapping.externalEventId })
    }
  }

  return plan
}

export type SyncFailure = 'dead' | 'missing' | 'retry'

/**
 * How a provider's HTTP status has to be read.
 *
 * `dead` means the consent is gone and no amount of retrying will bring it
 * back: the connection is parked and the person is asked to reconnect. Looping
 * on a revoked token is how an integration ends up rate-limited and blamed.
 * `missing` is the event, not the connection — the user deleted it, and since
 * UAcademic is the source of truth we recreate it.
 */
export function classifyFailure(status: number): SyncFailure {
  if (status === 401 || status === 403) return 'dead'
  if (status === 410) return 'dead'
  if (status === 404) return 'missing'
  return 'retry'
}

export function isDeadConnection(status: number): boolean {
  return classifyFailure(status) === 'dead'
}

/** Consents are versioned: what somebody agreed to has to stay answerable. */
export type ConsentScope =
  'calendar.write.microsoft' | 'calendar.write.google' | 'calendar.busy.read'

export const CONSENT_SCOPES: readonly ConsentScope[] = [
  'calendar.write.microsoft',
  'calendar.write.google',
  'calendar.busy.read',
]

/** Bump when the wording of what is being agreed to changes. */
export const CURRENT_CONSENT_VERSION = 1

export interface BusyInterval {
  startAt: Date
  endAt: Date
}

export interface BusyToAvoidOptions {
  /** Center-local zone: a busy slot is stored as an instant, shown as a day. */
  timezone: string
  /** Planner grid, so the entries land on cell boundaries. */
  slotMinutes?: number
  /**
   * How many weeks a commitment has to repeat before it counts. One-off
   * meetings should not paint a whole term as "better avoided"; the case this
   * exists for — an associate lecturer with a standing external meeting — does
   * repeat.
   */
  minOccurrences?: number
  level?: AvailabilityLevel
  /** Ignore anything longer than this: an all-day event is not a meeting. */
  maxHours?: number
}

interface WeeklyBand {
  weekday: Weekday
  fromMinutes: number
  toMinutes: number
}

/**
 * Busy time from a personal calendar, as weekly availability the engine
 * understands.
 *
 * Only start and end ever reach this function — no titles, no attendees, no
 * organiser. That is the whole promise made to the person who switched it on,
 * and it is enforced by the type, not by a convention.
 */
export function busyToAvoidEntries(
  intervals: readonly BusyInterval[],
  options: BusyToAvoidOptions,
): AvailabilityEntry[] {
  const slot = options.slotMinutes ?? 30
  const minOccurrences = options.minOccurrences ?? 2
  const maxMinutes = (options.maxHours ?? 8) * 60
  const level = options.level ?? 'avoid'

  const counts = new Map<string, { band: WeeklyBand; weeks: Set<string> }>()

  for (const interval of intervals) {
    const band = toWeeklyBand(interval, options.timezone, slot)
    if (!band) continue
    if (band.toMinutes - band.fromMinutes > maxMinutes) continue

    const key = `${band.weekday}:${band.fromMinutes}:${band.toMinutes}`
    const entry = counts.get(key) ?? { band, weeks: new Set<string>() }
    entry.weeks.add(weekKey(interval.startAt))
    counts.set(key, entry)
  }

  const bands = [...counts.values()]
    .filter((entry) => entry.weeks.size >= minOccurrences)
    .map((entry) => entry.band)

  return mergeBands(bands).map((band) => ({
    weekday: band.weekday,
    startTime: fromMinutes(band.fromMinutes),
    endTime: fromMinutes(band.toMinutes),
    level,
  }))
}

/** Local weekday and rounded-out minute band of one busy interval. */
function toWeeklyBand(interval: BusyInterval, timezone: string, slot: number): WeeklyBand | null {
  if (interval.endAt.getTime() <= interval.startAt.getTime()) return null

  const offset = zoneOffsetMinutes(timezone, interval.startAt)
  const localStart = new Date(interval.startAt.getTime() + offset * 60_000)
  const localEnd = new Date(interval.endAt.getTime() + offset * 60_000)

  // A commitment that crosses midnight is not a weekly slot; the part that
  // falls on the starting day is what the planner can act on.
  const startMinutes = localStart.getUTCHours() * 60 + localStart.getUTCMinutes()
  const sameDay = localEnd.toISOString().slice(0, 10) === localStart.toISOString().slice(0, 10)
  const endMinutes = sameDay ? localEnd.getUTCHours() * 60 + localEnd.getUTCMinutes() : 24 * 60

  const weekday = (((localStart.getUTCDay() + 6) % 7) + 1) as Weekday
  const fromMinutes = Math.floor(startMinutes / slot) * slot
  const toMinutes = Math.min(24 * 60, Math.ceil(endMinutes / slot) * slot)

  if (toMinutes <= fromMinutes) return null
  return { weekday, fromMinutes, toMinutes }
}

/** ISO-ish year+week key, only used to count how often a band repeats. */
function weekKey(date: Date): string {
  const monday = new Date(date.getTime())
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

function mergeBands(bands: readonly WeeklyBand[]): WeeklyBand[] {
  const sorted = [...bands].sort((a, b) => a.weekday - b.weekday || a.fromMinutes - b.fromMinutes)

  const merged: WeeklyBand[] = []
  for (const band of sorted) {
    const last = merged.at(-1)
    if (last && last.weekday === band.weekday && band.fromMinutes <= last.toMinutes) {
      last.toMinutes = Math.max(last.toMinutes, band.toMinutes)
    } else {
      merged.push({ ...band })
    }
  }
  return merged
}

function fromMinutes(minutes: number): ClockTime {
  const clamped = Math.min(minutes, 23 * 60 + 59)
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0')
  return `${hours}:${String(clamped % 60).padStart(2, '0')}` as ClockTime
}

/**
 * Availability with the external commitments folded in. The stored week always
 * wins where it is stricter: what a teacher declared unavailable stays
 * unavailable, and an imported meeting can only ever make a slot less
 * attractive, never more.
 */
export function withExternalBusy(
  stored: readonly AvailabilityEntry[],
  external: readonly AvailabilityEntry[],
): AvailabilityEntry[] {
  const result = [...stored]

  for (const entry of external) {
    const overlapsUnavailable = stored.some(
      (other) =>
        other.weekday === entry.weekday &&
        other.level === 'unavailable' &&
        toMinutes(other.startTime) <= toMinutes(entry.startTime) &&
        toMinutes(other.endTime) >= toMinutes(entry.endTime),
    )
    if (!overlapsUnavailable) result.push(entry)
  }

  return result
}
