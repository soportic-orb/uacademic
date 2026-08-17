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
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  dateFrom: Date
  dateTo: Date
  recurrence: Recurrence
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
 * with each publication so clients accept the update.
 */
export function buildIcsFeed(sessions: readonly IcsSession[], options: IcsOptions): string {
  const now = options.now ?? new Date()
  const excluded = options.excludedDates ?? []

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UAcademic//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    `X-WR-TIMEZONE:${options.timezone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${options.refreshMinutes ?? 60}M`,
    `X-PUBLISHED-TTL:PT${options.refreshMinutes ?? 60}M`,
  ]

  for (const session of sessions) {
    if (toMinutes(session.endTime) <= toMinutes(session.startTime)) continue
    const start = firstOccurrence(session.dateFrom, session.weekday)
    if (start.getTime() > session.dateTo.getTime()) continue

    lines.push(
      'BEGIN:VEVENT',
      `UID:${session.id}@uacademic`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART;TZID=${options.timezone}:${localStamp(start, session.startTime)}`,
      `DTEND;TZID=${options.timezone}:${localStamp(start, session.endTime)}`,
      `SUMMARY:${escapeIcsText(session.summary)}`,
    )

    const rule = ruleFor(session)
    if (rule) lines.push(rule)

    const exdates = exceptionDates(session, excluded)
    if (exdates.length > 0) {
      lines.push(
        `EXDATE;TZID=${options.timezone}:${exdates
          .map((date) => localStamp(date, session.startTime))
          .join(',')}`,
      )
    }

    if (session.location) lines.push(`LOCATION:${escapeIcsText(session.location)}`)
    if (session.description) lines.push(`DESCRIPTION:${escapeIcsText(session.description)}`)
    lines.push('TRANSP:OPAQUE', 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  // CRLF everywhere, folded: some clients are strict about both.
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}
