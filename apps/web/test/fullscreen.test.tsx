/**
 * The button that fills the screen.
 *
 * A page cannot resize the window it is in, so "maximise" is the Fullscreen
 * API. What matters is that the icon follows the document rather than the
 * click: the browser hands fullscreen back on Escape, on a refusal and on some
 * tab switches, and a button that then still says "minimise" is lying.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FullscreenButton } from '../src/components/layout/fullscreen-button'
import { useFullscreenStore } from '../src/stores/fullscreen'

/** A document that behaves like a browser's, including the event. */
function stubFullscreen(options: { enabled?: boolean } = {}) {
  const request = vi.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
  })

  const exit = vi.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    document.dispatchEvent(new Event('fullscreenchange'))
  })

  Object.defineProperty(document, 'fullscreenEnabled', {
    configurable: true,
    value: options.enabled ?? true,
  })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: request,
  })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })

  return { request, exit }
}

beforeEach(() => {
  useFullscreenStore.setState({ active: false })
})

afterEach(() => vi.restoreAllMocks())

describe('filling the screen', () => {
  it('asks the browser for it, and gives it back', async () => {
    const { request, exit } = stubFullscreen()
    render(<FullscreenButton />)

    await userEvent.click(screen.getByRole('button', { name: 'Maximitza la finestra' }))
    expect(request).toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('button', { name: 'Minimitza la finestra' }))
    expect(exit).toHaveBeenCalled()
  })

  it('follows the document when the browser gives it back on its own', async () => {
    stubFullscreen()
    render(<FullscreenButton />)

    await userEvent.click(screen.getByRole('button', { name: 'Maximitza la finestra' }))
    await screen.findByRole('button', { name: 'Minimitza la finestra' })

    // Escape, a tab switch, a refusal: the page is not told, it is changed.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    document.dispatchEvent(new Event('fullscreenchange'))

    expect(await screen.findByRole('button', { name: 'Maximitza la finestra' })).toBeInTheDocument()
  })

  it('says which state it is in, for somebody who cannot see the icon', async () => {
    stubFullscreen()
    render(<FullscreenButton />)

    const button = screen.getByRole('button', { name: 'Maximitza la finestra' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(button)
    expect(await screen.findByRole('button', { name: 'Minimitza la finestra' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('is not drawn at all where the browser will not allow it', () => {
    // An iPhone does not. A control that does nothing is worse than none.
    stubFullscreen({ enabled: false })
    render(<FullscreenButton />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
