/**
 * The audit viewer.
 *
 * R4 says every business mutation is recorded; this is where that record
 * becomes useful. Filters are the ones an administrator actually needs —
 * entity, person, dates and whether it was a human, the assistant or the
 * system — and the log stays what it is: append-only, never editable, and
 * scoped to the center the reader is in (R2). Only a superadmin sees across
 * centers, and only with the explicit cross-center header.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope } from '../../plugins/context.js'

const querySchema = z.object({
  entity: z.string().max(100).optional(),
  entityId: z.uuid().optional(),
  userId: z.uuid().optional(),
  source: z.enum(['user', 'ai', 'system']).optional(),
  action: z.string().max(50).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export function registerAuditRoutes(app: FastifyInstance): void {
  app.get('/api/v1/audit', { config: { roles: ['CENTER_ADMIN'] } }, async (request) => {
    const { centerId } = requireCenterScope(request)
    const query = parseWith(querySchema, request.query)

    const where = {
      centerId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59Z`) } : {}),
            },
          }
        : {}),
    }

    const [rows, total, entities] = await Promise.all([
      prisma().auditLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma().auditLog.count({ where }),
      // The filter offers what this center has actually recorded, not a
      // hardcoded list that drifts as the product grows.
      prisma().auditLog.groupBy({ by: ['entity'], where: { centerId }, _count: true }),
    ])

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      entities: entities
        .map((entry) => ({ entity: entry.entity, count: entry._count }))
        .sort((a, b) => a.entity.localeCompare(b.entity)),
      items: rows.map((row) => ({
        id: row.id,
        entity: row.entity,
        entityId: row.entityId,
        action: row.action,
        source: row.source,
        userId: row.userId,
        userName: row.user ? `${row.user.firstName} ${row.user.lastName}` : null,
        userEmail: row.user?.email ?? null,
        ip: row.ip,
        before: row.beforeJson,
        after: row.afterJson,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  })
}
