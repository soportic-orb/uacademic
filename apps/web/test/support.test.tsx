/**
 * Cady on screen: the button that is in the same corner everywhere, and the
 * window it opens.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { SupportLauncher } from '../src/features/support/support-launcher'
import { SupportPanel } from '../src/features/support/support-panel'
import { useSessionStore } from '../src/stores/session'

function wrap(children: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {children}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const AVAILABLE = {
  available: true,
  configured: true,
  enabled: true,
  name: 'Cady',
  role: 'TEACHER',
}

/** Routes a stubbed `fetch` by path; anything else is a 404. */
function router(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => routes[match] } as Response
  })
}

/** A fetch whose `/support/ask` answers with a Server-Sent Event stream. */
function streaming(frames: Record<string, unknown>[], routes: Record<string, unknown> = {}) {
  const encoder = new TextEncoder()

  // `init` is declared even though the stream branch ignores it: the tests
  // read the request body out of `mock.calls`, and a one-argument mock has no
  // second element in its call tuple to read.
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init
    const url = String(input)

    if (url.includes('/support/ask')) {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            for (const frame of frames) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
            }
            controller.close()
          },
        }),
      } as unknown as Response
    }

    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => routes[match] } as Response
  })
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
})

afterEach(() => vi.unstubAllGlobals())

