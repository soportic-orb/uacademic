import { describe, expect, it } from 'vitest'

import {
  type IcsSession,
  buildIcsFeed,
  escapeIcsText,
  firstOccurrence,
  foldIcsLine,
} from '../src/domain/ics.js'

const NOW = new Date('2026-09-01T08:30:00Z')

function session(overrides: Partial<IcsSession> = {}): IcsSession {
  return {
    id: 'session-1',
    summary: 'MAT101 T1',
    location: 'Aula 1.1',
    description: 'Marta Puig',
    weekday: 1,
    startTime: '09:00',
    endTime: '11:00',
    dateFrom: new Date('2026-09-14'),
    dateTo: new Date('2026-10-12'),
    recurrence: 'weekly',
    ...overrides,
  }
}

function feed(sessions: IcsSession[], excludedDates: string[] = []): string {
  return buildIcsFeed(sessions, {
    calendarName: 'UAcademic · Marta Puig',
    timezone: 'Europe/Madrid',
    now: NOW,
    excludedDates,
  })
}

describe('the ICS feed', () => {
  it('is a subscribable calendar with a refresh hint', () => {
    const lines = feed([session()]).split('\r\n')

    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('METHOD:PUBLISH')
    expect(lines).toContain('X-WR-TIMEZONE:Europe/Madrid')
    expect(lines.some((line) => line.startsWith('REFRESH-INTERVAL'))).toBe(true)
    expect(lines.at(-2)).toBe('END:VCALENDAR')
  })

  it('ends every line with CRLF, as strict clients require', () => {
    const raw = feed([session()])
    expect(raw.endsWith('\r\n')).toBe(true)
    expect(raw.includes('\n\n')).toBe(false)
  })

  it('writes a weekly recurring event in the center’s timezone', () => {
    const lines = feed([session()]).split('\r\n')

    expect(lines).toContain('UID:session-1@uacademic')
    expect(lines).toContain('DTSTAMP:20260901T083000Z')
    expect(lines).toContain('DTSTART;TZID=Europe/Madrid:20260914T090000')
    expect(lines).toContain('DTEND;TZID=Europe/Madrid:20260914T110000')
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012T235959Z')
    expect(lines).toContain('LOCATION:Aula 1.1')
  })

  it('starts on the first matching weekday, not on the term’s first day', () => {
    // The term opens on a Monday; a Wednesday class starts two days later.
    const lines = feed([session({ weekday: 3 })]).split('\r\n')

    expect(lines).toContain('DTSTART;TZID=Europe/Madrid:20260916T090000')
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261012T235959Z')
    expect(firstOccurrence(new Date('2026-09-14'), 7)).toEqual(new Date('2026-09-20T00:00:00Z'))
  })

  it('halves the frequency of a biweekly class', () => {
    const lines = feed([session({ recurrence: 'biweekly' })]).split('\r\n')
    expect(lines).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20261012T235959Z')
  })

  it('writes a one-off class without a recurrence rule', () => {
    const lines = feed([session({ recurrence: 'once' })]).split('\r\n')
    // Only the event's own rule counts: VTIMEZONE carries the yearly
    // summer-time transitions, which every feed has.
    const event = lines.slice(lines.indexOf('BEGIN:VEVENT'))
    expect(event.some((line) => line.startsWith('RRULE'))).toBe(false)
  })

  it('removes the days the academic calendar closes', () => {
    // 12 October is a holiday and a Monday, so that occurrence disappears.
    const lines = feed([session()], ['2026-10-12', '2026-12-25']).split('\r\n')

    expect(lines).toContain('EXDATE;TZID=Europe/Madrid:20261012T090000')
  })

  it('does not emit EXDATE for holidays the class never falls on', () => {
    const lines = feed([session()], ['2026-10-13']).split('\r\n')
    expect(lines.some((line) => line.startsWith('EXDATE'))).toBe(false)
  })

  it('skips a session whose term ends before it would ever happen', () => {
    const lines = feed([
      session({ dateFrom: new Date('2026-09-15'), dateTo: new Date('2026-09-18'), weekday: 1 }),
    ]).split('\r\n')

    expect(lines.some((line) => line.startsWith('BEGIN:VEVENT'))).toBe(false)
  })

  it('escapes the characters iCalendar reserves', () => {
    expect(escapeIcsText('Aula 1.1, edifici A; nova\nlínia')).toBe(
      'Aula 1.1\\, edifici A\\; nova\\nlínia',
    )

    const lines = feed([session({ summary: 'MAT101; T1, grup A' })]).split('\r\n')
    expect(lines).toContain('SUMMARY:MAT101\\; T1\\, grup A')
  })

  it('folds long lines into continuations', () => {
    const folded = foldIcsLine(`DESCRIPTION:${'a'.repeat(120)}`)
    const parts = folded.split('\r\n')

    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0]!.length).toBeLessThanOrEqual(75)
    expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true)
  })

  it('keeps one event per session so a republished schedule updates in place', () => {
    const raw = feed([session(), session({ id: 'session-2', weekday: 2 })])
    const uids = raw.split('\r\n').filter((line) => line.startsWith('UID:'))

    expect(uids).toEqual(['UID:session-1@uacademic', 'UID:session-2@uacademic'])
  })

  it('produces a valid empty calendar when there is nothing to publish', () => {
    const raw = feed([])
    expect(raw).toContain('BEGIN:VCALENDAR')
    expect(raw).not.toContain('BEGIN:VEVENT')
  })
})
