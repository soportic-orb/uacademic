/**
 * Data protection, as something the product can actually answer for.
 *
 * Three questions have to be answerable at any moment: what is held about a
 * person, what happens when they ask for it to be gone, and how long anything
 * is kept. The first two are endpoints; the third is a setting, because "how
 * long do you keep an audit log?" has a different answer in every institution.
 *
 * The register below is the record of processing activities — the thing an
 * institution has to be able to produce — written against what this codebase
 * actually stores, not against what a template says it might.
 */
import { z } from 'zod'

/**
 * Retention, in days. Zero means "keep it": some of this is evidence, and a
 * center that has to keep six years of audit is not misconfigured.
 */
export const privacySettingsSchema = z.object({
  /** Business-data audit trail (R4). Long by default: it is the evidence. */
  auditLogDays: z.number().int().min(0).max(3_650).default(2_190),
  /** Read notifications: the event they announce lives on elsewhere. */
  notificationDays: z.number().int().min(0).max(1_095).default(180),
  /** Assistant transcripts and their token accounting. */
  aiInteractionDays: z.number().int().min(0).max(1_095).default(365),
  /** Sign-in sessions that have expired. */
  authSessionDays: z.number().int().min(0).max(365).default(30),
  /** Whether teachers may export their own data without asking anybody. */
  selfServiceExport: z.boolean().default(true),
  /** Contact address for the institution's data protection officer. */
  dataProtectionContact: z.string().max(200).default(''),
})

export type PrivacySettings = z.infer<typeof privacySettingsSchema>

/**
 * What an erasure actually does — and, just as importantly, what it does not.
 *
 * A university cannot forget that a class was taught, who approved a schedule
 * change, or that a rule was applied: the academic record and the audit trail
 * are kept under a legal obligation and a legitimate interest respectively.
 * What can go is the person: their name, their address, their devices, their
 * preferences and everything written in the first person.
 *
 * Saying this before somebody confirms is the difference between erasure and
 * a promise that cannot be kept.
 */
export const ERASED_ON_REQUEST = [
  'name',
  'email',
  'avatar',
  'microsoftAccount',
  'sessions',
  'pushSubscriptions',
  'calendarConnections',
  'calendarFeeds',
  'notificationPreferences',
  'notifications',
  'assistantConversations',
  'availabilityNotes',
] as const

export const KEPT_AFTER_ERASURE = [
  'classSessions',
  'assignments',
  'auditTrail',
  'changeRequestHistory',
  'messagesToOthers',
  'consentRecords',
] as const

export type ErasedCategory = (typeof ERASED_ON_REQUEST)[number]
export type KeptCategory = (typeof KEPT_AFTER_ERASURE)[number]

/** i18n keys for the two lists above, so the UI never hardcodes them. */
export function erasureLabelKey(category: string): string {
  return `privacy.erasure.categories.${category}`
}

/**
 * The record of processing activities (GDPR art. 30), derived from what the
 * platform stores rather than from a template. Each entry names the data, why
 * it is held, on what basis, and how long.
 */
export interface ProcessingActivity {
  key: string
  /** Where it lives, so an audit can be carried out against the schema. */
  tables: readonly string[]
  /** `retentionKey` points at the setting that governs it, when one does. */
  retentionKey: keyof PrivacySettings | null
  /** Whether anything leaves the institution's own server for this. */
  externalRecipient: 'none' | 'microsoft' | 'google' | 'anthropic' | 'email' | 'push'
}

export const PROCESSING_ACTIVITIES: readonly ProcessingActivity[] = [
  {
    key: 'identity',
    tables: ['users', 'user_center_roles', 'auth_sessions', 'local_credentials'],
    retentionKey: 'authSessionDays',
    externalRecipient: 'microsoft',
  },
  {
    key: 'teaching',
    tables: ['teacher_profiles', 'teacher_capacities', 'teacher_reductions', 'assignments'],
    retentionKey: null,
    externalRecipient: 'none',
  },
  {
    key: 'availability',
    tables: ['teacher_availability', 'availability_exceptions', 'external_busy_slots'],
    retentionKey: null,
    externalRecipient: 'none',
  },
  {
    key: 'schedule',
    tables: ['class_sessions', 'schedule_versions', 'change_requests', 'absences'],
    retentionKey: null,
    externalRecipient: 'none',
  },
  {
    key: 'communication',
    tables: ['conversations', 'messages', 'notifications', 'push_subscriptions'],
    retentionKey: 'notificationDays',
    externalRecipient: 'push',
  },
  {
    key: 'calendar',
    tables: ['calendar_connections', 'calendar_event_map', 'calendar_feed_tokens'],
    retentionKey: null,
    externalRecipient: 'google',
  },
  {
    key: 'assistant',
    tables: ['ai_conversations', 'ai_messages', 'ai_interactions', 'ai_proposals'],
    retentionKey: 'aiInteractionDays',
    externalRecipient: 'anthropic',
  },
  {
    key: 'audit',
    tables: ['audit_log', 'consent_records'],
    retentionKey: 'auditLogDays',
    externalRecipient: 'none',
  },
] as const

export function activityLabelKey(key: string): string {
  return `privacy.activities.${key}.title`
}

export function activityPurposeKey(key: string): string {
  return `privacy.activities.${key}.purpose`
}

export function activityBasisKey(key: string): string {
  return `privacy.activities.${key}.basis`
}

/** The cut-off date a retention setting implies, or null when it keeps. */
export function retentionCutoff(days: number, now: Date = new Date()): Date | null {
  if (days <= 0) return null
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}
