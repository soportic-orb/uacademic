import { describe, expect, it } from 'vitest'

import {
  type NotificationPreference,
  NOTIFICATION_EVENTS,
  buildDigest,
  defaultPreference,
  defaultPreferences,
  eventDefinition,
  isIos,
  planDelivery,
  pushReadiness,
} from '../src/domain/notifications.js'
import {
  CONVERSATION_TYPES,
  canManageMembers,
  canPost,
  canRead,
  isReadByAll,
  sortConversations,
  unreadCount,
  validateAttachments,
} from '../src/domain/messaging.js'

const preference = (overrides: Partial<NotificationPreference> = {}): NotificationPreference => ({
  event: 'change.requested',
  inApp: true,
  push: true,
  email: false,
  digest: false,
  ...overrides,
})

describe('the notification catalog', () => {
  it('gives every event a priority, defaults and its two message keys', () => {
    for (const definition of NOTIFICATION_EVENTS) {
      expect(definition.titleKey).toBe(`notify.${definition.event}.title`)
      expect(definition.bodyKey).toBe(`notify.${definition.event}.body`)
      expect(['high', 'normal', 'low']).toContain(definition.priority)
      expect(definition.defaults.length).toBeGreaterThan(0)
    }
  })

  it('defaults low-priority events into the digest and everything else to the bell', () => {
    const expired = defaultPreference(eventDefinition('change.expired')!)
    expect(expired).toMatchObject({ inApp: true, push: false, digest: true })

    const published = defaultPreference(eventDefinition('schedule.published')!)
    expect(published).toMatchObject({ inApp: true, push: true, email: true, digest: false })
    expect(defaultPreferences()).toHaveLength(NOTIFICATION_EVENTS.length)
  })
})

describe('choosing the channels', () => {
  it('sends through the channels the user asked for', () => {
    expect(
      planDelivery({
        event: 'change.requested',
        preference: preference({ email: true }),
        hasPushSubscription: true,
        hasEmail: true,
        digestEnabled: true,
      }),
    ).toEqual({ channels: ['inApp', 'push', 'email'], deferToDigest: false })
  })

  it('honours a user who muted a channel', () => {
    expect(
      planDelivery({
        event: 'change.requested',
        preference: preference({ push: false }),
        hasPushSubscription: true,
        hasEmail: true,
        digestEnabled: false,
      }).channels,
    ).toEqual(['inApp'])
  })

  it('keeps the mandatory channel even for a user who muted everything', () => {
    // Nobody gets to not find out that their own timetable changed.
    expect(
      planDelivery({
        event: 'schedule.published',
        preference: preference({
          event: 'schedule.published',
          inApp: false,
          push: false,
          email: false,
        }),
        hasPushSubscription: true,
        hasEmail: true,
        digestEnabled: false,
      }).channels,
    ).toEqual(['inApp'])
  })

  it('drops a channel with no address instead of queueing a failure', () => {
    expect(
      planDelivery({
        event: 'change.requested',
        preference: preference({ email: true }),
        hasPushSubscription: false,
        hasEmail: false,
        digestEnabled: false,
      }).channels,
    ).toEqual(['inApp'])
  })

  it('defers the noisy channels of a digest event, but still rings the bell', () => {
    const plan = planDelivery({
      event: 'change.expired',
      preference: preference({ event: 'change.expired', push: true, email: true, digest: true }),
      hasPushSubscription: true,
      hasEmail: true,
      digestEnabled: true,
    })

    expect(plan).toEqual({ channels: ['inApp'], deferToDigest: true })
  })

  it('sends immediately when the center has the digest switched off', () => {
    const plan = planDelivery({
      event: 'change.expired',
      preference: preference({ event: 'change.expired', push: true, digest: true }),
      hasPushSubscription: true,
      hasEmail: false,
      digestEnabled: false,
    })

    expect(plan).toEqual({ channels: ['inApp', 'push'], deferToDigest: false })
  })

  it('falls back to the defaults for a user who never chose', () => {
    expect(
      planDelivery({
        event: 'message.received',
        hasPushSubscription: true,
        hasEmail: true,
        digestEnabled: true,
      }).channels,
    ).toEqual(['inApp', 'push'])
  })

  it('says nothing about an event it does not know', () => {
    expect(
      planDelivery({
        event: 'invented.event' as never,
        hasPushSubscription: true,
        hasEmail: true,
        digestEnabled: true,
      }),
    ).toEqual({ channels: [], deferToDigest: false })
  })
})

