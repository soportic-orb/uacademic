import { describe, expect, it } from 'vitest'

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
