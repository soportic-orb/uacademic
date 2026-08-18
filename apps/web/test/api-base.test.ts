import { describe, expect, it } from 'vitest'

import { resolveApiBaseUrl } from '../src/lib/api-base'

/**
 * Where the built application looks for the API.
 *
 * Worth a test because getting it wrong is invisible until somebody else's
 * browser tries: a production bundle carrying `localhost:3001` sends every
 * reader to their own machine, and what they see is a generic error with
 * nothing in any server log to explain it.
 */
describe('the API base address', () => {
  it('is the page’s own origin in a build nobody configured', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('')
  })

  it('names the API port in development, where the two servers differ', () => {
    expect(resolveApiBaseUrl(undefined, true)).toBe('http://localhost:3001')
  })

  it('obeys an explicit address, for a web app served from another origin', () => {
    expect(resolveApiBaseUrl('https://api.example.edu', false)).toBe('https://api.example.edu')
  })
})
