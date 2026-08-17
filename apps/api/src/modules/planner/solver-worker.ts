/**
 * The generator, in its own thread.
 *
 * Annealing is CPU-bound for as long as its budget allows, and the API serves
 * other requests meanwhile — on a shared host with a couple of cores that is
 * the difference between "the planner is thinking" and "the site is down".
 *
 * The thread receives plain data (maps travel as arrays), runs the pure solver
 * from `@uacademic/shared`, and posts progress back so the route can push it
 * over SSE.
 */
import {
  type GroupResource,
  type PlannedSession,
  type Proposal,
  type ScheduleContext,
  type SessionRequirement,
  type SolverProgress,
  type SpaceResource,
  type TeacherResource,
  generateSchedule,
} from '@uacademic/shared'
import { parentPort, workerData } from 'node:worker_threads'

export interface SolverWorkerInput {
  settings: ScheduleContext['settings']
  teachers: TeacherResource[]
  spaces: SpaceResource[]
  groups: GroupResource[]
  requirements: SessionRequirement[]
  fixed: PlannedSession[]
  seed: number
  timeBudgetMs: number
  proposals: number
}

export type SolverWorkerMessage =
  | { type: 'progress'; progress: SolverProgress }
  | {
      type: 'done'
      proposals: Proposal[]
      iterations: number
      elapsedMs: number
      stoppedEarly: boolean
    }
  | { type: 'error'; message: string }

function run(input: SolverWorkerInput): void {
  const context: ScheduleContext = {
    settings: input.settings,
    teachers: new Map(input.teachers.map((entry) => [entry.teacherProfileId, entry])),
    spaces: new Map(input.spaces.map((entry) => [entry.spaceId, entry])),
    groups: new Map(input.groups.map((entry) => [entry.groupId, entry])),
  }

  const result = generateSchedule(
    {
      context,
      requirements: input.requirements,
      fixed: input.fixed,
    },
    {
      seed: input.seed,
      timeBudgetMs: input.timeBudgetMs,
      proposals: input.proposals,
      onProgress: (progress) => parentPort?.postMessage({ type: 'progress', progress }),
    },
  )

  parentPort?.postMessage({
    type: 'done',
    proposals: result.proposals,
    iterations: result.iterations,
    elapsedMs: result.elapsedMs,
    stoppedEarly: result.stoppedEarly,
  })
}

if (parentPort) {
  try {
    run(workerData as SolverWorkerInput)
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
