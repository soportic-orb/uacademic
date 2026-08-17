import type { PrismaClient } from '@uacademic/db'

/**
 * R4: every business mutation is recorded with before/after, its author and
 * where it came from. The table is INSERT-only — nothing in the codebase ever
 * updates or deletes an audit row.
 */
export type AuditSource = 'user' | 'ai' | 'system'

export interface AuditEntry {
  centerId: string | null
  userId: string | null
  entity: string
  entityId: string
  action: string
  before?: unknown
  after?: unknown
  source: AuditSource
  ip?: string | null
}

export async function writeAuditLog(client: PrismaClient, entry: AuditEntry): Promise<void> {
  await client.auditLog.create({
    data: {
      centerId: entry.centerId,
      userId: entry.userId,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: (entry.before ?? null) as never,
      afterJson: (entry.after ?? null) as never,
      source: entry.source,
      ip: entry.ip ?? null,
    },
  })
}
