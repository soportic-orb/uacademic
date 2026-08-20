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
      role: 'COORDINATOR',
    },
    {
      centerId: 'c1',
      centerName: "Facultat d'Educació",
      centerCode: 'FEC',
      centerTimezone: 'Europe/Madrid',
      universityId: 'uni1',
      universityName: 'Universitat de Vic',
      role: 'TEACHER',
    },
    {
      centerId: 'c2',
      centerName: 'Facultat de Ciències',
      centerCode: 'FCI',
      centerTimezone: 'Europe/Madrid',
      universityId: 'uni2',
      universityName: 'Universitat Veïna',
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
  it('lists every center under the university it belongs to', () => {
    view(<Header user={user} {...props} heldRoles={[...props.heldRoles]} />)

    const select = screen.getByLabelText('Centre actiu')
    const groups = [...select.querySelectorAll('optgroup')].map((group) => group.label)

    expect(groups).toEqual(['Universitat de Vic', 'Universitat Veïna'])
    // The same center appears once, however many roles are held in it.
    expect(select.querySelectorAll('option')).toHaveLength(2)
  })

  it('changes the active center, and forgets the role that belonged to the old one', async () => {
    view(<Header user={user} {...props} heldRoles={[...props.heldRoles]} />)

    useSessionStore.setState({ activeRole: 'COORDINATOR' })
    await userEvent.selectOptions(screen.getByLabelText('Centre actiu'), 'c2')

    expect(useSessionStore.getState().centerId).toBe('c2')
    // Coordinating at one faculty says nothing about the other.
    expect(useSessionStore.getState().activeRole).toBeUndefined()
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
