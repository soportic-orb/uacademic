import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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

  const respondWith = (body: unknown) =>
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as Response)

  it('asks the server for the page, the sort and the search term', async () => {
    const user = userEvent.setup()
    respondWith({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 })

    render(wrap(<ResourcePage resource={resourceByKey('spaces')!} />))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/v1/admin/spaces?page=1&pageSize=25',
    )

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

  it('offers the empty state with a create action when nothing matches', async () => {
    respondWith({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 })

    render(wrap(<ResourcePage resource={resourceByKey('spaces')!} />))

    expect(await screen.findByText('Encara no hi ha res aquí')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Crea' }).length).toBeGreaterThan(0)
  })
})
