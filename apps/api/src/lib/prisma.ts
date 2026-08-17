import { type PrismaClient, getPrismaClient } from '@uacademic/db'

import { applyTenantScope, isTenantScoped, verifyResultCenter } from './tenant-scope.js'

export type { PrismaClient }

export function prisma(): PrismaClient {
  return getPrismaClient()
}

/**
 * Returns a Prisma client that cannot read or write another center's rows.
 * Repositories always take one of these, never the raw client.
 *
 * Note there is no "skip the filter" option, not even for SUPERADMIN: crossing
 * centers means the membership check is waived and the access is audited, but
 * the queries are still scoped to the center that was explicitly requested.
 * A client that returns every center's rows at once is how tenant leaks start.
 */
export function scopedPrisma(client: PrismaClient, centerId: string): PrismaClient {
  // The extension changes behaviour, not shape: every model and operation is
  // still the same. The annotation is what keeps the inferred type nameable
  // across package boundaries (TS2742).
  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantScoped(model)) return query(args)

          const scoped = applyTenantScope(
            model,
            operation,
            (args ?? {}) as Record<string, unknown>,
            centerId,
          )
          const result = await query(scoped.args)
          return scoped.verifyResultCenter ? verifyResultCenter(result, centerId) : result
        },
      },
    },
  })

  return extended as unknown as PrismaClient
}

export type ScopedPrismaClient = PrismaClient
