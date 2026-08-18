/**
 * iCalendar feed generation (RFC 5545).
 *
 * A teacher subscribes once and their timetable appears in Outlook, Google
 * Calendar or Apple Calendar, refreshing itself when the schedule is
 * republished. That means the feed has to be a *subscription*: recurring
 * events with a stable UID per session, non-teaching days excluded, and no
 * attendee data — a calendar URL is a bearer token and travels through third
 * parties, so it carries only what the owner already knows.
 *
 * Building it here rather than in the API keeps it pure and testable, and it
 * is why the whole thing is unit-tested against a fixed clock.
 */
import type { Recurrence } from './conflicts.js'
import { type ClockTime, type Weekday, isoWeekday, toMinutes } from './time.js'

export interface IcsSession {
  id: string
  summary: string
  description?: string
  location?: string
  /** Deep link back into UAcademic, emitted as `URL:`. */
  url?: string
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  dateFrom: Date
  dateTo: Date
  recurrence: Recurrence
  /**
   * Revision of this event. A client only accepts an update whose SEQUENCE is
   * higher than the one it holds, so this has to grow with every edit —
   * `sequenceFor(updatedAt)` derives it from the row itself.
   */
  sequence?: number
  /**
   * `cancelled` keeps the event in the feed as a tombstone. Dropping a VEVENT
   * silently leaves the class sitting in everybody's calendar forever: the
   * client can only remove what it is told to remove.
   */
  status?: 'confirmed' | 'cancelled'
}

export interface IcsOptions {
  calendarName: string
  /** Center-local IANA zone, e.g. `Europe/Madrid`. */
  timezone: string
  /** Days with no teaching: holidays and closures, as `YYYY-MM-DD`. */
  excludedDates?: readonly string[]
  /** Stamp for `DTSTAMP`; injected so the output is reproducible. */
  now?: Date
  /** Refresh hint honoured by most clients. */
  refreshMinutes?: number
  /** Year the VTIMEZONE transitions are anchored on. Defaults to the stamp's. */
  referenceYear?: number
}

const ICS_WEEKDAYS: Record<Weekday, string> = {
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
  7: 'SU',
}

/** RFC 5545 §3.3.11: escape commas, semicolons, backslashes and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** RFC 5545 §3.1: lines are folded at 75 octets, continuations start with a space. */
export function foldIcsLine(line: string): string {
  const bytes = [...line]
  if (bytes.length <= 75) return line

  const parts: string[] = []
  let current = ''
  for (const character of bytes) {
    if (current.length + character.length > (parts.length === 0 ? 75 : 74)) {
      parts.push(current)
      current = ''
    }
    current += character
  }
  if (current.length > 0) parts.push(current)

  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n')
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function dateStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
}

function utcStamp(date: Date): string {
  return `${dateStamp(date)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds(),
  )}Z`
}

/** Local date-time as clients read it together with `TZID=`. */
function localStamp(date: Date, time: ClockTime): string {
  return `${dateStamp(date)}T${time.replace(':', '')}00`
}

/**
 * Offset of a zone at an instant, in minutes east of UTC.
 *
 * Read from `Intl` rather than from a table: the runtime already ships the
 * zone database, and a table in here would be one more thing to keep in step
 * with reality twice a year.
 */
export function zoneOffsetMinutes(timezone: string, date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value

  // "GMT" alone means UTC; otherwise "GMT+01:00" / "GMT-03:30".
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(formatted ?? '')
  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'))
}

function offsetStamp(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  return `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`
}

/**
 * Zones that switch on the European Union rule: last Sunday of March and of
 * October, both at 01:00 UTC. Everything the product targets is in here; any
 * other zone with a summer time we cannot describe falls back to UTC stamps.
 */
function usesEuropeanDstRule(timezone: string): boolean {
  const NO_DST_EUROPE = [
    'Europe/Moscow',
    'Europe/Minsk',
    'Europe/Istanbul',
    'Europe/Kaliningrad',
    'Europe/Volgograd',
    'Europe/Saratov',
    'Europe/Samara',
    'Europe/Astrakhan',
    'Europe/Kirov',
    'Europe/Ulyanovsk',
  ]
  if (NO_DST_EUROPE.includes(timezone)) return false

  return (
    timezone.startsWith('Europe/') ||
    ['Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores'].includes(timezone)
  )
}

