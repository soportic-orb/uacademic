import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '../src/lib/api'
import { DashboardPage } from '../src/pages/dashboard'
import { useSessionStore } from '../src/stores/session'

/**
 * The first screen of a brand-new installation.
 *
 * Its only user then is the superadmin the installer created, who teaches
 * nothing and administers no center — a shape the dashboard did not have, so
 * it asked the teacher endpoint about them and showed "we could not find the
 * resource" as the welcome.
 */
const roles = vi.hoisted(() => ({ current: ['SUPERADMIN'] as string[] }))
const fetched = vi.hoisted(() => ({ urls: [] as string[] }))

vi.mock('../src/app/use-roles', () => ({ useRoles: () => roles.current }))
vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string) => {
      fetched.urls.push(path)
      throw new actual.ApiRequestError(404, 'NOT_FOUND', 'No hem trobat el recurs.')
    }),
  }
})

function view(node: ReactNode) {
  // The queries only run once a center is active, which is what the session
  // holds after signing in.
  useSessionStore.getState().setCenterId('c1')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  fetched.urls = []
  roles.current = ['SUPERADMIN']
})

describe('the dashboard', () => {
  it('shows the platform administrator what they administer, and asks nothing about teaching', async () => {
    view(<DashboardPage />)

    expect(await screen.findByRole('link', { name: 'Centres' })).toBeInTheDocument()
    expect(fetched.urls).toEqual([])
  })

  it('tells somebody with no teaching that they have none, rather than failing', async () => {
    roles.current = ['TEACHER']
    view(<DashboardPage />)

    expect(await screen.findByText('Encara no tens docència assignada')).toBeInTheDocument()
    expect(fetched.urls).toContain('/api/v1/teachers/me/load')
  })
})
