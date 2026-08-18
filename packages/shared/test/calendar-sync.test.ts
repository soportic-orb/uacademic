import { describe, expect, it } from 'vitest'

import {
  type CalendarEventDraft,
  buildIcsFeed,
  buildVTimezone,
  busyToAvoidEntries,
  classifyFailure,
  eventSignature,
  latencyFor,
  planCalendarSync,
  renderTemplate,
  sequenceFor,
  templateKeys,
  unknownTemplateKeys,
  withExternalBusy,
  zoneOffsetMinutes,
} from '../src/index.js'

const NOW = new Date('2026-09-01T06:00:00.000Z')

function draft(overrides: Partial<CalendarEventDraft> = {}): CalendarEventDraft {
  return {
    sessionId: 'session-1',
    summary: 'MAT1 A',
    location: 'Edifici B · Aula 2.1',
    weekday: 2,
    startTime: '10:00',
    endTime: '12:00',
    dateFrom: new Date('2026-09-14T00:00:00.000Z'),
    dateTo: new Date('2026-12-18T00:00:00.000Z'),
    recurrence: 'weekly',
    timezone: 'Europe/Madrid',
    sequence: 3,
    ...overrides,
  }
}

describe('zone offsets', () => {
  it('reads winter and summer time for a European zone', () => {
    expect(zoneOffsetMinutes('Europe/Madrid', new Date('2026-01-15T12:00:00Z'))).toBe(60)
    expect(zoneOffsetMinutes('Europe/Madrid', new Date('2026-07-15T12:00:00Z'))).toBe(120)
    expect(zoneOffsetMinutes('Atlantic/Canary', new Date('2026-01-15T12:00:00Z'))).toBe(0)
    expect(zoneOffsetMinutes('UTC', new Date('2026-07-15T12:00:00Z'))).toBe(0)
  })
})

describe('VTIMEZONE', () => {
  it('states both transitions for a zone on the European rule', () => {
    const lines = buildVTimezone('Europe/Madrid', 2026)

    expect(lines).toContain('TZID:Europe/Madrid')
    expect(lines).toContain('BEGIN:DAYLIGHT')
    expect(lines).toContain('TZOFFSETFROM:+0100')
    expect(lines).toContain('TZOFFSETTO:+0200')
    // The EU switches at 01:00 UTC, which is 02:00 in Madrid in winter.
    expect(lines).toContain('DTSTART:20260301T020000')
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU')
  })

  it('anchors the Canary transition an hour earlier, as the zone does', () => {
    const lines = buildVTimezone('Atlantic/Canary', 2026)

    expect(lines).toContain('DTSTART:20260301T010000')
    expect(lines).toContain('TZOFFSETTO:+0100')
  })

  it('emits a single component for a zone without summer time', () => {
    const lines = buildVTimezone('UTC', 2026)

    expect(lines.filter((line) => line === 'BEGIN:STANDARD')).toHaveLength(1)
    expect(lines).not.toContain('BEGIN:DAYLIGHT')
  })

  it('says nothing rather than guessing a rule it does not know', () => {
    expect(buildVTimezone('America/New_York', 2026)).toEqual([])
  })
})

