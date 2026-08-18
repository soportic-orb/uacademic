import { PrismaMariaDb } from '@prisma/adapter-mariadb'

import { PrismaClient } from './generated/prisma/client.js'

export * from './generated/prisma/client.js'

/**
 * Prisma 7 talks to MySQL through a driver adapter, so there is no Rust engine
 * binary to ship — one less moving part on a shared Plesk/CloudPanel host.
 *
 * The URL is read from `UACADEMIC_DATABASE_URL`, never from a bare
 * `DATABASE_URL`: on a host shared with other applications that name belongs to
 * whoever set it last, and connecting to somebody else's database is not a
 * mistake worth risking.
 */
export function createPrismaClient(databaseUrl = process.env.UACADEMIC_DATABASE_URL): PrismaClient {
  if (!databaseUrl) {
    throw new Error('UACADEMIC_DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  }

  const adapter = new PrismaMariaDb(databaseUrl)

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : process.env.NODE_ENV === 'test'
          ? ['error']
          : ['warn', 'error'],
  })
}

let singleton: PrismaClient | undefined

/**
 * Shared instance for the API process. PM2 runs a handful of workers on the
 * same host, so each process keeps exactly one pool.
 */
export function getPrismaClient(): PrismaClient {
  singleton ??= createPrismaClient()
  return singleton
}

export async function disconnectPrisma(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect()
    singleton = undefined
  }
}
