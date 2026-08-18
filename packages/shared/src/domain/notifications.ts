/**
 * What gets sent, to whom, through which channel, and in what language.
 *
 * The catalog is the contract: every event the product can raise, its default
 * channels and its priority. A user's preferences narrow that down, and low
 * priority events can be collected into one daily digest instead of buzzing a
 * phone six times before lunch.
 *
 * Nothing here sends anything — it decides. Delivery (web-push, Nodemailer)
 * belongs to the job worker, and the text always comes from the catalogs in
 * the recipient's stored locale (R1).
 */
import type { AppLocale } from '../i18n/index.js'

export type NotificationChannel = 'inApp' | 'push' | 'email'

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['inApp', 'push', 'email']

export type NotificationPriority = 'high' | 'normal' | 'low'

export type NotificationEvent =
  | 'schedule.published'
  | 'change.requested'
  | 'change.accepted'
  | 'change.approved'
  | 'change.applied'
  | 'change.rejected'
  | 'change.expired'
  | 'absence.reported'
  | 'absence.substituteAssigned'
  | 'message.received'
  | 'message.announcement'
  | 'load.overCapacity'
  | 'calendar.disconnected'
  | 'calendar.restored'

export interface EventDefinition {
  event: NotificationEvent
  priority: NotificationPriority
  /** Channels a user gets unless they say otherwise. */
  defaults: readonly NotificationChannel[]
  /** Channels the user is not allowed to switch off. */
  mandatory?: readonly NotificationChannel[]
  /** i18n keys of the title and body, under `notify.<event>.`. */
  titleKey: string
  bodyKey: string
}

/**
 * Defaults lean quiet: everything lands in the bell, and only what actually
 * changes someone's day is allowed to reach their phone or inbox.
 */
export const NOTIFICATION_EVENTS: readonly EventDefinition[] = [
  {
    event: 'schedule.published',
    priority: 'high',
    defaults: ['inApp', 'push', 'email'],
    mandatory: ['inApp'],
    titleKey: 'notify.schedule.published.title',
    bodyKey: 'notify.schedule.published.body',
  },
  {
    event: 'change.requested',
    priority: 'high',
    defaults: ['inApp', 'push'],
    mandatory: ['inApp'],
    titleKey: 'notify.change.requested.title',
    bodyKey: 'notify.change.requested.body',
  },
  {
    event: 'change.accepted',
    priority: 'normal',
    defaults: ['inApp'],
    titleKey: 'notify.change.accepted.title',
    bodyKey: 'notify.change.accepted.body',
  },
  {
    event: 'change.approved',
    priority: 'normal',
    defaults: ['inApp'],
    titleKey: 'notify.change.approved.title',
    bodyKey: 'notify.change.approved.body',
  },
  {
    event: 'change.applied',
    priority: 'high',
    defaults: ['inApp', 'push', 'email'],
    mandatory: ['inApp'],
    titleKey: 'notify.change.applied.title',
    bodyKey: 'notify.change.applied.body',
  },
  {
    event: 'change.rejected',
    priority: 'normal',
    defaults: ['inApp', 'push'],
    titleKey: 'notify.change.rejected.title',
    bodyKey: 'notify.change.rejected.body',
  },
  {
    event: 'change.expired',
    priority: 'low',
    defaults: ['inApp'],
    titleKey: 'notify.change.expired.title',
    bodyKey: 'notify.change.expired.body',
  },
  {
    event: 'absence.reported',
    priority: 'high',
    defaults: ['inApp', 'push'],
    titleKey: 'notify.absence.reported.title',
    bodyKey: 'notify.absence.reported.body',
  },
  {
    event: 'absence.substituteAssigned',
    priority: 'high',
    defaults: ['inApp', 'push', 'email'],
    mandatory: ['inApp'],
    titleKey: 'notify.absence.substituteAssigned.title',
    bodyKey: 'notify.absence.substituteAssigned.body',
  },
  {
    event: 'message.received',
    priority: 'normal',
    defaults: ['inApp', 'push'],
    titleKey: 'notify.message.received.title',
    bodyKey: 'notify.message.received.body',
  },
  {
    event: 'message.announcement',
    priority: 'high',
    defaults: ['inApp', 'push'],
    mandatory: ['inApp'],
    titleKey: 'notify.message.announcement.title',
    bodyKey: 'notify.message.announcement.body',
  },
  {
    event: 'load.overCapacity',
    priority: 'low',
    defaults: ['inApp'],
    titleKey: 'notify.load.overCapacity.title',
    bodyKey: 'notify.load.overCapacity.body',
  },
  /**
   * A connected calendar stopped accepting us. Nothing will reach that phone
   * again until the person reconnects, so this is not a low-priority notice.
   */
  {
    event: 'calendar.disconnected',
    priority: 'high',
    defaults: ['inApp', 'push', 'email'],
    mandatory: ['inApp'],
    titleKey: 'notify.calendar.disconnected.title',
    bodyKey: 'notify.calendar.disconnected.body',
  },
  /**
   * A class the teacher deleted from their own calendar and we put back —
   * UAcademic is the source of truth, and saying so is what keeps that from
   * feeling like a haunting.
   */
  {
    event: 'calendar.restored',
    priority: 'normal',
    defaults: ['inApp'],
    titleKey: 'notify.calendar.restored.title',
    bodyKey: 'notify.calendar.restored.body',
  },
]

