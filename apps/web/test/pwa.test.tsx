import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyPendingUpdate, clearApiCache } from '../src/app/service-worker'
import { InstallPrompt } from '../src/features/pwa/install-prompt'
import { OfflineBanner } from '../src/features/pwa/offline-banner'

function setUserAgent(value: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true })
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  })
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/140')
  setOnline(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('installing the app', () => {
  it('says nothing at all until the browser offers an install', () => {
    const { container } = render(<InstallPrompt />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the browser’s prompt back and hands it over when the person asks', async () => {
    const prompt = vi.fn(async () => {})
    render(<InstallPrompt />)

    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    const prevented = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    // The browser's own banner is suppressed; ours appears instead.
    expect(prevented).toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Instal·la' }))
    expect(prompt).toHaveBeenCalled()
  })

  it('gives iOS the manual steps, because Safari has no prompt to offer', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')

    render(<InstallPrompt />)

    expect(screen.getByText(/botó Compartir de Safari/)).toBeInTheDocument()
    expect(screen.getByText(/Afegir a la pantalla d’inici/)).toBeInTheDocument()
    // And why it matters there: no home screen, no notifications.
    expect(
      screen.getByText(/només arriben si l’app està a la pantalla d’inici/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Instal·la' })).not.toBeInTheDocument()
  })

  it('stays dismissed once it has been declined', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')

    const { unmount } = render(<InstallPrompt />)
    await userEvent.click(screen.getByRole('button', { name: 'Tanca' }))
    unmount()

    const { container } = render(<InstallPrompt />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('being offline', () => {
  it('says nothing while there is a network', () => {
    const { container } = render(<OfflineBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('tells a teacher their timetable is the saved copy, not a failure', () => {
    setOnline(false)

    render(<OfflineBanner scope="calendar" />)

    expect(screen.getByRole('status')).toHaveTextContent(/últim horari desat al dispositiu/)
  })

  it('is plainer about screens that do not survive without a network', () => {
    setOnline(false)

    render(<OfflineBanner />)

    expect(screen.getByRole('status')).toHaveTextContent(/pot no estar actualitzat/)
  })
})

describe('a new version arriving while somebody works', () => {
  it('does nothing at all when none is waiting', async () => {
    expect(await applyPendingUpdate()).toBe(false)
  })

  it('applies the waiting version at the next start, not mid-session', async () => {
    const waiting = { postMessage: vi.fn() }
    const listeners: Record<string, () => void> = {}

    vi.stubGlobal('navigator', {
      ...window.navigator,
      serviceWorker: {
        getRegistration: async () => ({ waiting }),
        addEventListener: (event: string, handler: () => void) => {
          listeners[event] = handler
        },
        controller: { postMessage: vi.fn() },
      },
    })

    localStorage.setItem('uacademic:update-pending', new Date().toISOString())
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      configurable: true,
    })

    const applying = applyPendingUpdate()
    // The handover only happens because the app just started: the worker is
    // told to take over, and the page reloads into it.
    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }))
    listeners.controllerchange?.()

    expect(await applying).toBe(true)
    expect(reload).toHaveBeenCalled()
    // The flag is spent: the next start does not try again.
    expect(localStorage.getItem('uacademic:update-pending')).toBeNull()
  })

  it('asks the worker to drop what it cached when the identity changes', () => {
    const postMessage = vi.fn()
    vi.stubGlobal('navigator', {
      ...window.navigator,
      serviceWorker: { controller: { postMessage } },
    })

    clearApiCache()

    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_API_CACHE' })
  })
})
