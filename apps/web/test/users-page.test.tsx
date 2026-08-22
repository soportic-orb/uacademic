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
  grants: [
    {
      id: 'g1',
      role: 'TEACHER',
      centerId: 'c1',
      centerName: "Facultat d'Educació",
      universityId: 'uni1',
      universityName: 'Universitat de Vic',
    },
  ],
}

/** What this administrator may staff: two faculties, two universities. */
const GRANTABLE = {
  universities: [
    {
      id: 'uni1',
      name: 'Universitat de Vic',
      centers: [{ id: 'c1', name: "Facultat d'Educació", code: 'FEC' }],
    },
    {
      id: 'uni2',
      name: 'Universitat Veïna',
      centers: [{ id: 'c2', name: 'Facultat Veïna', code: 'FVE' }],
    },
  ],
}

const listed = vi.hoisted(() => ({ rows: [] as unknown[] }))
/** Every list URL asked for, so a test can see which center was listed. */
const fetched = vi.hoisted(() => ({ urls: [] as string[] }))
/** What POST /users answers; each branch says a different thing on screen. */
const answer = vi.hoisted(() => ({
  create: {
    created: true,
    grantsAdded: 1,
    invitationSent: true,
    alreadyCouldSignIn: false,
  } as Record<string, unknown>,
}))
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
      if (path.includes('grantable-centers')) return GRANTABLE
      fetched.urls.push(path)
      return { items: listed.rows, total: listed.rows.length, page: 1, pageSize: 25 }
    }),
    apiJson: vi.fn(async (path: string, _method: string, body: unknown) => {
      posted.calls.push({ path, body })
      return { id: 'new-user', email: 'x', ...answer.create }
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
  fetched.urls = []
  answer.create = {
    created: true,
    grantsAdded: 1,
    invitationSent: true,
    alreadyCouldSignIn: false,
  }
})

