import type { HealthResponse } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { prisma } from '../../lib/prisma.js'

const startedAt = Date.now()

/** Public: the load balancer and PM2 need it before any identity exists. */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', { config: { public: true } }, async (): Promise<HealthResponse> => {
    let database: HealthResponse['checks']['database'] = 'ok'
    try {
      await prisma().$queryRaw`SELECT 1`
    } catch {
      database = 'error'
    }

    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: { database },
    }
  })
}