/** Local wall-clock time of a transition that happens at 01:00 UTC. */
function transitionTime(offsetMinutes: number): string {
  const minutes = (60 + offsetMinutes + 24 * 60) % (24 * 60)
  return `${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`
}

/**
 * A complete VTIMEZONE, which is what makes `DTSTART;TZID=` mean anything: a
 * client that does not know the zone still places the class correctly, and a
 * weekly class stays at the same local hour across the March and October
 * changes — which a UTC stamp would not survive.
 *
 * Returns an empty array for a zone whose summer time we cannot state as a
 * rule; the feed then falls back to UTC stamps rather than emitting a
 * VTIMEZONE that would be a guess.
 */
export function buildVTimezone(timezone: string, referenceYear: number): string[] {
  const january = new Date(Date.UTC(referenceYear, 0, 15))
  const july = new Date(Date.UTC(referenceYear, 6, 15))
  const standard = zoneOffsetMinutes(timezone, january)
  const daylight = zoneOffsetMinutes(timezone, july)

  if (standard === daylight) {
    return [
      'BEGIN:VTIMEZONE',
      `TZID:${timezone}`,
      'BEGIN:STANDARD',
      `DTSTART:${referenceYear}0101T000000`,
      `TZOFFSETFROM:${offsetStamp(standard)}`,
      `TZOFFSETTO:${offsetStamp(standard)}`,
      `TZNAME:UTC${offsetStamp(standard)}`,
      'END:STANDARD',
      'END:VTIMEZONE',
    ]
  }

  if (!usesEuropeanDstRule(timezone)) return []

  return [
    'BEGIN:VTIMEZONE',
    `TZID:${timezone}`,
    `X-LIC-LOCATION:${timezone}`,
    'BEGIN:DAYLIGHT',
    `DTSTART:${referenceYear}0301T${transitionTime(standard)}`,
    `TZOFFSETFROM:${offsetStamp(standard)}`,
    `TZOFFSETTO:${offsetStamp(daylight)}`,
    `TZNAME:UTC${offsetStamp(daylight)}`,
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    `DTSTART:${referenceYear}1001T${transitionTime(daylight)}`,
    `TZOFFSETFROM:${offsetStamp(daylight)}`,
    `TZOFFSETTO:${offsetStamp(standard)}`,
    `TZNAME:UTC${offsetStamp(standard)}`,
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ]
}

/**
 * SEQUENCE from the row's own `updated_at`: minutes since 2024, so any edit
 * produces a strictly higher number without a counter column that a write path
 * could forget to bump. It stays a valid 32-bit integer for the next few
 * thousand years.
 */
const SEQUENCE_EPOCH_MS = Date.UTC(2024, 0, 1)

export function sequenceFor(updatedAt: Date | undefined): number {
  if (!updatedAt) return 0
  return Math.max(0, Math.floor((updatedAt.getTime() - SEQUENCE_EPOCH_MS) / 60_000))
}

/** First occurrence on or after `from` that falls on the session's weekday. */
export function firstOccurrence(from: Date, weekday: Weekday): Date {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const shift = (weekday - isoWeekday(start) + 7) % 7
  start.setUTCDate(start.getUTCDate() + shift)
  return start
}

/**
 * The dates a session actually happens on, between two bounds and minus the
 * days the academic calendar closes.
 *
 * The calendar views and the ICS feed share it on purpose: a class the browser
 * draws on a Tuesday and a feed that skips it would be the same bug twice.
 */
export function occurrencesBetween(
  session: IcsSession,
  from: Date,
  to: Date,
  excludedDates: readonly string[] = [],
): Date[] {
  const skip = new Set(excludedDates)
  return occurrenceDates(session).filter((date) => {
    if (date.getTime() < from.getTime() || date.getTime() > to.getTime()) return false
    return !skip.has(date.toISOString().slice(0, 10))
  })
}

function occurrenceDates(session: IcsSession): Date[] {
  const dates: Date[] = []
  const step = session.recurrence === 'biweekly' ? 14 : 7
  const cursor = firstOccurrence(session.dateFrom, session.weekday)

  if (session.recurrence === 'once') return [firstOccurrence(session.dateFrom, session.weekday)]

  while (cursor.getTime() <= session.dateTo.getTime()) {
    dates.push(new Date(cursor.getTime()))
    cursor.setUTCDate(cursor.getUTCDate() + step)
  }
  return dates
}

