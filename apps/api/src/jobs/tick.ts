/**
 * One pass of the queue, then exit.
 *
 * The PM2 worker (`jobs/main.ts`) is the normal way to run this: a long-lived
 * process that polls. On a shared host where long-running daemons are
 * discouraged — or simply not allowed — a cron entry every minute calls this
 * instead, and the two are interchangeable because claiming a job is a
 * conditional UPDATE, not a lock held in memory.
 *
 *     * * * * * /usr/bin/flock -n /tmp/uacademic-jobs.lock \
 *         node /var/www/uacademic/current/apps/api/dist/jobs/tick.js
 *
 * `flock` keeps a slow batch from being overtaken by the next minute's run;
 * the stale-lock recovery below covers the case where one was killed anyway.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { pino } from 'pino'

import { env } from '../config/env.js'
import { buildJobHandlers, enqueuePeriodicJobs } from './handlers.js'
import { JobWorker } from './worker.js'

const configuration = env()
const logger = pino({ level: configuration.LOG_LEVEL, name: 'jobs-tick' })
const client = getPrismaClient()

const worker = new JobWorker(client, buildJobHandlers(client, logger), {
  workerId: `cron@${process.pid}`,
  batchSize: configuration.JOB_BATCH_SIZE,
  logger,
})

try {
  const recovered = await worker.recoverStaleJobs()
  await enqueuePeriodicJobs(client)

  // Several batches per minute, but bounded: a cron run that never returns is
  // worse than one that leaves work for the next minute.
  let processed = 0
  for (let pass = 0; pass < 10; pass += 1) {
    const done = await worker.runOnce()
    processed += done
    if (done === 0) break
  }

  if (processed > 0 || recovered > 0) logger.info({ processed, recovered }, 'jobs.tick')
} finally {
  await disconnectPrisma()
}
