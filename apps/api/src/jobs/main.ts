import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { pino } from 'pino'

import { env } from '../config/env.js'
import { JobWorker } from './worker.js'

/**
 * PM2 entry point for the queue worker. Runs in its own process so a slow
 * email or push delivery never blocks an HTTP request.
 */
const configuration = env()
const logger = pino({ level: configuration.LOG_LEVEL, name: 'jobs' })

const worker = new JobWorker(
  getPrismaClient(),
  {
    // Phase 1 fills these in (Nodemailer, web-push, calendar sync). Registering
    // them here keeps the queue contract visible from day one.
    'email.send': async (payload) => {
      logger.info({ payload }, 'email.send is not implemented yet')
    },
    'push.send': async (payload) => {
      logger.info({ payload }, 'push.send is not implemented yet')
    },
    // Queued when a schedule version is published: the in-app notification is
    // written inside the request, the email and the push are delivered here.
    'notification.deliver': async (payload) => {
      logger.info({ payload }, 'notification.deliver: email and push arrive in a later phase')
    },
  },
  {
    workerId: `${process.env.pm_id ?? '0'}@${process.pid}`,
    batchSize: configuration.JOB_BATCH_SIZE,
    logger,
  },
)

worker.start(configuration.JOB_POLL_INTERVAL_MS)
logger.info({ intervalMs: configuration.JOB_POLL_INTERVAL_MS }, 'job worker started')

const shutdown = async () => {
  worker.stop()
  await disconnectPrisma()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