describe('the daily digest', () => {
  it('groups by event, biggest group first, newest inside', () => {
    const digest = buildDigest('ca', [
      {
        event: 'change.expired',
        titleKey: 'notify.change.expired.title',
        bodyKey: 'notify.change.expired.body',
        params: {},
        createdAt: new Date('2026-10-01T09:00:00Z'),
      },
      {
        event: 'change.expired',
        titleKey: 'notify.change.expired.title',
        bodyKey: 'notify.change.expired.body',
        params: {},
        createdAt: new Date('2026-10-01T18:00:00Z'),
      },
      {
        event: 'load.overCapacity',
        titleKey: 'notify.load.overCapacity.title',
        bodyKey: 'notify.load.overCapacity.body',
        params: {},
        createdAt: new Date('2026-10-01T12:00:00Z'),
      },
    ])

    expect(digest.locale).toBe('ca')
    expect(digest.groups.map((group) => [group.event, group.count])).toEqual([
      ['change.expired', 2],
      ['load.overCapacity', 1],
    ])
    expect(digest.groups[0]?.entries[0]?.createdAt.toISOString()).toBe('2026-10-01T18:00:00.000Z')
  })

  it('is empty when there is nothing to say', () => {
    expect(buildDigest('es', []).groups).toEqual([])
  })
})

describe('push on iOS', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
  const CHROME =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

  it('recognises iPhones and iPads', () => {
    expect(isIos(IPHONE)).toBe(true)
    expect(isIos(CHROME)).toBe(false)
  })

  it('asks an iOS user to install the app before offering push', () => {
    expect(
      pushReadiness({
        userAgent: IPHONE,
        standalone: false,
        supportsPush: false,
        permission: 'default',
      }),
    ).toBe('needsInstall')
  })

  it('offers push once the iOS app runs from the home screen', () => {
    expect(
      pushReadiness({
        userAgent: IPHONE,
        standalone: true,
        supportsPush: true,
        permission: 'default',
      }),
    ).toBe('ready')
  })

  it('reports what the browser already decided', () => {
    expect(
      pushReadiness({
        userAgent: CHROME,
        standalone: false,
        supportsPush: true,
        permission: 'granted',
      }),
    ).toBe('granted')
    expect(
      pushReadiness({
        userAgent: CHROME,
        standalone: false,
        supportsPush: true,
        permission: 'denied',
      }),
    ).toBe('denied')
    expect(
      pushReadiness({
        userAgent: CHROME,
        standalone: false,
        supportsPush: false,
        permission: 'default',
      }),
    ).toBe('unsupported')
  })
})

