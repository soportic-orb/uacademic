import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { ActivatePage } from '../src/pages/activate'

/**
 * The screen an invited person lands on. Until it existed, the invitation
 * email led to a sign-in form and a password nobody had ever been able to set.
 */
const fetchMock = vi.fn()

function renderAt(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/activate${search}`]}>
        <ActivatePage />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const invitation = {
  email: 'sergi.vila@demo.uacademic.test',
  firstName: 'Sergi',
  lastName: 'Vila',
  centerName: 'Facultat d’Educació',
  expiresAt: '2026-08-26T10:00:00.000Z',
  hasMicrosoftAccount: false,
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the activation screen', () => {
  it('greets the person the link was sent to', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => invitation } as Response)

    renderAt('?token=abc')

    expect(await screen.findByText('Sergi Vila')).toBeInTheDocument()
    expect(screen.getByText(/sergi.vila@demo/)).toBeInTheDocument()
  })

  it('sends both fields so the server can refuse a mistyped confirmation', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => invitation } as Response)

    renderAt('?token=abc')
    await screen.findByText('Sergi Vila')

    await userEvent.type(screen.getByLabelText('Contrasenya nova'), 'Contrasenya-2026')
    await userEvent.type(screen.getByLabelText('Confirma la contrasenya nova'), 'Contrasenya-2026')
    await userEvent.click(screen.getByRole('button', { name: /Crea la contrasenya i entra/ }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
      expect(String(post?.[0])).toContain('/api/v1/auth/invitation/abc')
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        password: 'Contrasenya-2026',
        confirmPassword: 'Contrasenya-2026',
      })
    })
  })

  it('says what is wrong with a spent link instead of showing a form that cannot work', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { code: 'NOT_FOUND', message: 'Aquesta invitació ja no és vàlida.' },
      }),
    } as Response)

    renderAt('?token=spent')

    expect(await screen.findByText(/ja no és vàlida/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Contrasenya nova')).not.toBeInTheDocument()
  })

  it('does not ask the server about a link with no token in it', async () => {
    renderAt('')

    expect(await screen.findByText(/ja no és vàlida/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