describe('the feed', () => {
  const session = {
    id: 'session-1',
    summary: 'MAT1 A',
    weekday: 2 as const,
    startTime: '10:00' as const,
    endTime: '12:00' as const,
    dateFrom: new Date('2026-09-14T00:00:00.000Z'),
    dateTo: new Date('2026-12-18T00:00:00.000Z'),
    recurrence: 'weekly' as const,
  }

  it('carries the timezone, the revision and the confirmed status', () => {
    const feed = buildIcsFeed([{ ...session, sequence: 42, url: 'https://app/x' }], {
      calendarName: 'UAcademic',
      timezone: 'Europe/Madrid',
      now: NOW,
    })

    expect(feed).toContain('BEGIN:VTIMEZONE')
    expect(feed).toContain('DTSTART;TZID=Europe/Madrid:20260915T100000')
    expect(feed).toContain('SEQUENCE:42')
    expect(feed).toContain('STATUS:CONFIRMED')
    expect(feed).toContain('URL:https://app/x')
    expect(feed).toContain('X-PUBLISHED-TTL:PT60M')
  })

  it('keeps a cancelled class in the feed instead of dropping it', () => {
    const feed = buildIcsFeed([{ ...session, status: 'cancelled', sequence: 7 }], {
      calendarName: 'UAcademic',
      timezone: 'Europe/Madrid',
      now: NOW,
    })

    expect(feed).toContain('UID:session-1@uacademic')
    expect(feed).toContain('STATUS:CANCELLED')
    expect(feed).toContain('TRANSP:TRANSPARENT')
  })

  it('falls back to UTC stamps where it cannot describe the zone', () => {
    const feed = buildIcsFeed([session], {
      calendarName: 'UAcademic',
      timezone: 'America/New_York',
      now: NOW,
    })

    expect(feed).not.toContain('BEGIN:VTIMEZONE')
    // 10:00 in New York in September is 14:00 UTC.
    expect(feed).toContain('DTSTART:20260915T140000Z')
  })
})

describe('the sequence number', () => {
  it('grows with every edit and stays a valid 32-bit integer', () => {
    const before = sequenceFor(new Date('2026-09-01T10:00:00Z'))
    const after = sequenceFor(new Date('2026-09-01T10:05:00Z'))

    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThan(2 ** 31 - 1)
    expect(sequenceFor(undefined)).toBe(0)
    expect(sequenceFor(new Date('2000-01-01T00:00:00Z'))).toBe(0)
  })
})

describe('templates', () => {
  it('substitutes what it has and tidies up after what it does not', () => {
    expect(
      renderTemplate('{{subjectCode}} {{groupCode}}', { subjectCode: 'MAT1', groupCode: 'A' }),
    ).toBe('MAT1 A')
    expect(renderTemplate('{{building}} · {{spaceName}}', { spaceName: 'Aula 2.1' })).toBe(
      'Aula 2.1',
    )
    expect(renderTemplate('{{building}} · {{spaceName}}', {})).toBe('')
  })

  it('lists its placeholders and flags the ones that are typos', () => {
    expect(templateKeys('{{subjectCode}} {{groupCode}} {{subjectCode}}')).toEqual([
      'subjectCode',
      'groupCode',
    ])
    expect(unknownTemplateKeys('{{subjectCode}} {{nope}}')).toEqual(['nope'])
  })
})

describe('the sync plan', () => {
  it('creates what is missing, updates what moved and removes what is gone', () => {
    const moved = draft({ sessionId: 'session-2', startTime: '15:00', endTime: '17:00' })
    const plan = planCalendarSync(
      [draft(), moved],
      [
        { sessionId: 'session-1', externalEventId: 'ev-1', signature: eventSignature(draft()) },
        {
          sessionId: 'session-2',
          externalEventId: 'ev-2',
          signature: eventSignature(draft({ sessionId: 'session-2' })),
        },
        { sessionId: 'session-3', externalEventId: 'ev-3', signature: 'whatever' },
      ],
    )

    expect(plan.create).toEqual([])
    expect(plan.unchanged).toBe(1)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.externalEventId).toBe('ev-2')
    expect(plan.remove).toEqual([{ sessionId: 'session-3', externalEventId: 'ev-3' }])
  })

  it('creates an event for a class the remote calendar has never seen', () => {
    const plan = planCalendarSync([draft()], [])

    expect(plan.create).toHaveLength(1)
    expect(plan.update).toEqual([])
  })

  it('ignores a change that no calendar would show', () => {
    const plan = planCalendarSync(
      [draft({ sequence: 99 })],
      [{ sessionId: 'session-1', externalEventId: 'ev-1', signature: eventSignature(draft()) }],
    )

    expect(plan.unchanged).toBe(1)
    expect(plan.update).toEqual([])
  })
})

