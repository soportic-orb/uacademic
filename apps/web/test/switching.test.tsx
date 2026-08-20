import type { SessionUser } from '@uacademic/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Header } from '../src/components/layout/header'
import { useSessionStore } from '../src/stores/session'

/**
 * Somebody who works at more than one place.
 *
 * One account, several centers across several universities, and in one of them
 * two roles at once. The header is where they move between all of that; before
 * it did, a coordinator who also taught saw both menus fused into one and no
 * way to look at their own week as a lecturer sees it.
 */
vi.mock('../src/auth/session', () => ({ useSession: () => ({ signOut: vi.fn() }) }))
vi.mock('../src/features/notifications/notification-bell', () => ({
  NotificationBell: () => null,
}))
vi.mock('../src/app/service-worker', () => ({ clearApiCache: vi.fn() }))

const user = {
  id: 'u1',
  email: 'octavi@uni.test',
  firstName: 'Octavi',
  lastName: 'Rodríguez',
  locale: 'ca',
  theme: 'system',
  avatarUrl: null,
  status: 'active',
  authMethod: 'local',
  microsoftAccount: null,
  expiresAt: '2026-09-01T00:00:00.000Z',
  memberships: [
    {
      centerId: 'c1',
      centerName: "Facultat d'Educació",
      centerCode: 'FEC',
      centerTimezone: 'Europe/Madrid',
      universityId: 'uni1',
      universityName: 'Universitat de Vic',
      universityLogoUrl: null,
      role: 'COORDINATOR',
    },
    {
      centerId: 'c1',
      centerName: "Facultat d'Educació",
      centerCode: 'FEC',
      centerTimezone: 'Europe/Madrid',
      universityId: 'uni1',
      universityName: 'Universitat de Vic',
      universityLogoUrl: null,
      role: 'TEACHER',
    },
    {
      centerId: 'c2',
      centerName: 'Facultat de Ciències',
      centerCode: 'FCI',
      centerTimezone: 'Europe/Madrid',
      universityId: 'uni2',
      universityName: 'Universitat Veïna',
      universityLogoUrl: null,
      role: 'TEACHER',
    },
  ],
} as unknown as SessionUser

/** One university, two of its faculties: the center list has work to do. */
const twoCentersOneUniversity = {
  ...user,
  memberships: [
    {
      centerId: 'c1',
      centerName: "Facultat d'Educació",
      centerCode: 'FEC',
      centerTimezone: 'Europe/Madrid',
      universityId: 'uni1',
      universityName: 'Universitat de Vic',
      universityLogoUrl: null,
      role: 'TEACHER',
    },
    {
      centerId: 'c3',
      centerName: 'Facultat de Ciències de la Salut',
      centerCode: 'FCS',
      centerTimezone: 'Europe/Madrid',
      universityId: 'uni1',
      universityName: 'Universitat de Vic',
      universityLogoUrl: null,
      role: 'TEACHER',
    },
  ],
} as unknown as SessionUser

function view(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'c1', activeRole: undefined })
})

afterEach(() => {
  useSessionStore.setState({ centerId: undefined, activeRole: undefined })
})

const props = {
  heldRoles: ['COORDINATOR', 'TEACHER'] as const,
  activeRole: 'COORDINATOR' as const,
  onOpenSearch: vi.fn(),
  onToggleSidebar: vi.fn(),
}

describe('moving between centers and roles', () => {
  it('names the university whose rules are in force', () => {
    view(<Header user={user} {...props} heldRoles={[...props.heldRoles]} />)

    expect(screen.getByRole('button', { name: 'Universitat' })).toBeInTheDocument()
    expect(screen.getByText('Universitat de Vic')).toBeInTheDocument()
  })

  it('offers only the centers of the university being worked in', () => {
    // Both faculties are in the same university here, so both are listed.
    useSessionStore.setState({ centerId: 'c1' })
    view(<Header user={twoCentersOneUniversity} {...props} heldRoles={['TEACHER']} />)

    const select = screen.getByLabelText('Centre actiu')
    expect(select.querySelectorAll('option')).toHaveLength(2)
  })

  it('hides the center list when this university has only one', () => {
    view(<Header user={user} {...props} heldRoles={[...props.heldRoles]} />)

    // The person also works at another university, but not at another of this
    // one's centers — so there is nothing to choose between.
    expect(screen.queryByLabelText('Centre actiu')).not.toBeInTheDocument()
  })

  it('moves to another university, landing in one of its centers', async () => {
    view(<Header user={user} {...props} heldRoles={[...props.heldRoles]} />)

    await userEvent.click(screen.getByRole('button', { name: 'Universitat' }))
    await userEvent.click(screen.getByRole('button', { name: /Universitat Veïna/ }))

    expect(useSessionStore.getState().centerId).toBe('c2')
  })

  it('does not offer the dialog to somebody who belongs to one university', () => {
    view(<Header user={twoCentersOneUniversity} {...props} heldRoles={['TEACHER']} />)

    expect(screen.queryByRole('button', { name: 'Universitat' })).not.toBeInTheDocument()
    expect(screen.getByText('Universitat de Vic')).toBeInTheDocument()
  })

  it('offers the roles held here, and switches between them', async () => {
    view(<Header user={user} {...props} heldRoles={[...props.heldRoles]} />)

    await userEvent.selectOptions(screen.getByLabelText('Rol actiu'), 'TEACHER')

    expect(useSessionStore.getState().activeRole).toBe('TEACHER')
  })

  it('offers no role switch to somebody who holds a single one', () => {
    view(<Header user={user} {...props} heldRoles={['TEACHER']} activeRole="TEACHER" />)

    expect(screen.queryByLabelText('Rol actiu')).not.toBeInTheDocument()
  })
})
