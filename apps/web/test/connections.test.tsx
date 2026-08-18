import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { ProviderCard } from '../src/features/connections/provider-card'
import { FeedCard } from '../src/features/connections/feed-card'
import type { ProviderStatus } from '../src/features/connections/queries'
import { useSessionStore } from '../src/stores/session'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {children}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const API_LATENCY = { minMinutes: 0, maxMinutes: 5, clientControlled: false }

function provider(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider: 'microsoft',
    configured: true,
    connected: false,
    status: null,
    calendarName: null,
    lastSyncAt: null,
    lastBusySyncAt: null,
    lastError: null,
    busySyncEnabled: false,
    consentVersion: null,
    latency: API_LATENCY,
    ...overrides,
  }
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
})

afterEach(() => vi.unstubAllGlobals())

describe('a calendar provider', () => {
  it('says up front that it writes into a calendar of its own', () => {
    render(wrap(<ProviderCard status={provider()} />))

    expect(screen.getByText(/Calendari dedicat/)).toBeInTheDocument()
    expect(screen.getByText(/Mai escrivim al teu calendari personal/)).toBeInTheDocument()
    // And that a class deleted on a phone comes back.
    expect(screen.getByText(/la restaurem a la següent sincronització/)).toBeInTheDocument()
  })

  it('offers no button at all when the installation has no credentials', () => {
    render(wrap(<ProviderCard status={provider({ configured: false })} />))

    expect(screen.getByText(/no està configurat/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connecta' })).not.toBeInTheDocument()
  })

  it('sends the browser to the provider’s own consent page', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://provider.test/authorize?state=abc' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    // jsdom refuses a navigation; the assertion is that we asked for one.
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        set href(value: string) {
          assign(value)
        },
      },
    })

    render(wrap(<ProviderCard status={provider()} />))
    await userEvent.click(screen.getByRole('button', { name: 'Connecta' }))

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://provider.test/authorize?state=abc'),
    )
  })

  it('asks separately before reading busy time, and says what it reads', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ busySyncEnabled: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(wrap(<ProviderCard status={provider({ connected: true, status: 'active' })} />))

    expect(
      screen.getByText(/Llegim només l’inici i el final dels teus esdeveniments/),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox'))

    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
      expect(call[1].method).toBe('PATCH')
      expect(JSON.parse(String(call[1].body))).toEqual({ busySyncEnabled: true })
    })
  })

  it('offers to take the remote calendar with it when disconnecting', () => {
    render(wrap(<ProviderCard status={provider({ connected: true, status: 'active' })} />))

    expect(screen.getByRole('button', { name: /esborra el calendari remot/ })).toBeInTheDocument()
  })

  it('asks the person to reconnect once the consent is gone', () => {
    render(wrap(<ProviderCard status={provider({ connected: true, status: 'revoked' })} />))

    expect(screen.getByText('Cal tornar a connectar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Torna a connectar' })).toBeInTheDocument()
  })
})

describe('the subscription card', () => {
  const feed = {
    active: true,
    id: 'feed-1',
    createdAt: null,
    lastFetchedAt: null,
    filters: {},
    latency: {
      apple: { minMinutes: 5, maxMinutes: 60, clientControlled: true },
      outlook: { minMinutes: 60, maxMinutes: 240, clientControlled: true },
      google: { minMinutes: 480, maxMinutes: 1440, clientControlled: true },
    },
  }

  it('warns about Google instead of letting somebody find out the hard way', () => {
    render(wrap(<FeedCard feed={feed} />))

    expect(screen.getByText(/cada 8-24 hores/)).toBeInTheDocument()
    // And each client's real refresh window is on screen next to it.
    expect(screen.getByText(/Entre 8 h i 24 h/)).toBeInTheDocument()
  })

  it('gives step-by-step instructions for the four clients people use', () => {
    render(wrap(<FeedCard feed={feed} />))

    const list = screen.getByRole('list')
    expect(within(list).getByText(/Nova subscripció de calendari/)).toBeInTheDocument()
    expect(within(list).getByText(/Altres calendaris/)).toBeInTheDocument()
    expect(within(list).getByText(/Subscriu-te des del web/)).toBeInTheDocument()
    expect(within(list).getByText(/iCalendar \(ICS\)/)).toBeInTheDocument()
  })
})