describe('the users screen', () => {
  async function openFormAndFillIdentity() {
    view(<UsersPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Nou usuari' }))
    await userEvent.type(screen.getByLabelText('Nom'), 'Marta')
    await userEvent.type(screen.getByLabelText('Cognoms'), 'Puig Serra')
    await userEvent.type(screen.getByLabelText('Correu electrònic'), 'marta.puig@uni.test')
  }

  /** The invitation is opt-in, so the tests about it have to ask for it. */
  async function askForTheInvitation() {
    await userEvent.click(screen.getByLabelText(/Envia la invitació per correu/))
  }

  it('creates somebody with the center and role they will hold', async () => {
    await openFormAndFillIdentity()

    await userEvent.selectOptions(await screen.findByLabelText('Centre'), 'c1')
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'COORDINATOR')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))
    await userEvent.click(screen.getByRole('button', { name: "Crea l'usuari" }))

    await waitFor(() => expect(posted.calls).toHaveLength(1))
    expect(posted.calls[0]?.path).toBe('/api/v1/users')
    expect(posted.calls[0]?.body).toMatchObject({
      email: 'marta.puig@uni.test',
      firstName: 'Marta',
      lastName: 'Puig Serra',
      grants: [{ centerId: 'c1', role: 'COORDINATOR' }],
      // Nobody is written to unless somebody asked for it.
      sendInvitation: false,
    })
  })

  it('writes to the person only when the invitation is ticked', async () => {
    await openFormAndFillIdentity()

    await userEvent.selectOptions(await screen.findByLabelText('Centre'), 'c1')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))
    await askForTheInvitation()

    // The button says what it is about to do, which is now two things.
    await userEvent.click(screen.getByRole('button', { name: 'Convida' }))

    await waitFor(() => expect(posted.calls).toHaveLength(1))
    expect(posted.calls[0]?.body).toMatchObject({ sendInvitation: true })
  })

  it('says no invitation went out, rather than blaming the mail server', async () => {
    answer.create = {
      created: true,
      grantsAdded: 1,
      invitationSent: false,
      alreadyCouldSignIn: false,
    }

    await openFormAndFillIdentity()
    await userEvent.selectOptions(await screen.findByLabelText('Centre'), 'c1')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))
    await userEvent.click(screen.getByRole('button', { name: "Crea l'usuari" }))

    expect(await screen.findByText(/No s'ha enviat cap invitació/)).toBeInTheDocument()
    // Nothing failed: nobody was expecting a message to go out.
    expect(screen.queryByText(/SMTP/)).not.toBeInTheDocument()
  })

  it('gives one person roles at two universities in one invitation', async () => {
    await openFormAndFillIdentity()

    await userEvent.selectOptions(await screen.findByLabelText('Centre'), 'c1')
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'COORDINATOR')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))

    await userEvent.selectOptions(screen.getByLabelText('Centre'), 'c2')
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'TEACHER')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))

    await askForTheInvitation()
    await userEvent.click(screen.getByRole('button', { name: 'Convida' }))

    await waitFor(() => expect(posted.calls).toHaveLength(1))
    expect(posted.calls[0]?.body).toMatchObject({
      grants: [
        { centerId: 'c1', role: 'COORDINATOR' },
        { centerId: 'c2', role: 'TEACHER' },
      ],
    })
  })

  /**
   * Adding somebody who already exists answered without an `invitationSent`
   * field at all, and the screen read the missing field as "no mail server" —
   * telling an administrator whose mail works perfectly that it does not.
   */
  it('does not blame the mail server when access was simply added', async () => {
    answer.create = {
      created: false,
      grantsAdded: 1,
      invitationSent: false,
      alreadyCouldSignIn: true,
    }

    await openFormAndFillIdentity()
    await userEvent.selectOptions(await screen.findByLabelText('Centre'), 'c1')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))
    await askForTheInvitation()
    await userEvent.click(screen.getByRole('button', { name: 'Convida' }))

    expect(await screen.findByText(/ja podia entrar/)).toBeInTheDocument()
    expect(screen.queryByText(/SMTP/)).not.toBeInTheDocument()
  })

  it('says the mail server is unconfigured only when it actually is', async () => {
    answer.create = {
      created: true,
      grantsAdded: 1,
      invitationSent: false,
      alreadyCouldSignIn: false,
    }

    await openFormAndFillIdentity()
    await userEvent.selectOptions(await screen.findByLabelText('Centre'), 'c1')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))
    // Asked for, and it did not go: that, and only that, is a mail problem.
    await askForTheInvitation()
    await userEvent.click(screen.getByRole('button', { name: 'Convida' }))

    expect(await screen.findByText(/SMTP/)).toBeInTheDocument()
  })

  it('looks at the center somebody was put in, so the new row is on screen', async () => {
    await openFormAndFillIdentity()
    await userEvent.selectOptions(await screen.findByLabelText('Centre'), 'c2')
    await userEvent.click(screen.getByRole('button', { name: 'Afegeix accés' }))
    await userEvent.click(screen.getByRole('button', { name: "Crea l'usuari" }))

    // Created into the other faculty, so the list follows: otherwise the row
    // is simply absent from the screen that just said it was created.
    await waitFor(() => expect(fetched.urls.some((url) => url.includes('centerId=c2'))).toBe(true))
  })

  it('will not create somebody into nowhere', async () => {
    await openFormAndFillIdentity()

    // An account with no role anywhere can sign in and see nothing.
    expect(screen.getByRole('button', { name: "Crea l'usuari" })).toBeDisabled()
    expect(screen.getByText(/com a mínim un centre/)).toBeInTheDocument()
  })

  it('offers only the centers this administrator may staff', async () => {
    await openFormAndFillIdentity()

    const select = await screen.findByLabelText('Centre')
    // The university is the group label, which is how two faculties with the
    // same name stay tellable apart.
    const groups = [...select.querySelectorAll('optgroup')].map((group) => group.label)
    expect(groups).toEqual(['Universitat de Vic', 'Universitat Veïna'])
    expect(select).toHaveTextContent("Facultat d'Educació")
    expect(select).not.toHaveTextContent('Facultat Aliena')
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
