import type { Role } from '@uacademic/shared'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { mobileNavItems, navItemsForRoles } from '../src/app/navigation'
import { LoadBadge } from '../src/components/data/load-badge'
import { Sidebar } from '../src/components/layout/sidebar'

describe('role-based navigation', () => {
  it('shows a teacher only what a teacher can do', () => {
    const keys = navItemsForRoles(['TEACHER']).map((item) => item.key)

    expect(keys).toContain('myLoad')
    expect(keys).toContain('subjects')
    expect(keys).not.toContain('teachers')
    expect(keys).not.toContain('planning')
    expect(keys).not.toContain('platform')
  })

  it('gives the assistant to coordinators only', () => {
    const withAssistant = (roles: Role[]) =>
      navItemsForRoles(roles).some((item) => item.key === 'assistant')

    expect(withAssistant(['COORDINATOR'])).toBe(true)
    expect(withAssistant(['TEACHER'])).toBe(false)
    expect(withAssistant(['CENTER_ADMIN'])).toBe(false)
    expect(withAssistant(['SUPERADMIN'])).toBe(false)
  })

  it('reserves the platform section for the superadmin', () => {
    expect(navItemsForRoles(['SUPERADMIN']).map((item) => item.key)).toContain('platform')
    expect(navItemsForRoles(['CENTER_ADMIN']).map((item) => item.key)).not.toContain('platform')
  })

  it('keeps the mobile bar at five entries for every role', () => {
    for (const role of ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'] as Role[]) {
      expect(mobileNavItems([role]).length).toBeLessThanOrEqual(5)
    }
    expect(mobileNavItems(['COORDINATOR'])).toHaveLength(5)
  })

  it('renders the sidebar as a labelled navigation landmark', () => {
    render(
      <MemoryRouter>
        <Sidebar roles={['TEACHER']} collapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Navegació principal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'La meva càrrega' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Professorat' })).not.toBeInTheDocument()
  })

  it('keeps the sidebar labels reachable when collapsed', () => {
    render(
      <MemoryRouter>
        <Sidebar roles={['TEACHER']} collapsed onToggle={() => {}} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'La meva càrrega' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desplega el menú lateral' })).toBeInTheDocument()
  })
})

describe('load traffic light', () => {
  it('never relies on color alone', () => {
    render(<LoadBadge status="over" ratioPercent={116.67} />)

    expect(screen.getByText('Sobrecàrrega')).toBeInTheDocument()
    expect(screen.getByText('117%')).toBeInTheDocument()
  })

  it('labels each status with its threshold explanation', () => {
    const { container } = render(<LoadBadge status="limit" />)

    expect(container.firstElementChild).toHaveAttribute(
      'title',
      'Entre el 100 % i el 110 % de la capacitat contractada',
    )
  })
})
