import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ADMIN_RESOURCES,
  resourceByKey,
  resourcesForRoles,
} from '../src/features/admin/resource-config'
import { ResourcePage } from '../src/features/admin/resource-page'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('admin resource configuration', () => {
  it('keeps the platform resources for the superadmin only', () => {
    const superadminKeys = resourcesForRoles(['SUPERADMIN']).map((resource) => resource.key)
    const centerAdminKeys = resourcesForRoles(['CENTER_ADMIN']).map((resource) => resource.key)

    expect(superadminKeys).toContain('universities')
    expect(superadminKeys).toContain('entra-tenants')
    expect(centerAdminKeys).not.toContain('universities')
    expect(centerAdminKeys).toContain('spaces')
  })

  it('gives a coordinator groups but not the structural tables', () => {
    const keys = resourcesForRoles(['COORDINATOR']).map((resource) => resource.key)

    expect(keys).toEqual(['groups'])
  })

  it('requires the three languages on every trilingual entity (R1)', () => {
    for (const key of ['degrees', 'subjects', 'calendar-entries']) {
      const fields = resourceByKey(key)?.fields.map((field) => field.name) ?? []
      expect(fields).toContain('nameCa')
      expect(fields).toContain('nameEs')
      expect(fields).toContain('nameEn')
    }
  })

  it('declares a label field that exists among its columns or fields', () => {
    for (const resource of ADMIN_RESOURCES) {
      const known = [
        ...resource.columns.map((column) => column.key),
        ...resource.fields.map((field) => field.name),
      ]
      expect(known).toContain(resource.labelField)
    }
  })
})

describe('resource table', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The tenants table also asks which Entra application this installation signs
  // in against, so the mock answers that one separately.
  const respondWith = (body: unknown) =>
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const payload = url.includes('/auth/config')
        ? {
            mode: 'entra',
            entra: {
              clientId: 'test-client',
              authority: 'https://login.microsoftonline.com/organizations',
            },
          }
        : body
      return Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response)
    })

  it('asks the server for the page, the sort and the search term', async () => {
    const user = userEvent.setup()
    respondWith({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 })

    render(wrap(<ResourcePage resource={resourceByKey('spaces')!} />))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes('/api/v1/admin/spaces?page=1&pageSize=25'))).toBe(true)
    })

    await user.type(screen.getByPlaceholderText('Cerca…'), 'aula')

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes('q=aula'))).toBe(true)
    })
  })

  it('renders enum columns through the catalog, not as raw values', async () => {
    respondWith({
      items: [
        { id: '1', name: 'Aula 1.1', building: 'Edifici A', capacity: 60, type: 'computer_lab' },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    })

    render(wrap(<ResourcePage resource={resourceByKey('spaces')!} />))

    expect(await screen.findByText('Aula 1.1')).toBeInTheDocument()
    // Scoped to the table: the same label also exists in the type filter.
    expect(within(screen.getByRole('table')).getByText("Aula d'informàtica")).toBeInTheDocument()
  })

  /**
   * A multi-tenant application exists only where it was registered. Every other
   * university has to install it once, and until they do Microsoft refuses
   * everybody there with AADSTS500011 and shows no prompt to click through —
   * so the superadmin registering the tenant is handed the link to pass on.
   */
  it('hands the superadmin the link that installs the app in a tenant', async () => {
    respondWith({
      items: [
        { id: '1', displayName: 'UVic', tenantId: 'uvic.cat', status: 'active' },
        { id: '2', displayName: 'Sense tenant', tenantId: '', status: 'active' },
      ],
      page: 1,
      pageSize: 25,
      total: 2,
      totalPages: 1,
    })

    render(wrap(<ResourcePage resource={resourceByKey('entra-tenants')!} />))

    const link = await screen.findByRole('link', { name: "Instal·la a l'organització" })
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('login.microsoftonline.com/uvic.cat/adminconsent'),
    )
    expect(link).toHaveAttribute('href', expect.stringContaining('client_id=test-client'))
    // The row with no tenant identifier has nothing to link to.
    expect(screen.getAllByRole('link', { name: "Instal·la a l'organització" })).toHaveLength(1)
  })

  it('offers the empty state with a create action when nothing matches', async () => {
    respondWith({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 })

    render(wrap(<ResourcePage resource={resourceByKey('spaces')!} />))

    expect(await screen.findByText('Encara no hi ha res aquí')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Crea' }).length).toBeGreaterThan(0)
  })
})

/**
 * A date range is one control writing two names, and the form used to collect
 * only the names it draws — so the far end of every range was dropped on the
 * way out. The server refused each academic calendar entry for a missing end
 * date, and the complaint arrived against a field the form does not draw, so
 * nothing was shown: the button simply appeared not to work.
 */
describe('a form with a date range on it', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/academic-years')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'year-1', name: '2026–2027' }],
            page: 1,
            pageSize: 25,
            total: 1,
            totalPages: 1,
          }),
        } as Response)
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
      } as Response)
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'Crea' }))

    await user.selectOptions(await screen.findByLabelText(/Curs acadèmic/), 'year-1')
    // The filter above the table carries the same label, so this is the one
    // inside the dialog.
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText(/^Tipus/), 'vacation')
    await user.type(screen.getByLabelText(/Nom \(català\)/), 'Setmana Santa')
    await user.type(screen.getByLabelText(/Nom \(castellà\)/), 'Semana Santa')
    await user.type(screen.getByLabelText(/Nom \(anglès\)/), 'Easter')
  }

  const posted = () =>
    fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')

  const dateInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')]

  it('sends both ends of the range, not only the one with a field', async () => {
    const user = userEvent.setup()
    render(wrap(<ResourcePage resource={resourceByKey('calendar-entries')!} />))

    await fill(user)

    // Two different dates: the tick that means "a single day" comes off.
    await user.click(screen.getByLabelText(/dia únic/))
    // `type` on a date input is not reliable in jsdom; the change is.
    const dates = dateInputs()
    fireEvent.change(dates[0]!, { target: { value: '2027-04-01' } })
    fireEvent.change(dates[1]!, { target: { value: '2027-04-07' } })

    await user.click(screen.getByRole('button', { name: 'Desa' }))

    await waitFor(() => expect(posted()).toBeDefined())
    const body = JSON.parse(String((posted()![1] as RequestInit).body)) as Record<string, unknown>
    expect(body.dateFrom).toBe('2027-04-01')
    expect(body.dateTo).toBe('2027-04-07')
  })

  it('sends the same date twice for a single day', async () => {
    const user = userEvent.setup()
    render(wrap(<ResourcePage resource={resourceByKey('calendar-entries')!} />))

    await fill(user)

    fireEvent.change(dateInputs()[0]!, { target: { value: '2027-04-01' } })

    await user.click(screen.getByRole('button', { name: 'Desa' }))

    await waitFor(() => expect(posted()).toBeDefined())
    const body = JSON.parse(String((posted()![1] as RequestInit).body)) as Record<string, unknown>
    expect(body.dateFrom).toBe('2027-04-01')
    expect(body.dateTo).toBe('2027-04-01')
  })
})
