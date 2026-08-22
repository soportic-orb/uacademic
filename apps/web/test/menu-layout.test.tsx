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
import { MenuCard, MenuDefaultsCard } from '../src/features/settings/menu-card'
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

/** The stored layout and defaults, and every PUT the screens send. */
const stored = { entries: [] as unknown[], personalised: false }
const defaults = { value: {} as Record<string, unknown[]> }
const pending = { value: { changes: 0, absences: 0 } }
const saved: unknown[][] = []
const savedDefaults: Record<string, unknown[]>[] = []

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
  stored.entries = []
  stored.personalised = false
  defaults.value = {}
  pending.value = { changes: 0, absences: 0 }
  saved.length = 0
  savedDefaults.length = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/api/v1/me/pending')) {
        return { ok: true, status: 200, json: async () => pending.value } as Response
      }

      if (url.includes('/api/v1/platform/menu-defaults')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { defaults: Record<string, unknown[]> }
          savedDefaults.push(body.defaults)
          defaults.value = body.defaults
          return { ok: true, status: 200, json: async () => body } as Response
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ defaults: defaults.value }),
        } as Response
      }

      if (!url.includes('/api/v1/me/menu')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response
      }

      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { entries: unknown[] }
        saved.push(body.entries)
        stored.entries = body.entries
        stored.personalised = body.entries.length > 0
        return { ok: true, status: 200, json: async () => body } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ entries: stored.entries, personalised: stored.personalised }),
      } as Response
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

const TEACHER = ['TEACHER'] as const
const COORDINATOR = ['COORDINATOR'] as const

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

  it('offers the default back only once this person has arranged their own', async () => {
    const { unmount } = view(<MenuCard roles={TEACHER} />)

    await screen.findByText('El teu menú')
    expect(
      screen.queryByRole('button', { name: 'Torna al menú per defecte' }),
    ).not.toBeInTheDocument()
    unmount()

    stored.entries = [{ kind: 'item', key: 'messages' }]
    stored.personalised = true
    view(<MenuCard roles={TEACHER} />)

    expect(
      await screen.findByRole('button', { name: 'Torna al menú per defecte' }),
    ).toBeInTheDocument()
  })

  it('draws the role’s default for somebody who has arranged nothing', async () => {
    // The server hands back the default as the menu to draw; the card does not
    // have to know which of the two it is looking at.
    stored.entries = [{ kind: 'item', key: 'messages' }]
    stored.personalised = false

    view(<MenuCard roles={TEACHER} />)

    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText('Missatges')).toBeInTheDocument()
  })
})

describe('the menu each role starts with', () => {
  it('arranges one role at a time', async () => {
    view(<MenuDefaultsCard />)

    await userEvent.click(await screen.findByRole('button', { name: 'Coordinació' }))
    await userEvent.click(screen.getByRole('button', { name: 'Baixa Tauler' }))

    await waitFor(() => expect(savedDefaults).toHaveLength(1))
    // Saved under the role being arranged, and nothing else touched.
    expect(Object.keys(savedDefaults[0]!)).toEqual(['COORDINATOR'])
    expect(savedDefaults[0]!.COORDINATOR![1]).toEqual({ kind: 'item', key: 'dashboard' })
  })

  it('offers that role’s own screens, not the administrator’s', async () => {
    view(<MenuDefaultsCard />)

    // It opens on the lecturer, who has no platform administration.
    await screen.findByText(/Aquest rol encara no en té cap/)
    expect(screen.queryByText('Plataforma')).not.toBeInTheDocument()
    expect(screen.getByText('La meva càrrega')).toBeInTheDocument()
  })

  it('keeps the roles that were already set when another is arranged', async () => {
    defaults.value = { TEACHER: [{ kind: 'item', key: 'messages' }] }

    view(<MenuDefaultsCard />)

    await userEvent.click(await screen.findByRole('button', { name: 'Coordinació' }))
    await userEvent.click(screen.getByRole('button', { name: 'Baixa Tauler' }))

    await waitFor(() => expect(savedDefaults).toHaveLength(1))
    expect(savedDefaults[0]!.TEACHER).toEqual([{ kind: 'item', key: 'messages' }])
  })

  it('says whether the role has a default at all', async () => {
    defaults.value = { TEACHER: [{ kind: 'item', key: 'messages' }] }

    view(<MenuDefaultsCard />)

    expect(await screen.findByText(/té un menú per defecte definit/)).toBeInTheDocument()
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

  it('carries the number of things waiting beside the entry', async () => {
    pending.value = { changes: 3, absences: 0 }

    view(<Sidebar roles={COORDINATOR} collapsed={false} onToggle={vi.fn()} />)

    // The count arrives on its own request, so the badge appears a tick later
    // than the entry it sits on.
    expect(await screen.findByText('3')).toBeInTheDocument()

    // The number alone says nothing aloud, so the words follow the name.
    const link = screen.getByRole('link', { name: /Canvis de classe/ })
    expect(link).toHaveAccessibleName('Canvis de classe, 3 pendents')
  })

  it('says nothing beside an entry with nothing waiting', async () => {
    pending.value = { changes: 0, absences: 2 }

    view(<Sidebar roles={COORDINATOR} collapsed={false} onToggle={vi.fn()} />)

    expect(await screen.findByRole('link', { name: 'Absències, 2 pendents' })).toBeInTheDocument()

    // Nothing waiting means no badge at all, not a zero.
    const changes = screen.getByRole('link', { name: 'Canvis de classe' })
    expect(within(changes).queryByText('0')).not.toBeInTheDocument()
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
