/**
 * What the queue costs when there is nothing in it.
 *
 * An installation is idle most of the time, and the worker's tick used to
 * write to the database twice every five seconds regardless — plus a set of
 * recurring jobs that were all re-enqueued to run *immediately* every fifteen
 * minutes, `mysqldump` among them. Ninety-six full database dumps a day is
 * most of a small server's CPU, taken for a backup nobody asked for.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JobWorker, enqueueJob } from '../src/jobs/worker.js'
import { enqueuePeriodicJobs } from '../src/jobs/handlers.js'
import { hasDatabase } from './helpers.js'

describe.skipIf(!hasDatabase)('the job queue when nothing is happening', () => {
  const prisma = getPrismaClient()

  afterAll(async () => {
    await prisma.job.deleteMany({})
    await disconnectPrisma()
  })

  beforeEach(async () => {
    await prisma.job.deleteMany({})
  })

  it('writes nothing to claim from an empty queue', async () => {
    const worker = new JobWorker(prisma, {}, { workerId: 'test' })

    // The claim is an UPDATE, and an UPDATE opens a write transaction whether
    // or not it matches anything. On an idle queue that is a write every five
    // seconds, for ever.
    const executeRaw = vi.spyOn(prisma, '$executeRaw')
    const processed = await worker.runOnce()

    expect(processed).toBe(0)
    expect(executeRaw).not.toHaveBeenCalled()

    executeRaw.mockRestore()
  })

  it('still claims and runs a job the moment there is one', async () => {
    const ran: unknown[] = []
    const worker = new JobWorker(
      prisma,
      { 'test.echo': async (payload: unknown) => void ran.push(payload) },
      { workerId: 'test' },
    )

    await enqueueJob(prisma, 'test.echo', { hello: 'world' })

    expect(await worker.runOnce()).toBe(1)
    expect(ran).toEqual([{ hello: 'world' }])
  })

  it('leaves a job whose time has not come', async () => {
    const worker = new JobWorker(prisma, {}, { workerId: 'test' })
    await enqueueJob(prisma, 'test.later', {}, { runAt: new Date(Date.now() + 3_600_000) })

    expect(await worker.runOnce()).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('the recurring work', () => {
  const prisma = getPrismaClient()

  afterEach(async () => {
    await prisma.job.deleteMany({})
  })

  const scheduled = async () => {
    await enqueuePeriodicJobs(prisma)
    return prisma.job.findMany({ where: { status: 'pending' }, orderBy: { type: 'asc' } })
  }

  it('schedules each kind exactly once', async () => {
    const jobs = await scheduled()
    const types = jobs.map((job) => job.type)

    expect(new Set(types).size).toBe(types.length)
    expect(types).toContain('db.backup')
    expect(types).toContain('jobs.prune')
  })

  it('does not enqueue a second one while the first is still waiting', async () => {
    const first = await scheduled()
    const second = await scheduled()

    expect(second.length).toBe(first.length)
  })

  it('takes the backup tonight, not now', async () => {
    const jobs = await scheduled()
    const backup = jobs.find((job) => job.type === 'db.backup')

    // `mysqldump` every fifteen minutes is what this replaces.
    expect(backup).toBeDefined()
    expect(backup!.runAt.getTime()).toBeGreaterThan(Date.now() + 60_000)
    expect(backup!.runAt.getHours()).toBe(3)
  })

  it('waits an interval before every sweep, so a restart is not a load spike', async () => {
    const jobs = await scheduled()

    for (const job of jobs) {
      expect(job.runAt.getTime(), job.type).toBeGreaterThan(Date.now())
    }
  })
})
