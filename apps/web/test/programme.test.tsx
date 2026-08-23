/**
 * The teaching programme on screen: the four filters, none of them on to begin
 * with, and printing what is actually being looked at.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { ProgrammeView } from '../src/features/calendar/programme-view'
import { useSessionStore } from '../src/stores/session'

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

const FILTERS = {
  subjects: [
    { id: 'sub-1', label: 'MAT101 · Matemàtiques I' },
    { id: 'sub-2', label: 'FIS201 · Física' },
  ],
  teachers: [{ id: 'p1', label: 'Marta Puig Serra' }],
  groups: [{ id: 'g1', label: 'MAT101 T1' }],
  spaces: [{ id: 's1', label: 'Aula 1.1' }],
}

const EVENT = {
  sessionId: 'session-1',
  date: '2026-09-14',
  startTime: '09:00',
  endTime: '10:00',
  subjectId: 'sub-1',
  subjectCode: 'MAT101',
  subjectName: 'Matemàtiques I',
  groupCode: 'T1',
  spaceName: 'Aula 1.1',
  teacherName: 'Marta Puig Serra',
  teachers: [{ teacherProfileId: 'p1', name: 'Marta Puig Serra' }],
  color: '#00335C',
  background: '#D0E7FA',
}

/** Every request the screen makes, so the query string can be asserted on. */
const requested: string[] = []

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
  requested.length = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)

      if (url.includes('/calendar/coordination.pdf')) {
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(['%PDF-']),
        } as unknown as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          from: '2026-09-01',
          to: '2026-12-31',
          filters: FILTERS,
          events: url.includes('subjectId=sub-2') ? [] : [EVENT],
        }),
      } as Response
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

/**
 * The filter row renders before its options arrive — it is not behind the
 * loading state, because a picker that appears late moves the whole screen
 * under the reader. So the tests wait for an option, not for a label.
 */
async function ready() {
  await screen.findByRole('option', { name: 'Marta Puig Serra' })
}

describe('the teaching programme', () => {
  it('arrives with no filter on, showing everything', async () => {
    view(<ProgrammeView />)

    await waitFor(() => expect(requested.length).toBeGreaterThan(0))

    const url = requested[0]!
    expect(url).not.toContain('subjectId=')
    expect(url).not.toContain('teacherProfileId=')
    expect(url).toContain('from=')
  })

  it('offers a filter for the subject, the teacher, the group and the room', async () => {
    view(<ProgrammeView />)

    expect(await screen.findByLabelText('Assignatura')).toBeInTheDocument()
    expect(screen.getByLabelText('Docent')).toBeInTheDocument()
    expect(screen.getByLabelText('Grup')).toBeInTheDocument()
    expect(screen.getByLabelText('Espai')).toBeInTheDocument()
  })

  it('asks the server again when a filter is chosen', async () => {
    view(<ProgrammeView />)

    await ready()
    await userEvent.selectOptions(screen.getByLabelText('Docent'), 'p1')

    await waitFor(() =>
      expect(requested.some((url) => url.includes('teacherProfileId=p1'))).toBe(true),
    )
  })

  it('offers to clear the filters only once one is on', async () => {
    view(<ProgrammeView />)

    await ready()
    expect(screen.queryByRole('button', { name: 'Treu els filtres' })).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Espai'), 's1')

    await userEvent.click(await screen.findByRole('button', { name: 'Treu els filtres' }))
    await waitFor(() => expect(requested.at(-1)).not.toContain('spaceId='))
  })

  it('names the colours, so colour is never the only carrier', async () => {
    view(<ProgrammeView />)

    const legend = await screen.findByText('Color per assignatura')
    const list = legend.parentElement!
    expect(within(list).getByText('MAT101 · Matemàtiques I')).toBeInTheDocument()
    expect(within(list).getByText('FIS201 · Física')).toBeInTheDocument()
  })

  it('says so plainly when the filters match nothing', async () => {
    view(<ProgrammeView />)

    await ready()
    await userEvent.selectOptions(screen.getByLabelText('Assignatura'), 'sub-2')

    expect(
      await screen.findByText('No hi ha cap classe publicada amb aquests filtres.'),
    ).toBeInTheDocument()
  })

  it('prints the view and the filters that are on', async () => {
    view(<ProgrammeView />)

    await ready()
    await userEvent.selectOptions(screen.getByLabelText('Docent'), 'p1')
    await userEvent.click(screen.getByRole('button', { name: 'Setmana' }))
    await userEvent.click(screen.getByRole('button', { name: 'Imprimeix aquesta vista' }))

    await waitFor(() => {
      const print = requested.find((url) => url.includes('/calendar/coordination.pdf'))
      expect(print).toBeDefined()
      // What is on screen, not the whole fetched range and not everybody.
      expect(print).toContain('view=week')
      expect(print).toContain('teacherProfileId=p1')
      expect(print).toMatch(/date=\d{4}-\d{2}-\d{2}/)
    })
  })
})
