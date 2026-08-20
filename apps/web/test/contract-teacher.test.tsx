import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { ContractTeacher } from '../src/features/capacity/contract-teacher'
import type * as ApiModule from '../src/lib/api'

/**
 * The Professorat screen listed contracts and offered no way to write one:
 * teaching staff could only be added by importing a spreadsheet.
 */
const posted = vi.hoisted(() => ({ calls: [] as { path: string; body: unknown }[] }))
const candidates = vi.hoisted(() => ({
  items: [
    {
      userId: 'u1',
      email: 'sergi.vila@uni.test',
      firstName: 'Sergi',
      lastName: 'Vila',
      avatarUrl: null,
      status: 'invited',
    },
  ] as unknown[],
}))

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({ items: candidates.items })),
    apiJson: vi.fn(async (path: string, _method: string, body: unknown) => {
      posted.calls.push({ path, body })
      return {}
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
  candidates.items = [
    {
      userId: 'u1',
      email: 'sergi.vila@uni.test',
      firstName: 'Sergi',
      lastName: 'Vila',
      avatarUrl: null,
      status: 'invited',
    },
  ]
})

describe('adding teaching staff', () => {
  it('contracts somebody who already holds the lecturer role', async () => {
    view(<ContractTeacher onDone={vi.fn()} />)

    // The people arrive with the query, not with the label.
    await screen.findByRole('option', { name: /Sergi/ })
    await userEvent.selectOptions(screen.getByLabelText('Persona'), 'u1')
    await userEvent.selectOptions(screen.getByLabelText('Categoria'), 'lecturer')
    await userEvent.selectOptions(screen.getByLabelText('Dedicació'), 'part_time')
    await userEvent.clear(screen.getByLabelText('Capacitat'))
    await userEvent.type(screen.getByLabelText('Capacitat'), '120')
    await userEvent.click(screen.getByRole('button', { name: 'Dona-li contracte' }))

    await waitFor(() => expect(posted.calls).toHaveLength(1))
    expect(posted.calls[0]?.path).toBe('/api/v1/teachers')
    expect(posted.calls[0]?.body).toEqual({
      userId: 'u1',
      category: 'lecturer',
      dedication: 'part_time',
      contractedHours: 120,
    })
  })

  it('says where the role is granted when there is nobody left to contract', async () => {
    candidates.items = []
    view(<ContractTeacher onDone={vi.fn()} />)

    // A form with an empty dropdown tells somebody nothing about what to do.
    expect(await screen.findByText(/Administració → Usuaris/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Persona')).not.toBeInTheDocument()
  })
})
