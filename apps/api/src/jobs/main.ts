import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { pino } from 'pino'

import { env } from '../config/env.js'
import { buildJobHandlers, enqueuePeriodicJobs } from './handlers.js'
import { JobWorker } from './worker.js'

/**
 * PM2 entry point for the queue worker. Runs in its own process so a slow
 * email or push delivery never blocks an HTTP request.
 */
const configuration = env()
const logger = pino({ level: configuration.LOG_LEVEL, name: 'jobs' })

const client = getPrismaClient()

const worker = new JobWorker(client, buildJobHandlers(client, logger), {
  workerId: `${process.env.pm_id ?? '0'}@${process.pid}`,
  batchSize: configuration.JOB_BATCH_SIZE,
  logger,
})

// The recurring work — expiring stale change requests, sending the digest —
// is enqueued rather than run inline, so several PM2 workers still do it once.
const PERIODIC_INTERVAL_MS = 15 * 60_000
void enqueuePeriodicJobs(client)
const periodic = setInterval(() => void enqueuePeriodicJobs(client), PERIODIC_INTERVAL_MS)

worker.start(configuration.JOB_POLL_INTERVAL_MS)
logger.info({ intervalMs: configuration.JOB_POLL_INTERVAL_MS }, 'job worker started')

const shutdown = async () => {
  clearInterval(periodic)
  worker.stop()
  await disconnectPrisma()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
