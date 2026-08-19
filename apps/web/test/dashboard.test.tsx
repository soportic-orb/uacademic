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
/** Overrides the 404 default for one test, keyed by the path asked for. */
const answers = vi.hoisted(() => ({ byPath: {} as Record<string, unknown> }))

vi.mock('../src/app/use-roles', () => ({ useRoles: () => roles.current }))
vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string) => {
      fetched.urls.push(path)
      const answer = answers.byPath[path]
      if (answer !== undefined) return answer
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
  answers.byPath = {}
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

  /**
   * A center whose academic year has not been created yet. The endpoint used
   * to answer 404 and this screen turned it into "something went wrong", which
   * told a coordinator nothing about the one thing that had to happen.
   */
  const noYear = {
    academicYearId: null,
    teachers: [],
    summary: {
      teachers: 0,
      totalCapacityHours: 0,
      totalAssignedHours: 0,
      ratioPercent: 0,
      byStatus: { under: 0, optimal: 0, limit: 0, over: 0 },
    },
  }

  it('tells a coordinator that the center has no academic year yet', async () => {
    roles.current = ['COORDINATOR']
    answers.byPath['/api/v1/teachers/load'] = noYear

    view(<DashboardPage />)

    expect(await screen.findByText(/cap curs acadèmic actiu/)).toBeInTheDocument()
    // Academic years are the center administrator's screen; sending a
    // coordinator there would only find them a door they cannot open.
    expect(screen.queryByRole('button', { name: /Cursos acadèmics/ })).not.toBeInTheDocument()
    expect(screen.getByText(/administració del centre/)).toBeInTheDocument()
  })

  it('offers the center administrator the screen that fixes it', async () => {
    roles.current = ['CENTER_ADMIN']
    answers.byPath['/api/v1/teachers/load'] = noYear

    view(<DashboardPage />)

    expect(await screen.findByText(/cap curs acadèmic actiu/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cursos acadèmics/ })).toBeInTheDocument()
  })
})
