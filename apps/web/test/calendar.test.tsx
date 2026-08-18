import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CalendarView } from '../src/features/calendar/calendar-view'
import { FeedCard } from '../src/features/connections/feed-card'
import { useSessionStore } from '../src/stores/session'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

const SESSIONS = {
  from: '2026-09-01',
  to: '2026-12-31',
  subjects: [
    { id: 'sub1', code: 'MAT101', name: 'Matemàtiques I' },
    { id: 'sub2', code: 'FIS101', name: 'Física' },
  ],
  events: [
    {
      sessionId: 'session-1',
      date: '2026-09-14',
      startTime: '09:00',
      endTime: '11:00',
      subjectId: 'sub1',
      subjectCode: 'MAT101',
      subjectName: 'Matemàtiques I',
      groupCode: 'T1',
      spaceName: 'Aula 1.1',
    },
  ],
}

const LATENCY = {
  apple: { minMinutes: 5, maxMinutes: 60, clientControlled: true },
  outlook: { minMinutes: 60, maxMinutes: 240, clientControlled: true },
  google: { minMinutes: 480, maxMinutes: 1440, clientControlled: true },
}

describe('the teacher calendar', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    useSessionStore.getState().setCenterId('center-1')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation((input: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          String(input).includes('/calendar/feed')
            ? { active: false, id: null, createdAt: null, lastFetchedAt: null }
            : SESSIONS,
      } as Response),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('offers the four views the product asks for', async () => {
    render(wrap(<CalendarView />))

    for (const label of ['Dia', 'Setmana', 'Mes', 'Agenda']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Setmana' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  it('asks the server for the filtered subject rather than trimming in the browser', async () => {
    const user = userEvent.setup()
    render(wrap(<CalendarView />))

    // Wait for the subjects the server offers before choosing one.
    await screen.findByRole('option', { name: /MAT101/ })
    await user.selectOptions(screen.getByLabelText('Assignatura'), 'sub1')

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes('subjectId=sub1'))).toBe(true)
    })
  })

  it('downloads the range as PDF and as Excel', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn(() => 'blob:calendar')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    fetchMock.mockImplementation((input: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          String(input).includes('/calendar/feed') ? { active: false, id: null } : SESSIONS,
        blob: async () => new Blob(['x']),
      } as Response),
    )

    render(wrap(<CalendarView />))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /Exporta a PDF/ }))
    await user.click(screen.getByRole('button', { name: /Exporta a Excel/ }))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes('/calendar/export.pdf?'))).toBe(true)
      expect(urls.some((url) => url.includes('/calendar/export.xlsx?'))).toBe(true)
    })
    expect(createObjectURL).toHaveBeenCalledTimes(2)
  })
})

describe('the subscription address', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows the address once it is generated, with its warning', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation((_input: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          init?.method === 'POST'
            ? { id: 'feed-1', url: 'https://api.test/api/v1/calendar/feed/abc.ics', token: 'abc' }
            : { active: false, id: null },
      } as Response),
    )

    render(
      wrap(
        <FeedCard
          feed={{
            active: false,
            id: null,
            createdAt: null,
            lastFetchedAt: null,
            filters: {},
            latency: LATENCY,
          }}
        />,
      ),
    )
    expect(screen.getByText(/Qui tingui aquesta adreça/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Genera l'adreça/ }))

    expect(
      await screen.findByDisplayValue('https://api.test/api/v1/calendar/feed/abc.ics'),
    ).toBeInTheDocument()
  })

  it('revokes the live address after confirming', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ active: true, id: 'feed-1', createdAt: null, lastFetchedAt: null }),
      } as Response),
    )

    render(
      wrap(
        <FeedCard
          feed={{
            active: true,
            id: 'feed-1',
            createdAt: null,
            lastFetchedAt: null,
            filters: {},
            latency: LATENCY,
          }}
        />,
      ),
    )
    await user.click(await screen.findByRole('button', { name: 'Revoca' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (entry) => (entry[1] as RequestInit)?.method === 'DELETE',
      )
      expect(String(call?.[0])).toContain('/api/v1/calendar/feed/feed-1')
    })
  })
})