function ruleFor(session: IcsSession): string | null {
  if (session.recurrence === 'once') return null
  const interval = session.recurrence === 'biweekly' ? ';INTERVAL=2' : ''
  const until = new Date(session.dateTo.getTime())
  until.setUTCHours(23, 59, 59)
  return `RRULE:FREQ=WEEKLY${interval};BYDAY=${ICS_WEEKDAYS[session.weekday]};UNTIL=${utcStamp(until)}`
}

/**
 * Dates the session would fall on but must not: holidays and closures. They
 * are emitted as EXDATE so the client removes exactly those occurrences
 * instead of the feed silently disagreeing with the academic calendar.
 */
function exceptionDates(session: IcsSession, excluded: readonly string[]): Date[] {
  if (excluded.length === 0) return []
  const skip = new Set(excluded)
  return occurrenceDates(session).filter((date) => skip.has(date.toISOString().slice(0, 10)))
}

/**
 * The feed. `uid` is derived from the session id so a republished schedule
 * updates the existing event instead of duplicating it, and `SEQUENCE` grows
 * with each edit so clients accept the update.
 *
 * A cancelled session stays in the feed as `STATUS:CANCELLED` for as long as
 * the tombstone lives. Simply dropping the VEVENT would leave the class in
 * everybody's calendar: a subscriber can only remove what it is told about.
 */
export function buildIcsFeed(sessions: readonly IcsSession[], options: IcsOptions): string {
  const now = options.now ?? new Date()
  const excluded = options.excludedDates ?? []
  const refresh = options.refreshMinutes ?? 60
  const timezone = buildVTimezone(options.timezone, options.referenceYear ?? now.getUTCFullYear())

  // Without a VTIMEZONE we cannot ask the client to resolve `TZID`, so the
  // stamps go out in UTC, converted per occurrence.
  const useTzid = timezone.length > 0

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UAcademic//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    `X-WR-TIMEZONE:${options.timezone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refresh}M`,
    `X-PUBLISHED-TTL:PT${refresh}M`,
    ...timezone,
  ]

  const stamp = (date: Date, time: ClockTime): string =>
    useTzid
      ? `;TZID=${options.timezone}:${localStamp(date, time)}`
      : `:${utcStamp(instantOf(date, time, options.timezone))}`

  for (const session of sessions) {
    if (toMinutes(session.endTime) <= toMinutes(session.startTime)) continue
    const start = firstOccurrence(session.dateFrom, session.weekday)
    if (start.getTime() > session.dateTo.getTime()) continue

    lines.push(
      'BEGIN:VEVENT',
      `UID:${session.id}@uacademic`,
      `DTSTAMP:${utcStamp(now)}`,
      `SEQUENCE:${session.sequence ?? 0}`,
      `DTSTART${stamp(start, session.startTime)}`,
      `DTEND${stamp(start, session.endTime)}`,
      `SUMMARY:${escapeIcsText(session.summary)}`,
      `STATUS:${session.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    )

    const rule = ruleFor(session)
    if (rule) lines.push(rule)

    const exdates = exceptionDates(session, excluded)
    if (exdates.length > 0) {
      lines.push(
        useTzid
          ? `EXDATE;TZID=${options.timezone}:${exdates
              .map((date) => localStamp(date, session.startTime))
              .join(',')}`
          : `EXDATE:${exdates
              .map((date) => utcStamp(instantOf(date, session.startTime, options.timezone)))
              .join(',')}`,
      )
    }

    if (session.location) lines.push(`LOCATION:${escapeIcsText(session.location)}`)
    if (session.description) lines.push(`DESCRIPTION:${escapeIcsText(session.description)}`)
    if (session.url) lines.push(`URL:${session.url}`)
    lines.push(
      session.status === 'cancelled' ? 'TRANSP:TRANSPARENT' : 'TRANSP:OPAQUE',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')

  // CRLF everywhere, folded: some clients are strict about both.
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

/**
 * The instant a local wall-clock time falls on in a zone. Used only by the
 * UTC fallback, and it reads the offset of that very day so a date either side
 * of a summer-time change lands on the right minute.
 */
function instantOf(date: Date, time: ClockTime, timezone: string): Date {
  const naive = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5)),
  )
  return new Date(naive - zoneOffsetMinutes(timezone, new Date(naive)) * 60_000)
}
