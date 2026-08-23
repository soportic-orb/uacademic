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

  it('moves an entry and saves it when asked to', async () => {
    view(<MenuCard roles={TEACHER} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Baixa Tauler' }))
    // Nothing is written until the button is pressed: a request per press is
    // a request per keystroke once a label is being typed, and those race.
    expect(saved).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    // The dashboard was first; now it is second, and nothing else moved.
    expect(saved[0]![1]).toEqual({ kind: 'item', key: 'dashboard' })
  })

  it('says whether there is anything to save', async () => {
    view(<MenuCard roles={TEACHER} />)

    expect(await screen.findByText('Tot desat.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Baixa Tauler' }))
    expect(screen.getByText('Tens canvis sense desar.')).toBeInTheDocument()
  })

  it('puts the draft back when it is discarded', async () => {
    view(<MenuCard roles={TEACHER} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Baixa Tauler' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descarta' }))

    expect(screen.getByText('Tot desat.')).toBeInTheDocument()
    expect(saved).toHaveLength(0)
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
    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]![1]).toMatchObject({ kind: 'separator', label: 'Docència' })
  })

  it('keeps the separator that was already there when another is added', async () => {
    view(<MenuCard roles={TEACHER} />)

    const label = await screen.findByLabelText('Etiqueta del separador')
    await userEvent.type(label, 'Primer')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix un separador' }))

    await userEvent.type(screen.getByLabelText('Etiqueta del separador'), 'Segon')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix un separador' }))

    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    const separators = saved[0]!.filter((entry) => (entry as { kind: string }).kind === 'separator')
    // The new one used to land against the old one and the tidying dropped
    // one of the two, which reads as the second overwriting the first.
    expect(separators).toHaveLength(2)
    expect(separators.map((entry) => (entry as { label: string }).label).sort()).toEqual([
      'Primer',
      'Segon',
    ])
  })

  it('still shows both separators after they have been saved', async () => {
    // What the server hands back once two have been added: adjacent, until
    // something is moved between them. The editor used to draw the tidied
    // menu, so reopening the screen showed one — which reads as the second
    // having overwritten the first.
    stored.entries = [
      { kind: 'item', key: 'dashboard' },
      { kind: 'separator', id: 'sep-2', label: 'Segon' },
      { kind: 'separator', id: 'sep-1', label: 'Primer' },
      { kind: 'item', key: 'myLoad' },
    ]
    stored.personalised = true

    view(<MenuCard roles={TEACHER} />)

    expect(await screen.findByDisplayValue('Primer')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Segon')).toBeInTheDocument()
  })

  it('keeps the draft when something above it re-renders', async () => {
    /*
      The card above hands the editor a fresh array on every render, and a
      save, a refetch or a toast is enough to cause one. Re-seeding on those
      arrays put the stored value back over whatever was being arranged: a
      separator added a moment earlier vanished, and Save went back to
      disabled because the draft suddenly matched what was saved.
    */
    const { rerender } = view(<MenuCard roles={TEACHER} />)

    await userEvent.type(await screen.findByLabelText('Etiqueta del separador'), 'Docència')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix un separador' }))
    expect(screen.getByDisplayValue('Docència')).toBeInTheDocument()

    // Anything at all above the editor rendering again.
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <MenuCard roles={[...TEACHER]} />
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByDisplayValue('Docència')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desa' })).toBeEnabled()
  })

  it('writes one request for a whole label, not one per keystroke', async () => {
    view(<MenuCard roles={TEACHER} />)

    await userEvent.type(await screen.findByLabelText('Etiqueta del separador'), 'Docència')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix un separador' }))
    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    // Eight keystrokes used to be eight requests, and their answers could
    // land out of order and put a shorter label back.
    expect(saved).toHaveLength(1)
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
    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Desa' }))

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
