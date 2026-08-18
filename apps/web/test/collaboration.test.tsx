import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { ChangeDetail } from '../src/features/changes/change-detail'
import { CandidateList } from '../src/features/absences/candidate-list'
import { NotificationBell } from '../src/features/notifications/notification-bell'
import { PushCard } from '../src/features/notifications/push-card'
import { ThreadView } from '../src/features/messaging/thread-view'
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

/** Routes a stubbed `fetch` by path, so one test can answer several calls. */
function router(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => routes[match] } as Response
  })
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
})

afterEach(() => vi.unstubAllGlobals())

describe('the notification bell', () => {
  it('shows the unread count and opens the panel', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/api/v1/notifications': {
          unread: 2,
          items: [
            {
              id: 'n1',
              type: 'change.requested',
              payload: { title: 'Nova sol·licitud', body: 'Tens una petició', url: '/changes/c1' },
              readAt: null,
              createdAt: '2026-09-01T08:00:00.000Z',
            },
          ],
        },
      }),
    )

    render(wrap(<NotificationBell />))

    const bell = await screen.findByRole('button', { name: /2 sense llegir/ })
    await userEvent.click(bell)

    const panel = await screen.findByRole('dialog', { name: 'Notificacions' })
    expect(within(panel).getByText('Nova sol·licitud')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Ves-hi' })).toHaveAttribute(
      'href',
      '/changes/c1',
    )
  })

  it('says nothing is pending when the list is empty', async () => {
    vi.stubGlobal('fetch', router({ '/api/v1/notifications': { unread: 0, items: [] } }))

    render(wrap(<NotificationBell />))
    await userEvent.click(await screen.findByRole('button', { name: 'Notificacions' }))

    expect(await screen.findByText('No tens notificacions.')).toBeInTheDocument()
  })
})

describe('push enablement', () => {
  it('explains the home-screen step on iOS instead of offering a button', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari',
    })

    render(wrap(<PushCard available publicKey="key" />))

    expect(screen.getByText(/Afegeix a la pantalla d/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activa els avisos' })).not.toBeInTheDocument()
  })

  it('says so when the server has no VAPID key configured', () => {
    render(wrap(<PushCard available={false} publicKey={null} />))

    expect(screen.getByText('El servidor encara no té configurat el push.')).toBeInTheDocument()
  })
})

describe('a change request', () => {
  const CHANGE = {
    id: 'c1',
    type: 'session_move',
    status: 'requested',
    reason: 'Congrés',
    createdAt: '2026-09-01T08:00:00.000Z',
    expiresAt: '2026-09-04T08:00:00.000Z',
    appliedAt: null,
    requesterId: 'u1',
    requesterName: 'Marta Puig',
    targetUserId: null,
    targetName: null,
    proposal: { weekday: 3, startTime: '10:00' },
    session: {
      id: 's1',
      weekday: 1,
      startTime: '08:00',
      endTime: '10:00',
      label: 'MAT1 A',
      subjectName: 'Matemàtiques',
    },
    actions: ['accept', 'reject'],
    violations: [],
  }

  it('renders the ladder steps the API allows, and nothing else', async () => {
    vi.stubGlobal('fetch', router({ '/api/v1/changes/c1': CHANGE }))

    render(wrap(<ChangeDetail id="c1" />))

    expect(await screen.findByText('Moviment de sessió')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accepta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebutja' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprova' })).not.toBeInTheDocument()
    expect(screen.getByText('Cap conflicte amb l’horari publicat')).toBeInTheDocument()
  })

  it('shows the conflicts the engine found, in the reader’s language', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/api/v1/changes/c1': {
          ...CHANGE,
          violations: [
            {
              constraint: 'teacherOverlap',
              sessionId: 's1',
              messageKey: 'planner.hard.teacherOverlap',
              params: { teacher: 'Marta Puig' },
            },
          ],
        },
      }),
    )

    render(wrap(<ChangeDetail id="c1" />))

    expect(await screen.findByText('Conflictes detectats')).toBeInTheDocument()
    expect(screen.getByText(/Marta Puig/)).toBeInTheDocument()
  })
})

describe('substitute candidates', () => {
  const CANDIDATES = {
    sessionId: 's1',
    items: [
      {
        teacherProfileId: 'p1',
        name: 'Joan Ferrer',
        eligible: true,
        score: 82,
        blockers: [],
        reasons: [{ messageKey: 'substitutes.reasons.teachesSubject', params: {} }],
      },
      {
        teacherProfileId: 'p2',
        name: 'Anna Roca',
        eligible: false,
        score: 0,
        blockers: ['busy'],
        reasons: [],
      },
    ],
  }

  it('separates who can cover from who cannot, and says why not', async () => {
    vi.stubGlobal('fetch', router({ '/candidates': CANDIDATES }))

    render(wrap(<CandidateList absenceId="a1" sessionId="s1" canManage />))

    expect(await screen.findByText('Joan Ferrer')).toBeInTheDocument()
    expect(screen.getByText('Imparteix aquesta assignatura')).toBeInTheDocument()
    expect(screen.getByText('Ja té classe en aquesta franja')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Demana-li que la cobreixi' })).toBeInTheDocument()
  })

  it('does not offer to ask anybody when the reader does not coordinate', async () => {
    vi.stubGlobal('fetch', router({ '/candidates': CANDIDATES }))

    render(wrap(<CandidateList absenceId="a1" sessionId="s1" canManage={false} />))

    await screen.findByText('Joan Ferrer')
    expect(
      screen.queryByRole('button', { name: 'Demana-li que la cobreixi' }),
    ).not.toBeInTheDocument()
  })
})

describe('a conversation', () => {
  const THREAD = {
    id: 'conv-1',
    type: 'subject' as const,
    title: 'MAT1 · Matemàtiques',
    canPost: true,
    canManageMembers: false,
    members: [
      { id: 'u1', name: 'Marta Puig', lastReadAt: '2026-09-01T09:00:00.000Z' },
      { id: 'u2', name: 'Joan Ferrer', lastReadAt: '2026-09-01T09:00:00.000Z' },
    ],
    items: [
      {
        id: 'm1',
        body: 'Bon dia a tothom',
        senderId: 'u1',
        senderName: 'Marta Puig',
        createdAt: '2026-09-01T08:00:00.000Z',
        attachments: [],
        readByAll: true,
      },
    ],
  }

  it('shows the read indicator and a composer', async () => {
    vi.stubGlobal('fetch', router({ '/messages': THREAD, '/read': {} }))

    render(wrap(<ThreadView conversationId="conv-1" />))

    expect(await screen.findByText('Bon dia a tothom')).toBeInTheDocument()
    expect(screen.getByText('Llegit per tothom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Envia' })).toBeInTheDocument()
  })

  it('replaces the composer with the reason when the channel is read-only', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/messages': { ...THREAD, type: 'announcement', canPost: false },
        '/read': {},
      }),
    )

    render(wrap(<ThreadView conversationId="conv-1" />))

    await waitFor(() =>
      expect(screen.getByText(/Aquest canal és només d’anuncis/)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'Envia' })).not.toBeInTheDocument()
  })
})