export function eventDefinition(event: NotificationEvent): EventDefinition | undefined {
  return NOTIFICATION_EVENTS.find((entry) => entry.event === event)
}

export interface NotificationPreference {
  event: NotificationEvent
  inApp: boolean
  push: boolean
  email: boolean
  /** Collect this event into the daily digest instead of sending it now. */
  digest: boolean
}

export function defaultPreference(definition: EventDefinition): NotificationPreference {
  return {
    event: definition.event,
    inApp: definition.defaults.includes('inApp'),
    push: definition.defaults.includes('push'),
    email: definition.defaults.includes('email'),
    digest: definition.priority === 'low',
  }
}

export function defaultPreferences(): NotificationPreference[] {
  return NOTIFICATION_EVENTS.map(defaultPreference)
}

export interface DeliveryContext {
  event: NotificationEvent
  preference?: NotificationPreference | undefined
  /** False when the browser never subscribed, or the subscription is gone. */
  hasPushSubscription: boolean
  hasEmail: boolean
  /** `notifications.dailyDigest` of the center; a user can still opt out. */
  digestEnabled: boolean
}

export interface DeliveryPlan {
  /** Channels to deliver right now. */
  channels: NotificationChannel[]
  /** True when the event goes into tonight's digest instead. */
  deferToDigest: boolean
}

/**
 * The channels one event reaches one person through.
 *
 * A mandatory channel cannot be switched off — a teacher must be able to find
 * out that their timetable moved, even if they muted everything else — and a
 * channel with no address (no push subscription, no email) is silently
 * dropped rather than queued to fail.
 */
export function planDelivery(context: DeliveryContext): DeliveryPlan {
  const definition = eventDefinition(context.event)
  if (!definition) return { channels: [], deferToDigest: false }

  const preference = context.preference ?? defaultPreference(definition)
  const mandatory = definition.mandatory ?? []

  const wanted = NOTIFICATION_CHANNELS.filter(
    (channel) => mandatory.includes(channel) || preference[channel],
  )

  const deliverable = wanted.filter((channel) => {
    if (channel === 'push') return context.hasPushSubscription
    if (channel === 'email') return context.hasEmail
    return true
  })

  const defer = context.digestEnabled && preference.digest

  if (!defer) return { channels: deliverable, deferToDigest: false }

  // A deferred event still lands in the bell immediately; it is the push and
  // the email that wait for the digest.
  return {
    channels: deliverable.filter((channel) => channel === 'inApp' || mandatory.includes(channel)),
    deferToDigest: deliverable.some((channel) => channel !== 'inApp'),
  }
}

export interface DigestEntry {
  event: NotificationEvent
  titleKey: string
  bodyKey: string
  params: Record<string, string | number>
  createdAt: Date
}

export interface Digest {
  locale: AppLocale
  entries: DigestEntry[]
  /** Entries grouped by event, newest first inside each group. */
  groups: { event: NotificationEvent; count: number; entries: DigestEntry[] }[]
}

/** One email a day instead of twelve: the grouping the digest template reads. */
export function buildDigest(locale: AppLocale, entries: readonly DigestEntry[]): Digest {
  const groups = new Map<NotificationEvent, DigestEntry[]>()

  for (const entry of [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const bucket = groups.get(entry.event)
    if (bucket) bucket.push(entry)
    else groups.set(entry.event, [entry])
  }

  return {
    locale,
    entries: [...entries],
    groups: [...groups.entries()]
      .map(([event, group]) => ({ event, count: group.length, entries: group }))
      .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event)),
  }
}

/**
 * iOS only delivers web push to a PWA that was added to the home screen
 * (16.4+), and only when the permission was asked for from a real gesture.
 * Detecting that is the difference between an onboarding card and a permission
 * prompt the browser silently denies forever.
 */
export interface PushEnvironment {
  /** `navigator.userAgent`. */
  userAgent: string
  /** `window.matchMedia('(display-mode: standalone)').matches`, or the iOS flag. */
  standalone: boolean
  /** Whether the browser exposes the Push API at all. */
  supportsPush: boolean
  permission: 'default' | 'granted' | 'denied'
}

export type PushReadiness = 'ready' | 'granted' | 'denied' | 'needsInstall' | 'unsupported'

export function isIos(userAgent: string): boolean {
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    // iPadOS 13+ reports itself as a Mac; only touch tells them apart, and the
    // caller passes the user agent it has.
    (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent))
  )
}

export function pushReadiness(environment: PushEnvironment): PushReadiness {
  if (environment.permission === 'granted') return 'granted'
  if (environment.permission === 'denied') return 'denied'
  // On iOS the Push API only exists inside an installed PWA, so "unsupported"
  // there means "not installed yet" — a fixable state with an explanation.
  if (isIos(environment.userAgent) && !environment.standalone) return 'needsInstall'
  if (!environment.supportsPush) return 'unsupported'
  return 'ready'
}
