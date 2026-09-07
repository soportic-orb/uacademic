/**
 * The platform panel, and what it says when an update does not work.
 *
 * An update that fails and reports only "it failed" leaves the one person who
 * can fix it with nothing: the reason lived in a log file on the server, and
 * whoever pressed the button never saw it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { PlatformPage } from '../src/pages/platform'
import { useSessionStore } from '../src/stores/session'
import { useToastStore } from '../src/stores/toast'

function view(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {children}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const REASON = 'pnpm exited with 1: Error: P3009 migrate found failed migrations'

/** What the panel is told, and what it does with it. */
const platform = {
  history: [] as Record<string, unknown>[],
}

const status = () => ({
  configured: true,
  currentVersion: '2026.09.01-53',
  runningVersion: '2026.09.01-53',
  releasePath: '/home/uacademic/releases/2026.09.01-53',
  checkedAt: new Date().toISOString(),
  available: {
    version: '2026.09.07-54',
    changelog: 'Novetats',
    publishedAt: new Date().toISOString(),
  },
  updateAvailable: true,
  history: platform.history,
})

describe('the platform panel', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    useSessionStore.setState({ centerId: 'center-1' })
    // Toasts outlive the component that raised them, so one test's message
    // would otherwise still be on screen during the next.
    useToastStore.setState({ toasts: [] })
    platform.history = []

    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/platform/update') && init?.method === 'POST') {
        // The update is queued, and the panel then watches the history for
        // what became of it.
        platform.history = [
          {
            version: '2026.09.07-54',
            status: 'failed',
            appliedAt: null,
            changelog: null,
            detail: REASON,
          },
        ]
        return {
          ok: true,
          status: 200,
          json: async () => ({ queued: true, version: '2026.09.07-54' }),
        } as Response
      }

      if (url.includes('/platform/version')) {
        return { ok: true, status: 200, json: async () => status() } as Response
      }

      if (url.includes('/platform/mail')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            configured: false,
            host: null,
            port: 587,
            secure: false,
            user: null,
            from: 'no-reply@uacademic.cat',
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ available: ['ca', 'es', 'en'], enabled: ['ca'] }),
      } as Response
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('says what went wrong when an update fails, in the words of what refused it', async () => {
    const user = userEvent.setup()
    view(<PlatformPage />)

    await user.click(await screen.findByRole('button', { name: /Actualitza ara/ }))

    const toast = await screen.findByRole('status', {}, { timeout: 10_000 })
    expect(toast).toHaveTextContent('P3009')
  })

  it('keeps the reason on the screen after the message has gone', async () => {
    platform.history = [
      {
        version: '2026.09.07-54',
        status: 'failed',
        appliedAt: null,
        changelog: null,
        detail: REASON,
      },
    ]

    view(<PlatformPage />)

    // Whoever comes to fix it is rarely the person who watched it fail.
    await waitFor(() => expect(screen.getByText(/P3009/)).toBeInTheDocument())
  })

  it('says nothing extra about the versions that installed cleanly', async () => {
    platform.history = [
      {
        version: '2026.09.01-53',
        status: 'applied',
        appliedAt: new Date().toISOString(),
        changelog: null,
        detail: null,
      },
    ]

    view(<PlatformPage />)

    // The version appears both as "installed" and in the history; either will
    // do to know the panel has drawn.
    await waitFor(() => expect(screen.getAllByText('2026.09.01-53').length).toBeGreaterThan(0))
    expect(screen.queryByText(/P3009/)).not.toBeInTheDocument()
  })
})
