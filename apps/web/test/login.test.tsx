import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../src/auth/msal', () => ({ isEntraConfigured: () => false }))

afterEach(() => {
  signInLocally.mockReset()
})

async function openLocalForm() {
  render(
    <MemoryRouter>
      <LoginPage />
      <Toaster />
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByRole('button', { name: /administraci/i }))
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
})
