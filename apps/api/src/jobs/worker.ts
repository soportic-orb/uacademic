import type { PrismaClient } from '@uacademic/db'
import type { Logger } from 'pino'

/**
 * The job queue is a MySQL table polled by a worker: there is no Redis on the
 * target hosting, so BullMQ is not an option (CLAUDE.md §2).
 *
 * PM2 may run several workers on the same host, so a job is claimed with a
 * conditional UPDATE … LIMIT and released only when it finishes. Two workers
 * cannot pick the same row.
 */
export interface JobRow {
  id: string
  type: string
  payload_json: unknown
  attempts: number
  max_attempts: number
}

export type JobHandler = (payload: unknown) => Promise<void>

export interface JobWorkerOptions {
  workerId: string
  batchSize?: number
  /** A job locked for longer than this is considered dead and is retried. */
  staleLockMs?: number
  /** Base delay for exponential backoff between attempts. */
  retryBaseMs?: number
  logger?: Logger
}

export class JobWorker {
  readonly #prisma: PrismaClient
  readonly #handlers: Map<string, JobHandler>
  readonly #options: Required<Omit<JobWorkerOptions, 'logger'>> & { logger?: Logger }
  #timer: NodeJS.Timeout | undefined
  #running = false

  constructor(
    prisma: PrismaClient,
    handlers: Record<string, JobHandler>,
    options: JobWorkerOptions,
  ) {
    this.#prisma = prisma
    this.#handlers = new Map(Object.entries(handlers))
    this.#options = {
      workerId: options.workerId,
      batchSize: options.batchSize ?? 5,
      staleLockMs: options.staleLockMs ?? 5 * 60_000,
      retryBaseMs: options.retryBaseMs ?? 30_000,
      ...(options.logger ? { logger: options.logger } : {}),
    }
  }

  /** Requeues jobs whose worker died mid-flight. */
  async recoverStaleJobs(): Promise<number> {
    const threshold = new Date(Date.now() - this.#options.staleLockMs)
    return this.#prisma.$executeRaw`
      UPDATE jobs
         SET status = 'pending', locked_at = NULL, locked_by = NULL
       WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ${threshold}
    `
  }

  /** Claims and runs one batch. Returns how many jobs were processed. */
  async runOnce(): Promise<number> {
    const now = new Date()

    const claimed = await this.#prisma.$executeRaw`
      UPDATE jobs
         SET status = 'running', locked_at = ${now}, locked_by = ${this.#options.workerId}
       WHERE status = 'pending' AND run_at <= ${now} AND locked_at IS NULL
       ORDER BY run_at ASC
       LIMIT ${this.#options.batchSize}
    `
    if (claimed === 0) return 0

    const jobs = await this.#prisma.$queryRaw<JobRow[]>`
      SELECT id, type, payload_json, attempts, max_attempts
        FROM jobs
       WHERE status = 'running' AND locked_by = ${this.#options.workerId}
    `

    for (const job of jobs) {
      await this.#process(job)
    }

    return jobs.length
  }

  async #process(job: JobRow): Promise<void> {
    const handler = this.#handlers.get(job.type)

    if (!handler) {
      await this.#fail(job, `No handler registered for job type "${job.type}"`, true)
      return
    }

    try {
      const payload =
        typeof job.payload_json === 'string' ? JSON.parse(job.payload_json) : job.payload_json
      await handler(payload)
      await this.#prisma.job.update({
        where: { id: job.id },
        data: { status: 'succeeded', lockedAt: null, lockedBy: null, lastError: null },
      })
      this.#options.logger?.info({ jobId: job.id, type: job.type }, 'job succeeded')
    } catch (error) {
      await this.#fail(job, error instanceof Error ? error.message : String(error), false)
    }
  }

  async #fail(job: JobRow, message: string, terminal: boolean): Promise<void> {
    const attempts = job.attempts + 1
    const exhausted = terminal || attempts >= job.max_attempts

    await this.#prisma.job.update({
      where: { id: job.id },
      data: {
        attempts,
        status: exhausted ? 'dead' : 'pending',
        lockedAt: null,
        lockedBy: null,
        lastError: message.slice(0, 2000),
        // Exponential backoff: a failing mail server should not be hammered.
        runAt: exhausted
          ? undefined
          : new Date(Date.now() + this.#options.retryBaseMs * 2 ** attempts),
      },
    })

    this.#options.logger?.warn(
      { jobId: job.id, type: job.type, attempts, exhausted, error: message },
      'job failed',
    )
  }

  start(intervalMs: number): void {
    if (this.#running) return
    this.#running = true

    const tick = async () => {
      try {
        await this.recoverStaleJobs()
        await this.runOnce()
      } catch (error) {
        this.#options.logger?.error({ err: error }, 'job worker tick failed')
      }
    }

    this.#timer = setInterval(() => void tick(), intervalMs)
    void tick()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
    this.#running = false
  }
}

/** Enqueues a job. Callers never touch the table directly. */
export async function enqueueJob(
  prisma: PrismaClient,
  type: string,
  payload: unknown,
  options: { runAt?: Date; maxAttempts?: number } = {},
): Promise<string> {
  const job = await prisma.job.create({
    data: {
      type,
      payloadJson: (payload ?? {}) as never,
      runAt: options.runAt ?? new Date(),
      maxAttempts: options.maxAttempts ?? 5,
    },
  })
  return job.id
}
