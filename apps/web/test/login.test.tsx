import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthConfig } from '../src/auth/config'
import { Toaster } from '../src/components/feedback/toaster'
import { LoginPage } from '../src/pages/login'

/**
 * The sign-in screen of an installation an hour old: Microsoft is not
 * registered yet and the superadmin's credential has no authenticator behind
 * it. Asking for a six-digit code there is asking for something that does not
 * exist.
 */
const signInLocally = vi.fn()

vi.mock('../src/auth/session', () => ({
  useSession: () => ({
    signInWithEntra: vi.fn(),
    signInLocally,
    isAuthenticated: false,
  }),
}))

const authConfig = vi.fn<() => { isPending: boolean; data: AuthConfig }>(() => ({
  isPending: false,
  data: { mode: 'local', entra: null, locales: ['ca', 'es', 'en'] },
}))

vi.mock('../src/auth/config', () => ({ useAuthConfig: () => authConfig() }))

afterEach(() => {
  signInLocally.mockReset()
  authConfig.mockReturnValue({
    isPending: false,
    data: { mode: 'local', entra: null, locales: ['ca', 'es', 'en'] },
  })
})

async function openLocalForm() {
  render(
    <MemoryRouter>
      <LoginPage />
      <Toaster />
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByRole('button', { name: /correu i contrasenya/i }))
}

describe('the sign-in screen', () => {
  it('asks for no verification code until an account turns out to want one', async () => {
    await openLocalForm()

    expect(screen.getByLabelText('Correu electrònic')).toBeInTheDocument()
    expect(screen.queryByLabelText('Codi de verificació')).not.toBeInTheDocument()
  })

  it('sends only what was typed, with no empty code field alongside', async () => {
    signInLocally.mockResolvedValue(undefined)
    await openLocalForm()

    await userEvent.type(screen.getByLabelText('Correu electrònic'), 'admin@uacademic.cat')
    await userEvent.type(screen.getByLabelText('Contrasenya'), 'una-contrasenya-llarga')
    await userEvent.click(screen.getByRole('button', { name: 'Entra' }))

    expect(signInLocally).toHaveBeenCalledWith({
      email: 'admin@uacademic.cat',
      password: 'una-contrasenya-llarga',
    })
  })

  it('shows the code field when the account does have a second factor', async () => {
    const { ApiRequestError } = await import('../src/lib/api')
    signInLocally.mockRejectedValueOnce(
      new ApiRequestError(401, 'UNAUTHORIZED', 'Cal el codi.', 'auth.errors.totpRequired'),
    )
    await openLocalForm()

    await userEvent.type(screen.getByLabelText('Correu electrònic'), 'admin@uacademic.cat')
    await userEvent.type(screen.getByLabelText('Contrasenya'), 'una-contrasenya-llarga')
    await userEvent.click(screen.getByRole('button', { name: 'Entra' }))

    expect(await screen.findByLabelText('Codi de verificació')).toBeInTheDocument()
  })

  /**
   * The button used to be enabled by a build-time variable, so an operator who
   * registered the application after the web app was built had no way to reach
   * Microsoft short of rebuilding — and nothing said so.
   */
  it('offers Microsoft as soon as the installation reports it configured', () => {
    authConfig.mockReturnValue({
      isPending: false,
      data: {
        mode: 'entra',
        entra: { clientId: 'app-id', authority: 'https://login/organizations' },
        locales: ['ca', 'es', 'en'],
      },
    })

    render(
      <MemoryRouter>
        <LoginPage />
        <Toaster />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: /Microsoft/ })).toBeEnabled()
  })

  it('says why Microsoft is unavailable instead of greying the button in silence', () => {
    render(
      <MemoryRouter>
        <LoginPage />
        <Toaster />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: /Microsoft/ })).toBeDisabled()
    expect(screen.getByText(/no està configurat/)).toBeInTheDocument()
  })
})