describe('the button in the corner', () => {
  it('is there for a lecturer, who has no other assistant', async () => {
    vi.stubGlobal('fetch', router({ '/support/status': AVAILABLE }))

    render(wrap(<SupportLauncher />))

    expect(
      await screen.findByRole('button', { name: "Obre l'ajuda de la Cady" }),
    ).toBeInTheDocument()
  })

  it('is not drawn at all while the assistant is switched off', async () => {
    vi.stubGlobal(
      'fetch',
      router({ '/support/status': { ...AVAILABLE, available: false, enabled: false } }),
    )

    render(wrap(<SupportLauncher />))

    // A button that opens onto "not available" is worse than no button.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Cady/ })).not.toBeInTheDocument(),
    )
  })

  it('opens the chat, and says so to a screen reader', async () => {
    vi.stubGlobal(
      'fetch',
      router({ '/support/status': AVAILABLE, '/support/conversations': { items: [] } }),
    )

    render(wrap(<SupportLauncher />))

    const button = await screen.findByRole('button', { name: "Obre l'ajuda de la Cady" })
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)

    expect(screen.getByRole('complementary', { name: /Cady/ })).toBeInTheDocument()
    // The same button, now expanded: one name in both states, with
    // `aria-expanded` saying which one it is in.
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('asking Cady something', () => {
  it('greets by saying what she can and cannot do', () => {
    vi.stubGlobal('fetch', router({ '/support/conversations': { items: [] } }))

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    expect(screen.getByText('Hola! Sóc la Cady 👋')).toBeInTheDocument()
    expect(screen.getByText(/No veig les dades del teu centre/)).toBeInTheDocument()
  })

  it('shows the answer as it arrives', async () => {
    vi.stubGlobal(
      'fetch',
      streaming(
        [
          { type: 'text', text: 'Ves a ' },
          { type: 'text', text: 'Menú → Planificació.' },
          { type: 'done', conversationId: 'c1', messageId: 'm1', covered: true },
        ],
        { '/support/conversations': { items: [] } },
      ),
    )

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    await userEvent.type(screen.getByRole('textbox'), 'On planifico?')
    await userEvent.click(screen.getByRole('button', { name: 'Envia' }))

    expect(await screen.findByText('Ves a Menú → Planificació.')).toBeInTheDocument()
  })

  it('says plainly when the help does not cover the question', async () => {
    vi.stubGlobal(
      'fetch',
      streaming(
        [
          { type: 'text', text: 'Això no ho tinc a la meva ajuda.' },
          { type: 'done', conversationId: 'c1', messageId: 'm1', covered: false },
        ],
        { '/support/conversations': { items: [] } },
      ),
    )

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    await userEvent.type(screen.getByRole('textbox'), 'Com facturo?')
    await userEvent.click(screen.getByRole('button', { name: 'Envia' }))

    expect(
      await screen.findByText(/Aquesta pregunta encara no és a la meva ajuda/),
    ).toBeInTheDocument()
  })

  it('takes the reader’s verdict on an answer', async () => {
    const fetchMock = streaming(
      [
        { type: 'text', text: 'Ves a Planificació.' },
        { type: 'done', conversationId: 'c1', messageId: 'm1', covered: true },
      ],
      { '/support/conversations': { items: [] }, '/feedback': { id: 'm1', helpful: false } },
    )
    vi.stubGlobal('fetch', fetchMock)

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    await userEvent.type(screen.getByRole('textbox'), 'On planifico?')
    await userEvent.click(screen.getByRole('button', { name: 'Envia' }))

    await userEvent.click(await screen.findByRole('button', { name: "No m'ha servit" }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/feedback'))
      expect(call).toBeDefined()
      expect(String(call![0])).toContain('/api/v1/support/messages/m1/feedback')
    })
  })

  it('sends the screen the person is standing on with the question', async () => {
    const fetchMock = streaming(
      [
        { type: 'text', text: 'Encara no hi tens cap classe assignada.' },
        { type: 'done', conversationId: 'c1', messageId: 'm1', covered: true },
      ],
      { '/support/conversations': { items: [] } },
    )
    vi.stubGlobal('fetch', fetchMock)

    render(wrap(<SupportPanel open onClose={vi.fn()} />, '/my-load'))

    await userEvent.type(screen.getByRole('textbox'), 'Per què surt buit?')
    await userEvent.click(screen.getByRole('button', { name: 'Envia' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/support/ask'))
      expect(call).toBeDefined()
      // Without it, "why is this empty" has no "this".
      expect(JSON.parse(String(call![1]?.body))).toMatchObject({ path: '/my-load' })
    })
  })

  it('renders her answer as formatted text, not as asterisks and pipes', async () => {
    vi.stubGlobal(
      'fetch',
      streaming(
        [
          {
            type: 'text',
            text: 'Ves a **Planificació**.\n\n1. Tria la versió\n2. Arrossega el grup\n\n| Rol | Pot |\n| --- | --- |\n| Docent | Consultar |',
          },
          { type: 'done', conversationId: 'c1', messageId: 'm1', covered: true },
        ],
        { '/support/conversations': { items: [] } },
      ),
    )

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    await userEvent.type(screen.getByRole('textbox'), 'On planifico?')
    await userEvent.click(screen.getByRole('button', { name: 'Envia' }))

    expect(await screen.findByText('Planificació')).toBeInTheDocument()
    expect(screen.getByText('Planificació').tagName).toBe('STRONG')
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Rol' })).toBeInTheDocument()
  })

  it('leaves what somebody typed exactly as they typed it', async () => {
    vi.stubGlobal(
      'fetch',
      streaming([{ type: 'done', conversationId: 'c1', messageId: 'm1', covered: true }], {
        '/support/conversations': { items: [] },
      }),
    )

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    // Their own asterisks are not formatting, they are their words.
    await userEvent.type(screen.getByRole('textbox'), 'Què vol dir **TFG**?')
    await userEvent.click(screen.getByRole('button', { name: 'Envia' }))

    expect(await screen.findByText('Què vol dir **TFG**?')).toBeInTheDocument()
  })

  it('opens out and back for an answer that needs the room', async () => {
    vi.stubGlobal('fetch', router({ '/support/conversations': { items: [] } }))

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    const bigger = screen.getByRole('button', { name: 'Amplia el xat' })
    expect(bigger).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(bigger)

    const smaller = screen.getByRole('button', { name: 'Redueix el xat' })
    expect(smaller).toHaveAttribute('aria-pressed', 'true')
  })

  it('refuses to send an empty question', () => {
    vi.stubGlobal('fetch', router({ '/support/conversations': { items: [] } }))

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    expect(screen.getByRole('button', { name: 'Envia' })).toBeDisabled()
  })

  it('lists the earlier conversations, so nobody asks twice', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/support/conversations': {
          items: [
            {
              id: 'c1',
              title: 'Com canvio la contrasenya?',
              lastMessageAt: '2026-08-01T10:00:00Z',
            },
          ],
        },
      }),
    )

    render(wrap(<SupportPanel open onClose={vi.fn()} />))

    await userEvent.click(screen.getByRole('button', { name: 'Converses' }))

    expect(
      await screen.findByRole('button', { name: 'Com canvio la contrasenya?' }),
    ).toBeInTheDocument()
  })
})
