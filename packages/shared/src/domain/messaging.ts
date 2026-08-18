/**
 * Who may read and write in each kind of conversation.
 *
 * The rules are small but they are the ones that would hurt if the API and the
 * UI disagreed: an announcement channel where a teacher can post is not an
 * announcement channel, and a subject group that a colleague from another
 * subject can read is a leak.
 */
import type { Role } from '../schemas/common.js'

export type ConversationType = 'direct' | 'group' | 'subject' | 'announcement'

export const CONVERSATION_TYPES: readonly ConversationType[] = [
  'direct',
  'group',
  'subject',
  'announcement',
]

export interface ConversationAccess {
  type: ConversationType
  /** Whether the reader is a member of this conversation. */
  isMember: boolean
  /** Roles the reader holds in the conversation's center. */
  roles: readonly Role[]
}

export function canRead(access: ConversationAccess): boolean {
  // The center-wide announcement channel is readable by everyone in it; the
  // membership rows are what make that explicit rather than implicit.
  return access.isMember
}

/**
 * Announcements are read-only for everyone but coordination and the center
 * administration — that is the entire point of the channel.
 */
export function canPost(access: ConversationAccess): boolean {
  if (!access.isMember) return false
  if (access.type !== 'announcement') return true
  return access.roles.some((role) => role === 'COORDINATOR' || role === 'CENTER_ADMIN')
}

/** Who may add or remove people. Direct conversations are fixed at creation. */
export function canManageMembers(access: ConversationAccess): boolean {
  if (access.type === 'direct') return false
  if (access.type === 'subject') return access.roles.includes('COORDINATOR')
  return access.roles.some((role) => role === 'COORDINATOR' || role === 'CENTER_ADMIN')
}

export interface ConversationSummary {
  id: string
  type: ConversationType
  title: string | null
  subjectCode?: string | null
  lastMessageAt: Date | null
  unread: number
}

/**
 * The inbox order: unread first, then by recency. A conversation nobody has
 * written in yet sorts last rather than randomly.
 */
export function sortConversations(
  conversations: readonly ConversationSummary[],
): ConversationSummary[] {
  return [...conversations].sort((a, b) => {
    if (a.unread > 0 !== b.unread > 0) return a.unread > 0 ? -1 : 1
    const left = a.lastMessageAt?.getTime() ?? 0
    const right = b.lastMessageAt?.getTime() ?? 0
    return right - left
  })
}

/** Messages a member has not seen: everything after their last read mark. */
export function unreadCount(
  messages: readonly { createdAt: Date; senderId: string }[],
  member: { userId: string; lastReadAt: Date | null },
): number {
  return messages.filter(
    (message) =>
      message.senderId !== member.userId &&
      (!member.lastReadAt || message.createdAt.getTime() > member.lastReadAt.getTime()),
  ).length
}

/** True when everyone else in the conversation has read up to this message. */
export function isReadByAll(
  message: { createdAt: Date; senderId: string },
  members: readonly { userId: string; lastReadAt: Date | null }[],
): boolean {
  const others = members.filter((member) => member.userId !== message.senderId)
  if (others.length === 0) return false
  return others.every(
    (member) => member.lastReadAt && member.lastReadAt.getTime() >= message.createdAt.getTime(),
  )
}

export const MAX_ATTACHMENT_MB = 10
export const MAX_ATTACHMENTS = 5

const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

export interface AttachmentInput {
  fileName: string
  mimeType: string
  sizeBytes: number
}

export type AttachmentRejection = 'tooLarge' | 'unsupportedType' | 'tooMany'

/**
 * What may travel with a message. Deliberately a short allow-list: this is an
 * internal tool, and an inbox that accepts anything is an inbox that ships
 * malware between colleagues.
 */
export function validateAttachments(attachments: readonly AttachmentInput[]): {
  ok: boolean
  rejections: { fileName: string; reason: AttachmentRejection }[]
} {
  const rejections: { fileName: string; reason: AttachmentRejection }[] = []

  if (attachments.length > MAX_ATTACHMENTS) {
    rejections.push({ fileName: '', reason: 'tooMany' })
  }

  for (const attachment of attachments) {
    if (attachment.sizeBytes > MAX_ATTACHMENT_MB * 1024 * 1024) {
      rejections.push({ fileName: attachment.fileName, reason: 'tooLarge' })
    } else if (!ALLOWED_ATTACHMENT_TYPES.includes(attachment.mimeType)) {
      rejections.push({ fileName: attachment.fileName, reason: 'unsupportedType' })
    }
  }

  return { ok: rejections.length === 0, rejections }
}
