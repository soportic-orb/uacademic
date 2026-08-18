import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { AssistantPanel } from '../src/features/assistant/assistant-panel'
import { ProposalCard } from '../src/features/assistant/proposal-card'
import type { AiProposal } from '../src/features/assistant/queries'
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

const PROPOSAL: AiProposal = {
  tool: 'move_session',
  summary: 'MAT1 A passaria a dijous a les 10:00',
  changes: [
    {
      entity: 'class_session',
      entityId: 'session-1',
      label: 'MAT1 A',
      before: { weekday: 2, startTime: '10:00' },
      after: { weekday: 4, startTime: '10:00' },
    },
  ],
  violations: [],
  warnings: [],
}

/** Routes a stubbed `fetch` by path. */
function router(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => routes[match] } as Response
  })
}

const AVAILABLE = {
  available: true,
  configured: true,
  enabled: true,
  model: 'claude-opus-5',
  budget: { usedTokens: 10, budgetTokens: 1000, percent: 1, level: 'ok' },
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
})

afterEach(() => vi.unstubAllGlobals())

describe('a proposal', () => {
  it('shows what would change, side by side, and that nothing has happened yet', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<ProposalCard proposalId="p1" proposal={PROPOSAL} status="pending" />))

    expect(screen.getByText('MAT1 A passaria a dijous a les 10:00')).toBeInTheDocument()

    // The two columns of the diff: what is there now, and what is proposed.
    const region = screen.getByRole('region', { name: 'Proposta' })
    expect(within(region).getByText('Ara')).toBeInTheDocument()
    expect(within(region).getAllByText('weekday:')).toHaveLength(2)
    expect(within(region).getByText('2')).toBeInTheDocument()
    expect(within(region).getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/Res s’aplica fins que ho confirmis/)).toBeInTheDocument()
  })

  it('applies nothing until the button is pressed, and then asks the API to', async () => {
    const fetchMock = router({ '/confirm': { status: 'confirmed', applied: 1 } })
    vi.stubGlobal('fetch', fetchMock)

    render(wrap(<ProposalCard proposalId="p1" proposal={PROPOSAL} status="pending" />))

    expect(fetchMock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirma i aplica' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
      expect(String(call[0])).toContain('/api/v1/ai/proposals/p1/confirm')
      expect(call[1].method).toBe('POST')
    })
  })

  it('refuses to offer confirmation while a hard constraint says no', () => {
    vi.stubGlobal('fetch', router({}))

    render(
      wrap(
        <ProposalCard
          proposalId="p1"
          status="pending"
          proposal={{
            ...PROPOSAL,
            violations: [
              { messageKey: 'planner.hard.teacherOverlap', params: { name: 'Marta Puig' } },
            ],
          }}
        />,
      ),
    )

    expect(screen.getByText('Conflictes')).toBeInTheDocument()
    // The reason is rendered from the engine's own message, in the reader's
    // language — not a generic "there is a conflict".
    expect(screen.getByText(/ja té una altra classe/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirma i aplica' })).toBeDisabled()
    expect(screen.getByText(/no es pot aplicar/)).toBeInTheDocument()
  })

  it('stops offering anything once it has been resolved', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<ProposalCard proposalId="p1" proposal={PROPOSAL} status="confirmed" />))

    expect(screen.queryByRole('button', { name: 'Confirma i aplica' })).not.toBeInTheDocument()
  })
})

describe('the assistant panel', () => {
  it('says so plainly when no key is configured, and offers no box to type in', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/api/v1/ai/status': { ...AVAILABLE, available: false, configured: false },
        '/api/v1/ai/conversations': { items: [] },
      }),
    )

    render(wrap(<AssistantPanel open onClose={() => {}} />))

    expect(await screen.findByText(/no està configurat/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pregunta' })).not.toBeInTheDocument()
  })

  it('warns when the center is close to its monthly budget', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/api/v1/ai/status': {
          ...AVAILABLE,
          budget: { usedTokens: 850, budgetTokens: 1000, percent: 85, level: 'warning' },
        },
        '/api/v1/ai/conversations': { items: [] },
      }),
    )

    render(wrap(<AssistantPanel open onClose={() => {}} />))

    expect(await screen.findByText(/85% del pressupost mensual/)).toBeInTheDocument()
  })

  it('carries the subject it was opened from', async () => {
    vi.stubGlobal(
      'fetch',
      router({ '/api/v1/ai/status': AVAILABLE, '/api/v1/ai/conversations': { items: [] } }),
    )

    render(wrap(<AssistantPanel open onClose={() => {}} subjectId="s1" subjectCode="FIS102" />))

    expect(await screen.findByText('Context: FIS102')).toBeInTheDocument()
  })

  it('streams the answer as it arrives and renders the proposal it produced', async () => {
    const frames = [
      'data: {"type":"text","text":"He mirat "}\n\n',
      'data: {"type":"tool","name":"list_conflicts","kind":"read"}\n\n',
      'data: {"type":"text","text":"l’horari."}\n\n',
      `data: {"type":"proposal","proposalId":"p1","proposal":${JSON.stringify(PROPOSAL)}}\n\n`,
      'data: {"type":"done","messageId":"m1","conversationId":"c1"}\n\n',
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)

        if (url.includes('/api/v1/ai/ask')) {
          const encoder = new TextEncoder()
          return {
            ok: true,
            status: 200,
            body: new ReadableStream({
              start(controller) {
                for (const frame of frames) controller.enqueue(encoder.encode(frame))
                controller.close()
              },
            }),
          } as unknown as Response
        }

        return {
          ok: true,
          status: 200,
          json: async () =>
            url.includes('/status')
              ? AVAILABLE
              : url.includes('/conversations/')
                ? { id: 'c1', title: null, subjectId: null, messages: [], proposals: [] }
                : { items: [] },
        } as Response
      }),
    )

    render(wrap(<AssistantPanel open onClose={() => {}} />))

    const box = await screen.findByRole('textbox')
    await userEvent.type(box, 'Per què no puc posar aquesta classe dimarts?')
    await userEvent.click(screen.getByRole('button', { name: 'Pregunta' }))

    // The text arrives in pieces and is shown as it does.
    expect(await screen.findByText(/He mirat l’horari\./)).toBeInTheDocument()

    // And the proposal it produced is rendered for review, not applied.
    const proposal = await screen.findByRole('region', { name: 'Proposta' })
    expect(within(proposal).getByRole('button', { name: 'Confirma i aplica' })).toBeInTheDocument()
  })
})
