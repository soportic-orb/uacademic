import { describe, expect, it } from 'vitest'

import { serialWriter } from '../src/modules/planner/generation.js'

/**
 * The run row carries both the progress mirror and the proposals. The solver
 * reports 100 % immediately before returning its result, so those two writes
 * are issued microseconds apart; concurrently, the progress one could land
 * last and put `proposals: []` back over the result. The run then read as
 * finished with nothing in it — which is what CI caught.
 */
describe('writing to the run row', () => {
  it('applies writes in the order they were asked for, however slow the first', async () => {
    const persist = serialWriter()
    const landed: string[] = []

    const slow = persist(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            landed.push('progress')
            resolve(undefined)
          }, 30),
        ),
    )
    const fast = persist(async () => {
      landed.push('result')
    })

    await Promise.all([slow, fast])

    expect(landed).toEqual(['progress', 'result'])
  })

  it('keeps going after a write that fails, rather than wedging the chain', async () => {
    const persist = serialWriter()
    const landed: string[] = []

    const failed = persist(() => Promise.reject(new Error('connection lost')))
    const after = persist(async () => {
      landed.push('result')
    })

    await expect(failed).resolves.toBeUndefined()
    await after

    expect(landed).toEqual(['result'])
  })
})