describe('failures', () => {
  it('parks the connection when the consent is gone and retries otherwise', () => {
    expect(classifyFailure(401)).toBe('dead')
    expect(classifyFailure(403)).toBe('dead')
    expect(classifyFailure(410)).toBe('dead')
    expect(classifyFailure(404)).toBe('missing')
    expect(classifyFailure(429)).toBe('retry')
    expect(classifyFailure(503)).toBe('retry')
  })
})

describe('the latency the UI promises', () => {
  it('is honest about Google being the slow one', () => {
    expect(latencyFor('ics.google').minMinutes).toBeGreaterThanOrEqual(480)
    expect(latencyFor('ics.google').clientControlled).toBe(true)
    expect(latencyFor('api').maxMinutes).toBeLessThanOrEqual(5)
    expect(latencyFor('api').clientControlled).toBe(false)
  })
})

describe('personal busy time as a soft constraint', () => {
  const tuesdayTen = (week: number) => ({
    startAt: new Date(Date.UTC(2026, 8, 1 + 7 * week, 8, 0)),
    endAt: new Date(Date.UTC(2026, 8, 1 + 7 * week, 9, 30)),
  })

  it('keeps only what repeats, rounded to the planner grid', () => {
    const entries = busyToAvoidEntries([tuesdayTen(0), tuesdayTen(1), tuesdayTen(2)], {
      timezone: 'Europe/Madrid',
      slotMinutes: 30,
    })

    // 08:00 UTC in September is 10:00 in Madrid.
    expect(entries).toEqual([{ weekday: 2, startTime: '10:00', endTime: '11:30', level: 'avoid' }])
  })

  it('ignores a one-off meeting', () => {
    expect(
      busyToAvoidEntries([tuesdayTen(0)], { timezone: 'Europe/Madrid', minOccurrences: 2 }),
    ).toEqual([])
  })

  it('ignores an all-day block instead of writing off the whole day', () => {
    const allDay = (week: number) => ({
      startAt: new Date(Date.UTC(2026, 8, 1 + 7 * week, 0, 0)),
      endAt: new Date(Date.UTC(2026, 8, 2 + 7 * week, 0, 0)),
    })

    expect(
      busyToAvoidEntries([allDay(0), allDay(1)], { timezone: 'Europe/Madrid', maxHours: 8 }),
    ).toEqual([])
  })

  it('merges overlapping commitments on the same day', () => {
    const first = (week: number) => ({
      startAt: new Date(Date.UTC(2026, 8, 1 + 7 * week, 8, 0)),
      endAt: new Date(Date.UTC(2026, 8, 1 + 7 * week, 9, 0)),
    })
    const second = (week: number) => ({
      startAt: new Date(Date.UTC(2026, 8, 1 + 7 * week, 8, 30)),
      endAt: new Date(Date.UTC(2026, 8, 1 + 7 * week, 10, 0)),
    })

    expect(
      busyToAvoidEntries([first(0), first(1), second(0), second(1)], {
        timezone: 'Europe/Madrid',
      }),
    ).toEqual([{ weekday: 2, startTime: '10:00', endTime: '12:00', level: 'avoid' }])
  })

  it('never loosens what the teacher declared unavailable', () => {
    const stored = [
      {
        weekday: 2 as const,
        startTime: '08:00' as const,
        endTime: '14:00' as const,
        level: 'unavailable' as const,
      },
    ]
    const external = [
      {
        weekday: 2 as const,
        startTime: '10:00' as const,
        endTime: '11:30' as const,
        level: 'avoid' as const,
      },
    ]

    expect(withExternalBusy(stored, external)).toEqual(stored)
  })

  it('adds the commitment where the week says nothing', () => {
    const external = [
      {
        weekday: 3 as const,
        startTime: '16:00' as const,
        endTime: '18:00' as const,
        level: 'avoid' as const,
      },
    ]

    expect(withExternalBusy([], external)).toEqual(external)
  })
})
