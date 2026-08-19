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

const ROW = {
  id: 'u1',
  email: 'marta@uni.test',
  firstName: 'Marta',
  lastName: 'Puig',
  locale: 'ca',
  status: 'invited',
  linkedToEntra: false,
  lastLoginAt: null,
  roles: ['TEACHER'],
  grants: [{ id: 'g1', role: 'TEACHER' }],
}

const listed = vi.hoisted(() => ({ rows: [] as unknown[] }))
const deleted = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleted.calls.push(path)
        return {}
      }
      return { items: listed.rows, total: listed.rows.length, page: 1, pageSize: 25 }
    }),
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
  deleted.calls = []
  listed.rows = []
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

  describe('what it offers for somebody already there', () => {
    it('offers to invite again whoever has never signed in', async () => {
      listed.rows = [ROW]
      view(<UsersPage />)

      await userEvent.click(await screen.findByRole('button', { name: 'Torna a convidar' }))

      await waitFor(() => expect(posted.calls).toHaveLength(1))
      expect(posted.calls[0]?.path).toBe('/api/v1/users/u1/invite')
    })

    it('does not offer it to somebody who has already arrived', async () => {
      listed.rows = [{ ...ROW, linkedToEntra: true }]
      view(<UsersPage />)

      expect(await screen.findByRole('button', { name: 'Edita' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Torna a convidar' })).not.toBeInTheDocument()
    })

    it('takes a role away by its grant, not by its name', async () => {
      // Two people can hold the same role; only the grant identifies which
      // one is being removed.
      listed.rows = [ROW]
      view(<UsersPage />)

      await userEvent.click(await screen.findByRole('button', { name: 'Edita' }))
      await userEvent.click(screen.getByRole('button', { name: 'Retira el rol Professorat' }))

      await waitFor(() => expect(deleted.calls).toHaveLength(1))
      expect(deleted.calls[0]).toBe('/api/v1/users/u1/roles/g1')
    })
  })
})
