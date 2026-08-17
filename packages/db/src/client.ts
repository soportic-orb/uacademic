import { PrismaMariaDb } from '@prisma/adapter-mariadb'

import { PrismaClient } from './generated/prisma/client.js'

export * from './generated/prisma/client.js'

/**
 * Prisma 7 talks to MySQL through a driver adapter, so there is no Rust engine
 * binary to ship — one less moving part on a shared Plesk/CloudPanel host.
 */
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
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
