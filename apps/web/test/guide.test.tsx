import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GuidePage } from '../src/pages/guide'

/**
 * The guide is the answer to "I have signed in and I do not know what to do
 * first" — so what it must get right is the order, and that each role is told
 * about its own work rather than everybody's.
 */
const roles = vi.hoisted(() => ({ current: ['TEACHER'] as string[] }))
vi.mock('../src/app/use-roles', () => ({ useRoles: () => roles.current }))

afterEach(() => {
  roles.current = ['TEACHER']
  window.localStorage.clear()
})

const view = () =>
  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>,
  )

describe('the getting-started guide', () => {
  it('opens on the guide for the role being worked as', () => {
    roles.current = ['COORDINATOR']
    view()

    expect(screen.getByText(/Crea una versió d.horari/)).toBeInTheDocument()
    // Setting the installation up is not a coordinator's job.
    expect(screen.queryByText('Crea els centres')).not.toBeInTheDocument()
  })

  it('tells a lecturer about their week, not about the platform', () => {
    view()

    expect(screen.getByText('Indica la teva disponibilitat')).toBeInTheDocument()
    expect(screen.queryByText('Registra els tenants de Microsoft')).not.toBeInTheDocument()
  })

  it('lets somebody read another role’s guide without holding it', async () => {
    view()

    await userEvent.selectOptions(screen.getByLabelText(/altre rol/), 'SUPERADMIN')

    expect(screen.getByText('Crea els centres')).toBeInTheDocument()
  })

  it('keeps the ticks in the browser, since they are a reading aid', async () => {
    view()

    const before = screen.getByText('0 de 9 passos marcats')
    expect(before).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Marca com a fet' })[0]!)

    expect(screen.getByText('1 de 9 passos marcats')).toBeInTheDocument()
    expect(window.localStorage.getItem('uacademic.guide.done')).toContain('profile')
  })

  it('starts every step with the screen it is about', () => {
    view()

    // A step somebody cannot get to from the page it describes is a step they
    // have to go hunting for.
    const links = screen.getAllByRole('link', { name: /Obre la pantalla/ })
    expect(links.length).toBeGreaterThan(0)
  })
})
