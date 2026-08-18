import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { ExtractionRow } from '../src/features/settings/extraction-row'
import type { ExtractionRow as Row } from '../src/features/settings/queries'
import { WhyThisRule } from '../src/features/settings/why-this-rule'
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

function router(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => routes[match] } as Response
  })
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'row-1',
    paramKey: 'capacity.maxTeachingHoursYear',
    block: 'A',
    proposedValue: 240,
    currentValue: 200,
    unit: 'hours/year',
    confidence: 'high',
    citation: {
      documentId: 'doc-1',
      page: 7,
      section: 'Art. 14.2',
      quote: 'no excedirà de 240 hores lectives anuals',
    },
    reasoning: 'Límit general',
    exceptionNote: null,
    manualOverride: false,
    status: 'pending',
    resolvedValue: null,
    ...overrides,
  }
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
})

afterEach(() => vi.unstubAllGlobals())

describe('a parameter waiting to be confirmed', () => {
  it('is named in plain language, never as its technical key', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<ExtractionRow row={row()} conflicted={false} onResolve={() => {}} />))

    expect(screen.getByText('Hores lectives màximes a l’any')).toBeInTheDocument()
    expect(screen.queryByText('capacity.maxTeachingHoursYear')).not.toBeInTheDocument()
  })

  it('says what the confidence actually means, not a number the model made up', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<ExtractionRow row={row()} conflicted={false} onResolve={() => {}} />))

    expect(screen.getByText('Cita literal i única')).toBeInTheDocument()
  })

  it('folds the citation open, with the article and a way into the document', async () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<ExtractionRow row={row()} conflicted={false} onResolve={() => {}} />))

    await userEvent.click(screen.getByRole('button', { name: 'Mostra la cita' }))

    expect(screen.getByText(/no excedirà de 240 hores/)).toBeInTheDocument()
    expect(screen.getByText(/Art\. 14\.2/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Obre el document/ })).toHaveAttribute(
      'href',
      '/documents?doc=doc-1&page=7',
    )
  })

  it('shows the exception the article carries instead of dropping it', () => {
    vi.stubGlobal('fetch', router({}))

    render(
      wrap(
        <ExtractionRow
          row={row({ exceptionNote: 'salvo en el caso de los cargos académicos' })}
          conflicted={false}
          onResolve={() => {}}
        />,
      ),
    )

    expect(screen.getByText(/cargos académicos/)).toBeInTheDocument()
  })

  it('says out loud when two articles disagree', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<ExtractionRow row={row()} conflicted onResolve={() => {}} />))

    expect(screen.getByText(/Dos articles diuen coses diferents/)).toBeInTheDocument()
  })

  it('warns that a hand-edited parameter is only being proposed a change', () => {
    vi.stubGlobal('fetch', router({}))

    render(
      wrap(
        <ExtractionRow
          row={row({ manualOverride: true })}
          conflicted={false}
          onResolve={() => {}}
        />,
      ),
    )

    expect(screen.getByText(/es va editar a mà/)).toBeInTheDocument()
  })

  it('offers no value to accept when the document never answered', () => {
    vi.stubGlobal('fetch', router({}))

    render(
      wrap(
        <ExtractionRow
          row={row({
            status: 'not_found',
            proposedValue: null,
            citation: null,
            reasoning: 'settings.extraction.notFound.noCitation',
          })}
          conflicted={false}
          onResolve={() => {}}
        />,
      ),
    )

    expect(screen.getByText(/sense cita no hi ha proposta/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accepta' })).not.toBeInTheDocument()
  })

  it('sends the edited figure, not the proposed one', async () => {
    vi.stubGlobal('fetch', router({}))
    const onResolve = vi.fn()

    render(wrap(<ExtractionRow row={row()} conflicted={false} onResolve={onResolve} />))

    await userEvent.click(screen.getByRole('button', { name: 'Edita' }))
    const field = screen.getByLabelText('Valor proposat')
    await userEvent.clear(field)
    await userEvent.type(field, '210')
    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

    expect(onResolve).toHaveBeenCalledWith({ id: 'row-1', status: 'edited', value: 210 })
  })
})

describe('why a rule applies', () => {
  it('walks from a blocked assignment to the article that imposes it', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/api/v1/settings/provenance/': {
          paramKey: 'capacity.maxTeachingHoursYear',
          value: 240,
          documentId: 'doc-1',
          documentTitle: 'Criteris POD 2026-27',
          page: 7,
          section: 'Art. 14.2',
          quote: 'no excedirà de 240 hores lectives anuals',
          chunkId: 'chunk-9',
        },
      }),
    )

    render(wrap(<WhyThisRule messageKey="planner.hard.teacherCapacity" />))

    await userEvent.click(screen.getByRole('button', { name: /Per què s’aplica/ }))

    expect(await screen.findByText(/no excedirà de 240 hores/)).toBeInTheDocument()
    expect(screen.getByText(/Criteris POD 2026-27/)).toBeInTheDocument()
    // Straight into the document, at the paragraph itself.
    expect(screen.getByRole('link', { name: /Obre la normativa/ })).toHaveAttribute(
      'href',
      '/documents?doc=doc-1&page=7&chunk=chunk-9',
    )
  })

  it('admits when a parameter comes from no regulation at all', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/api/v1/settings/provenance/': {
          paramKey: 'schedule.maxConsecutiveHours',
          value: 4,
          documentId: null,
          documentTitle: null,
          page: null,
          section: null,
          quote: null,
          chunkId: null,
        },
      }),
    )

    render(wrap(<WhyThisRule messageKey="planner.soft.consecutiveHours" />))
    await userEvent.click(screen.getByRole('button', { name: /Per què s’aplica/ }))

    await waitFor(() => expect(screen.getByText(/no ve de cap normativa/)).toBeInTheDocument())
  })

  it('offers nothing for a rule no parameter governs', () => {
    vi.stubGlobal('fetch', router({}))

    const { container } = render(wrap(<WhyThisRule messageKey="planner.hard.teacherOverlap" />))

    expect(within(container).queryByRole('button')).not.toBeInTheDocument()
  })
})
