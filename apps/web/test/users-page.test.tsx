import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import type * as ApiModule from '../src/lib/api'
import { UsersPage } from '../src/features/admin/users-page'

/**
 * Inviting somebody is the first thing an administrator needs to do and the
 * last thing this screen could do: it listed, filtered and activated, and had
 * no way to create anyone at all.
 */
const posted = vi.hoisted(() => ({ calls: [] as { path: string; body: unknown }[] }))

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
    apiJson: vi.fn(async (path: string, _method: string, body: unknown) => {
      posted.calls.push({ path, body })
      return { id: 'new-user', email: 'x', created: true }
    }),
  }
})

function view(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {node}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  posted.calls = []
})

describe('the users screen', () => {
  it('invites somebody with the role they will hold in this center', async () => {
    view(<UsersPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Nou usuari' }))

    await userEvent.type(screen.getByLabelText('Nom'), 'Marta')
    await userEvent.type(screen.getByLabelText('Cognoms'), 'Puig Serra')
    await userEvent.type(screen.getByLabelText('Correu electrònic'), 'marta.puig@uni.test')
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'COORDINATOR')
    await userEvent.click(screen.getByRole('button', { name: 'Convida' }))

    await waitFor(() => expect(posted.calls).toHaveLength(1))
    expect(posted.calls[0]?.path).toBe('/api/v1/users')
    expect(posted.calls[0]?.body).toMatchObject({
      email: 'marta.puig@uni.test',
      firstName: 'Marta',
      lastName: 'Puig Serra',
      role: 'COORDINATOR',
    })
  })

  it('keeps the form out of the way of somebody who came only to look', async () => {
    view(<UsersPage />)

    expect(screen.queryByLabelText('Correu electrònic')).not.toBeInTheDocument()
  })
})
