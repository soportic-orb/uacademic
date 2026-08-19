import { BrowserAuthError, BrowserAuthErrorCodes, ServerError } from '@azure/msal-browser'
import { describe, expect, it } from 'vitest'

import { describeEntraFailure } from '../src/auth/msal'
import { isSignInPopup } from '../src/auth/popup'

/**
 * The window Microsoft sends the answer back to. Booting the application in it
 * used to lose that answer to a service-worker reload, leaving a blank pop-up
 * that never closed.
 */
function fakeWindow(opener: unknown, url: string): Window {
  const parsed = new URL(url)
  return {
    opener,
    location: { hash: parsed.hash, search: parsed.search },
  } as unknown as Window
}

describe('recognising the sign-in pop-up', () => {
  it('holds back when a pop-up carries an authorization code', () => {
    const popup = fakeWindow({}, 'https://uacademic.cat/#code=0.AX0&state=abc')
    expect(isSignInPopup(popup)).toBe(true)
  })

  it('holds back when Microsoft answered with an error instead', () => {
    const popup = fakeWindow({}, 'https://uacademic.cat/#error=access_denied')
    expect(isSignInPopup(popup)).toBe(true)
  })

  it('starts normally in the window somebody is actually using', () => {
    expect(isSignInPopup(fakeWindow(null, 'https://uacademic.cat/planning'))).toBe(false)
  })

  it('starts normally in a pop-up that is not an authentication answer', () => {
    expect(isSignInPopup(fakeWindow({}, 'https://uacademic.cat/print#top'))).toBe(false)
  })
})

describe('reporting what Microsoft refused', () => {
  it('carries the AADSTS code and its first line, not "unexpected error"', () => {
    // `(errorCode, correlationId, errorMessage, …)` — the description Microsoft
    // sent is the third argument, not the second.
    const error = new ServerError(
      'invalid_request',
      'correlation-id',
      "AADSTS50011: The redirect URI 'https://uacademic.cat/auth-callback.html' specified in the request does not match the redirect URIs configured for the application.\r\nTrace ID: abc",
    )

    const failure = describeEntraFailure(error)

    expect(failure.cancelled).toBe(false)
    expect(failure.detail).toContain('AADSTS50011')
    expect(failure.detail).toContain('auth-callback.html')
    expect(failure.detail).not.toContain('Trace ID')
  })

  it('says nothing when the person simply closed the window', () => {
    const error = new BrowserAuthError(BrowserAuthErrorCodes.userCancelled, 'correlation-id')

    expect(describeEntraFailure(error).cancelled).toBe(true)
  })

  it('still describes a failure that did not come from MSAL at all', () => {
    expect(describeEntraFailure(new Error('Failed to fetch')).detail).toBe('Failed to fetch')
  })
})
