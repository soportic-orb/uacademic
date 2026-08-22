/**
 * Arranging your own menu, and the sidebar following it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { Sidebar } from '../src/components/layout/sidebar'
import { MenuCard } from '../src/features/settings/menu-card'
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

/** The stored layout, and every PUT the screen sends. */
const stored = { entries: [] as unknown[] }
const saved: unknown[][] = []

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
  stored.entries = []
  saved.length = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/api/v1/me/menu')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response
      }

      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { entries: unknown[] }
        saved.push(body.entries)
        stored.entries = body.entries
        return { ok: true, status: 200, json: async () => body } as Response
      }

      return { ok: true, status: 200, json: async () => ({ entries: stored.entries }) } as Response
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

const TEACHER = ['TEACHER'] as const

describe('arranging your own menu', () => {
  it('lists the entries this person actually reaches, in the product’s order', async () => {
    view(<MenuCard roles={TEACHER} />)

    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText('Tauler')).toBeInTheDocument()
    // A lecturer has no platform administration to arrange.
    expect(screen.queryByText('Plataforma')).not.toBeInTheDocument()
  })

  it('moves an entry down and saves it without asking', async () => {
    view(<MenuCard roles={TEACHER} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Baixa Tauler' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    // The dashboard was first; now it is second, and nothing else moved.
    expect(saved[0]![1]).toEqual({ kind: 'item', key: 'dashboard' })
  })

  it('will not move the first entry up, or the last one down', async () => {
    view(<MenuCard roles={TEACHER} />)

    expect(await screen.findByRole('button', { name: 'Puja Tauler' })).toBeDisabled()
    expect(saved).toHaveLength(0)
  })

  it('adds a separator with the label that was typed', async () => {
    view(<MenuCard roles={TEACHER} />)

    await userEvent.type(await screen.findByLabelText('Etiqueta del separador'), 'Docència')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix un separador' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]![1]).toMatchObject({ kind: 'separator', label: 'Docència' })
  })

  it('takes a separator away again', async () => {
    stored.entries = [
      { kind: 'item', key: 'dashboard' },
      { kind: 'separator', id: 'sep-1', label: 'Docència' },
      { kind: 'item', key: 'myLoad' },
    ]

    view(<MenuCard roles={TEACHER} />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Elimina el separador Docència' }),
    )

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.some((entry) => (entry as { kind: string }).kind === 'separator')).toBe(false)
  })

  it('offers to put it all back only once something has been changed', async () => {
    const { unmount } = view(<MenuCard roles={TEACHER} />)

    await screen.findByText('El teu menú')
    expect(
      screen.queryByRole('button', { name: "Restaura l'ordre original" }),
    ).not.toBeInTheDocument()
    unmount()

    stored.entries = [{ kind: 'item', key: 'messages' }]
    view(<MenuCard roles={TEACHER} />)

    expect(
      await screen.findByRole('button', { name: "Restaura l'ordre original" }),
    ).toBeInTheDocument()
  })
})

describe('the sidebar', () => {
  it('draws the menu in the order this person put it in', async () => {
    stored.entries = [{ kind: 'item', key: 'messages' }]

    view(<Sidebar roles={TEACHER} collapsed={false} onToggle={vi.fn()} />)

    await waitFor(() => {
      const links = screen.getAllByRole('link')
      expect(links[0]).toHaveTextContent('Missatges')
    })
  })

  it('still draws an entry the layout never mentions', async () => {
    // An update that adds a screen must not hide it from everybody who has
    // ever arranged their menu.
    stored.entries = [{ kind: 'item', key: 'messages' }]

    view(<Sidebar roles={TEACHER} collapsed={false} onToggle={vi.fn()} />)

    expect(await screen.findByRole('link', { name: 'Tauler' })).toBeInTheDocument()
  })

  it('shows a separator’s label above the rule', async () => {
    stored.entries = [
      { kind: 'item', key: 'dashboard' },
      { kind: 'separator', id: 'sep-1', label: 'Docència' },
      { kind: 'item', key: 'myLoad' },
    ]

    view(<Sidebar roles={TEACHER} collapsed={false} onToggle={vi.fn()} />)

    expect(await screen.findByText('Docència')).toBeInTheDocument()
  })
})
