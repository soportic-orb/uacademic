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

      // The kinds of day belong to the center, so they come from the server
      // named rather than from a catalog in the browser.
      if (url.includes('/calendar-types')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'vacation', name: 'Període vacacional', builtIn: true },
              { id: 'simulacre', name: 'Simulacre', builtIn: false },
            ],
            page: 1,
            pageSize: 25,
            total: 2,
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

/**
 * What a kind of day is differs between centers — a fire drill, an open day —
 * and the list used to be seven values compiled into the application.
 */
describe('the kinds of day in the academic calendar', () => {
  const fetchMock = vi.fn()
  let types: { id: string; name: string; builtIn: boolean }[] = []

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    types = [{ id: 'simulacre', name: 'Simulacre d’incendi', builtIn: false }]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/calendar-types') && init?.method === 'POST') {
        // Created, and from now on it is one of the center's types — which is
        // what lets the dropdown hold it.
        types.push({ id: 'portes_obertes', name: 'Portes obertes', builtIn: false })
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ id: 'portes_obertes', name: 'Portes obertes', builtIn: false }),
        } as Response)
      }

      if (url.includes('/calendar-types')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [...types],
            page: 1,
            pageSize: 25,
            total: types.length,
            totalPages: 1,
          }),
        } as Response)
      }

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
        json: async () => ({
          items: [
            {
              id: 'entry-1',
              academicYearId: 'year-1',
              type: 'simulacre',
              dateFrom: '2027-04-01',
              dateTo: '2027-04-01',
              nameCa: 'Simulacre de primavera',
              nameEs: 'Simulacro',
              nameEn: 'Drill',
              isTeachingDay: false,
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        }),
      } as Response)
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('names a center’s own type in the table, not its key', async () => {
    render(wrap(<ResourcePage resource={resourceByKey('calendar-entries')!} />))

    expect(
      await within(await screen.findByRole('table')).findByText('Simulacre d’incendi'),
    ).toBeInTheDocument()
  })

  it('creates a type from the dropdown and chooses it straight away', async () => {
    const user = userEvent.setup()
    render(wrap(<ResourcePage resource={resourceByKey('calendar-entries')!} />))

    await user.click(await screen.findByRole('button', { name: 'Crea' }))
    const dialog = screen.getByRole('dialog')
    const types = within(dialog).getByLabelText(/^Tipus/) as HTMLSelectElement

    await user.selectOptions(types, '__new__')

    const panel = within(dialog).getByText('Tipus de dia').parentElement!
    await user.type(within(panel).getByLabelText(/Nom \(català\)/), 'Portes obertes')
    await user.click(within(panel).getByRole('button', { name: 'Crea el tipus' }))

    await waitFor(() => expect(types.value).toBe('portes_obertes'))
    const created = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/calendar-types') &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(JSON.parse(String((created![1] as RequestInit).body))).toMatchObject({
      nameCa: 'Portes obertes',
    })
  })
})

/**
 * Coordination is per subject, and it is chosen where the subject is.
 */
describe('who coordinates a subject', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/v1/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'user-1', name: 'Marta Puig' },
              { id: 'user-2', name: 'Sergi Vila' },
            ],
            page: 1,
            pageSize: 25,
            total: 2,
            totalPages: 1,
          }),
        } as Response)
      }

      if (url.includes('/admin/academic-years')) {
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

      if (url.includes('/admin/degrees')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'degree-1', nameCa: 'Enginyeria' }],
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
        json: async () => ({
          items: [
            {
              id: 'subject-1',
              code: 'MAT101',
              nameCa: 'Matemàtiques I',
              nameEs: 'Matemáticas I',
              nameEn: 'Mathematics I',
              ects: 6,
              year: 1,
              term: 't1',
              type: 'basic',
              teachingLanguage: 'ca',
              academicYearId: 'year-1',
              degreeId: 'degree-1',
              coordinatorIds: ['user-1'],
              coordinatorNames: 'Marta Puig',
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        }),
      } as Response)
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows who coordinates each subject in the table', async () => {
    render(wrap(<ResourcePage resource={resourceByKey('subjects')!} />))

    expect(
      await within(await screen.findByRole('table')).findByText('Marta Puig'),
    ).toBeInTheDocument()
  })

  it('ticks the people already coordinating it, and sends the ones chosen', async () => {
    const user = userEvent.setup()
    render(wrap(<ResourcePage resource={resourceByKey('subjects')!} />))

    await user.click(await screen.findByRole('button', { name: 'Edita' }))
    const dialog = screen.getByRole('dialog')
    const people = within(dialog).getByRole('group', { name: 'Coordinació' })

    expect(within(people).getByLabelText('Marta Puig')).toBeChecked()
    await user.click(within(people).getByLabelText('Sergi Vila'))
    await user.click(within(dialog).getByRole('button', { name: 'Desa' }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
        coordinatorIds: ['user-1', 'user-2'],
      })
    })
  })
})

/**
 * A listing shows what its screen thought was interesting, which is never what
 * everybody in front of it needs.
 */
describe('putting a column away', () => {
  const fetchMock = vi.fn()
  let hidden: string[] = []

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    hidden = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/me/tables') && init?.method === 'PUT') {
        hidden = (JSON.parse(String(init.body)) as { hidden: string[] }).hidden
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ tables: { 'admin:spaces': { hidden } } }),
        } as Response)
      }

      if (url.includes('/me/tables')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ tables: { 'admin:spaces': { hidden } } }),
        } as Response)
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { id: '1', name: 'Aula 1.1', building: 'Edifici A', capacity: 60, type: 'classroom' },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        }),
      } as Response)
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('hides the column, and says so to the server so it survives the session', async () => {
    const user = userEvent.setup()
    render(wrap(<ResourcePage resource={resourceByKey('spaces')!} />))

    expect(
      await within(await screen.findByRole('table')).findByText('Edifici A'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Columnes' }))
    await user.click(screen.getByLabelText('Edifici'))

    await waitFor(() => {
      expect(within(screen.getByRole('table')).queryByText('Edifici A')).not.toBeInTheDocument()
    })

    const saved = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/me/tables') && (init as RequestInit | undefined)?.method === 'PUT',
    )
    expect(JSON.parse(String((saved![1] as RequestInit).body))).toEqual({ hidden: ['building'] })
  })

  it('draws a column the person had hidden before, when they put it back', async () => {
    const user = userEvent.setup()
    hidden = ['building']
    render(wrap(<ResourcePage resource={resourceByKey('spaces')!} />))

    await waitFor(() => {
      expect(within(screen.getByRole('table')).queryByText('Edifici A')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Columnes' }))
    await user.click(screen.getByLabelText('Edifici'))

    expect(await within(screen.getByRole('table')).findByText('Edifici A')).toBeInTheDocument()
  })
})
