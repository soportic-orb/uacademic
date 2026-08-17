/**
 * Running the generator and reporting on it.
 *
 * A run is a row in the `jobs` table — the same MySQL-backed queue the rest of
 * the product uses, because there is no Redis on the target hosting. Progress
 * is pushed over SSE for the client that started it and mirrored (throttled)
 * into that row, so a browser that reconnects, or lands on another PM2 worker,
 * can still poll the outcome.
 */
import type { Proposal, SolverProgress } from '@uacademic/shared'
import { Worker } from 'node:worker_threads'

import { prisma } from '../../lib/prisma.js'
import { type RealtimeTransport, centerChannel } from '../../lib/realtime.js'
import { toJson } from '../../lib/json.js'
import type { SolverWorkerInput, SolverWorkerMessage } from './solver-worker.js'

export const GENERATION_JOB_TYPE = 'schedule.generate'

/** The product asks for a 60 s ceiling; a center may only ask for less. */
export const MAX_TIME_BUDGET_MS = 60_000

/** Grace period before the thread is killed outright. */
const TERMINATE_GRACE_MS = 5_000

export interface GenerationRun {
  runId: string
  status: 'processing' | 'done' | 'failed'
  progress: SolverProgress | null
  proposals: Proposal[]
  stoppedEarly: boolean
  error: string | null
}

function workerUrl(): URL {
  // Dev runs the TypeScript directly through tsx; the build ships JavaScript.
  const here = new URL(import.meta.url)
  const extension = here.pathname.endsWith('.ts') ? '.ts' : '.js'
  return new URL(`./solver-worker${extension}`, here)
}

export interface StartGenerationOptions {
  centerId: string
  scheduleVersionId: string
  userId: string
  input: SolverWorkerInput
  bus: RealtimeTransport
}

/**
 * Starts a run and returns immediately with its id. The thread is terminated
 * when the budget expires, so a pathological instance cannot pin a core.
 */
export async function startGeneration(options: StartGenerationOptions): Promise<string> {
  const run = await prisma().job.create({
    data: {
      type: GENERATION_JOB_TYPE,
      status: 'running',
      lockedAt: new Date(),
      payloadJson: toJson({
        centerId: options.centerId,
        scheduleVersionId: options.scheduleVersionId,
        userId: options.userId,
        progress: null,
        proposals: [],
      }),
    },
  })

  const worker = new Worker(workerUrl(), {
    workerData: options.input,
    ...(workerUrl().pathname.endsWith('.ts') ? { execArgv: ['--import', 'tsx'] } : {}),
  })

  const channel = centerChannel(options.centerId)
  let lastPersisted = 0
  let settled = false

  const finish = async (
    status: 'done' | 'failed',
    payload: { proposals?: Proposal[]; stoppedEarly?: boolean; error?: string },
  ) => {
    if (settled) return
    settled = true
    clearTimeout(killer)

    await prisma().job.update({
      where: { id: run.id },
      data: {
        status: status === 'done' ? 'succeeded' : 'failed',
        lastError: payload.error ?? null,
        payloadJson: toJson({
          centerId: options.centerId,
          scheduleVersionId: options.scheduleVersionId,
          userId: options.userId,
          progress: null,
          proposals: payload.proposals ?? [],
          stoppedEarly: payload.stoppedEarly ?? false,
        }),
      },
    })

    options.bus.publish(channel, 'schedule.generation', {
      runId: run.id,
      status,
      scheduleVersionId: options.scheduleVersionId,
      proposals: (payload.proposals ?? []).length,
    })

    await worker.terminate()
  }

  const killer = setTimeout(() => {
    void finish('failed', { error: 'timeout' })
  }, options.input.timeBudgetMs + TERMINATE_GRACE_MS)

  worker.on('message', (message: SolverWorkerMessage) => {
    if (message.type === 'progress') {
      options.bus.publish(channel, 'schedule.generation', {
        runId: run.id,
        status: 'processing',
        scheduleVersionId: options.scheduleVersionId,
        progress: message.progress,
      })

      // One write a second: the row is a fallback, not the transport.
      const now = Date.now()
      if (now - lastPersisted > 1000) {
        lastPersisted = now
        void prisma()
          .job.update({
            where: { id: run.id },
            data: {
              payloadJson: toJson({
                centerId: options.centerId,
                scheduleVersionId: options.scheduleVersionId,
                userId: options.userId,
                progress: message.progress,
                proposals: [],
              }),
            },
          })
          .catch(() => undefined)
      }
      return
    }

    if (message.type === 'done') {
      void finish('done', { proposals: message.proposals, stoppedEarly: message.stoppedEarly })
      return
    }

    void finish('failed', { error: message.message })
  })

  worker.on('error', (error) => void finish('failed', { error: error.message }))
  worker.on('exit', (code) => {
    if (code !== 0) void finish('failed', { error: `worker exited with code ${code}` })
  })

  return run.id
}

/** The state of a run, for a client that polls instead of listening. */
export async function readGeneration(
  runId: string,
  centerId: string,
): Promise<GenerationRun | null> {
  const row = await prisma().job.findFirst({
    where: { id: runId, type: GENERATION_JOB_TYPE },
  })
  if (!row) return null

  const payload = (row.payloadJson ?? {}) as {
    centerId?: string
    progress?: SolverProgress | null
    proposals?: Proposal[]
    stoppedEarly?: boolean
  }
  // R2: a run belongs to the center that started it, even though the queue
  // table itself is platform-wide.
  if (payload.centerId !== centerId) return null

  return {
    runId: row.id,
    status: row.status === 'succeeded' ? 'done' : row.status === 'failed' ? 'failed' : 'processing',
    progress: payload.progress ?? null,
    proposals: payload.proposals ?? [],
    stoppedEarly: payload.stoppedEarly ?? false,
    error: row.lastError,
  }
}
