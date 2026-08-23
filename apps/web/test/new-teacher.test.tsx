/**
 * What a brand-new lecturer sees.
 *
 * An account is created and the contract is written later — often months
 * later. Between the two, this person can sign in, and every screen they open
 * has to behave. Two of them did not: the load screen raised "you do not have
 * permission", for a request the interface made on their behalf and threw
 * away, and their own card reported a fault for a contract that simply is not
 * there yet.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '../src/app/providers'
import { Toaster } from '../src/components/feedback/toaster'
import { AssistantLauncher } from '../src/features/assistant/assistant-launcher'
import { MyLoadPage } from '../src/pages/my-load'
import { useSessionStore } from '../src/stores/session'

/** Every URL the screen asks for, so an unasked-for 403 is visible. */
const requested: string[] = []

function respond(url: string) {
  if (url.includes('/ai/status')) {
    return {
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: 'FORBIDDEN',
          messageKey: 'errors.forbidden',
          message: 'No tens permisos per fer aquesta acció.',
        },
      }),
    } as Response
  }

  // No contract for the year in force: the profile does not exist yet.
  return {
    ok: false,
    status: 404,
    json: async () => ({
      error: {
        code: 'NOT_FOUND',
        messageKey: 'errors.notFound',
        message: 'No hem trobat el recurs.',
      },
    }),
  } as Response
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1', activeRole: 'TEACHER' })
  requested.length = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)
      return respond(url)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function view(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {children}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

vi.mock('../src/app/use-roles', () => ({ useRoles: () => ['TEACHER'] }))

describe('a lecturer with no contract yet', () => {
  it('explains the load screen rather than reporting a fault', async () => {
    view(<MyLoadPage />)

    expect(
      await screen.findByText('Encara no tens contracte per a aquest curs'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Torna-ho a provar' })).not.toBeInTheDocument()
  })

  it('never asks for the coordination assistant it cannot have', async () => {
    view(<AssistantLauncher />)

    // The role check used to happen after the request had already gone out.
    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(0))
    expect(requested.some((url) => url.includes('/ai/status'))).toBe(false)
  })

  it('draws no assistant button for somebody who does not coordinate', () => {
    view(<AssistantLauncher />)

    expect(screen.queryByRole('button', { name: /assistent/i })).not.toBeInTheDocument()
  })
})

describe('the toast a failed read raises', () => {
  it('says nothing when a read simply found nothing', async () => {
    // The screen is already saying why it is empty; "we could not find the
    // resource" on top of that reads as a fault and is duplicate.
    render(
      <AppProviders>
        <MemoryRouter>
          <MyLoadPage />
        </MemoryRouter>
      </AppProviders>,
    )

    await screen.findByText('Encara no tens contracte per a aquest curs')
    expect(screen.queryByText('No hem trobat el recurs.')).not.toBeInTheDocument()
  })
})