describe('conversations', () => {
  const access = (overrides: Partial<Parameters<typeof canPost>[0]> = {}) => ({
    type: 'group' as const,
    isMember: true,
    roles: ['TEACHER' as const],
    ...overrides,
  })

  it('covers the four kinds the product defines', () => {
    expect(CONVERSATION_TYPES).toEqual(['direct', 'group', 'subject', 'announcement'])
  })

  it('lets members read and non-members not', () => {
    expect(canRead(access())).toBe(true)
    expect(canRead(access({ isMember: false }))).toBe(false)
  })

  it('makes the announcement channel read-only for teachers', () => {
    expect(canPost(access({ type: 'announcement' }))).toBe(false)
    expect(canPost(access({ type: 'announcement', roles: ['COORDINATOR'] }))).toBe(true)
    expect(canPost(access({ type: 'announcement', roles: ['CENTER_ADMIN'] }))).toBe(true)
    expect(canPost(access({ type: 'subject' }))).toBe(true)
  })

  it('keeps a direct conversation fixed and a subject group in coordination’s hands', () => {
    expect(canManageMembers(access({ type: 'direct', roles: ['CENTER_ADMIN'] }))).toBe(false)
    expect(canManageMembers(access({ type: 'subject' }))).toBe(false)
    expect(canManageMembers(access({ type: 'subject', roles: ['COORDINATOR'] }))).toBe(true)
  })

  it('sorts unread conversations first, then by recency', () => {
    const sorted = sortConversations([
      { id: 'old', type: 'group', title: null, lastMessageAt: new Date('2026-10-01'), unread: 0 },
      { id: 'never', type: 'group', title: null, lastMessageAt: null, unread: 0 },
      { id: 'new', type: 'group', title: null, lastMessageAt: new Date('2026-10-02'), unread: 0 },
      {
        id: 'unread',
        type: 'group',
        title: null,
        lastMessageAt: new Date('2026-09-01'),
        unread: 3,
      },
    ])

    expect(sorted.map((conversation) => conversation.id)).toEqual(['unread', 'new', 'old', 'never'])
  })

  it('counts as unread only what somebody else wrote after the last read mark', () => {
    const messages = [
      { createdAt: new Date('2026-10-01T09:00:00Z'), senderId: 'other' },
      { createdAt: new Date('2026-10-01T10:00:00Z'), senderId: 'me' },
      { createdAt: new Date('2026-10-01T11:00:00Z'), senderId: 'other' },
    ]

    expect(
      unreadCount(messages, { userId: 'me', lastReadAt: new Date('2026-10-01T09:30:00Z') }),
    ).toBe(1)
    expect(unreadCount(messages, { userId: 'me', lastReadAt: null })).toBe(2)
    expect(unreadCount(messages, { userId: 'other', lastReadAt: null })).toBe(1)
  })

  it('marks a message read only when every other member has caught up', () => {
    const message = { createdAt: new Date('2026-10-01T10:00:00Z'), senderId: 'me' }

    expect(
      isReadByAll(message, [
        { userId: 'me', lastReadAt: null },
        { userId: 'a', lastReadAt: new Date('2026-10-01T11:00:00Z') },
        { userId: 'b', lastReadAt: new Date('2026-10-01T10:00:00Z') },
      ]),
    ).toBe(true)

    expect(
      isReadByAll(message, [
        { userId: 'a', lastReadAt: new Date('2026-10-01T11:00:00Z') },
        { userId: 'b', lastReadAt: new Date('2026-10-01T09:00:00Z') },
      ]),
    ).toBe(false)

    // A message with no other members cannot be "read by all".
    expect(isReadByAll(message, [{ userId: 'me', lastReadAt: null }])).toBe(false)
  })
})

describe('attachments', () => {
  it('accepts the everyday document types', () => {
    expect(
      validateAttachments([{ fileName: 'acta.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }]),
    ).toEqual({ ok: true, rejections: [] })
  })

  it('refuses executables and anything else off the list', () => {
    const result = validateAttachments([
      { fileName: 'setup.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 },
    ])
    expect(result.ok).toBe(false)
    expect(result.rejections[0]).toMatchObject({ fileName: 'setup.exe', reason: 'unsupportedType' })
  })

  it('refuses a file over the size limit', () => {
    const result = validateAttachments([
      { fileName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 11 * 1024 * 1024 },
    ])
    expect(result.rejections[0]?.reason).toBe('tooLarge')
  })

  it('refuses more files than a message may carry', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      fileName: `f${index}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
    }))
    expect(validateAttachments(many).rejections[0]?.reason).toBe('tooMany')
  })
})
