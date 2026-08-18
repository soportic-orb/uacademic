import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InstallPage } from '../src/pages/install'

function routes(handlers: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const key = Object.keys(handlers).find((path) => url.includes(path))
    const body = key ? handlers[key] : {}

    return {
      ok: true,
      status: 200,
      json: async () => (typeof body === 'function' ? body(init) : body),
    } as Response
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('the installer', () => {
  it('says so plainly when the platform is already installed', async () => {
    vi.stubGlobal('fetch', routes({ '/install/status': { installed: true, tokenReady: false } }))

    render(<InstallPage />)

    expect(await screen.findByText('Ja està instal·lada')).toBeInTheDocument()
    // And offers no form at all: reinstalling is not a thing.
    expect(screen.queryByRole('button', { name: 'Instal·la' })).not.toBeInTheDocument()
  })

  it('asks for the token first, and will not move on without one', async () => {
    vi.stubGlobal('fetch', routes({ '/install/status': { installed: false, tokenReady: true } }))

    render(<InstallPage />)

    expect(await screen.findByText('Testimoni d’instal·lació')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Següent' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Testimoni'), 'a'.repeat(32))
    expect(screen.getByRole('button', { name: 'Següent' })).toBeEnabled()
  })

  it('refuses to go past a database it has not connected to', async () => {
    vi.stubGlobal(
      'fetch',
      routes({
        '/install/status': { installed: false, tokenReady: true },
        '/install/database': { ok: false, errorKey: 'installer.errors.databaseAccess' },
      }),
    )

    render(<InstallPage />)
    await userEvent.type(await screen.findByLabelText('Testimoni'), 'a'.repeat(32))
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))

    await userEvent.type(screen.getByLabelText('Nom de la base de dades'), 'uacademic')
    await userEvent.type(screen.getByLabelText('Usuari'), 'uacademic')
    await userEvent.click(screen.getByRole('button', { name: 'Prova la connexió' }))

    // The driver's own answer, in the reader's language — in the banner and
    // next to the field it belongs to.
    expect(
      (await screen.findAllByText(/no són correctes, o l’usuari no té permisos/)).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Següent' })).toBeDisabled()
  })

  it('warns about a database that is not utf8mb4 without blocking it', async () => {
    vi.stubGlobal(
      'fetch',
      routes({
        '/install/status': { installed: false, tokenReady: true },
        '/install/database': {
          ok: true,
          charset: 'latin1',
          collation: 'latin1_swedish_ci',
          hasTables: false,
        },
      }),
    )

    render(<InstallPage />)
    await userEvent.type(await screen.findByLabelText('Testimoni'), 'a'.repeat(32))
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))
    await userEvent.click(screen.getByRole('button', { name: 'Prova la connexió' }))

    expect(await screen.findByText(/joc de caràcters recomanat és utf8mb4/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Següent' })).toBeEnabled())
  })

  it('never sends a password the person typed only once', async () => {
    const fetchMock = routes({
      '/install/status': { installed: false, tokenReady: true },
      '/install/database': { ok: true, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' },
      '/install/run': { ok: true, steps: [] },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<InstallPage />)
    await userEvent.type(await screen.findByLabelText('Testimoni'), 'a'.repeat(32))
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))
    await userEvent.click(screen.getByRole('button', { name: 'Prova la connexió' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Següent' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))

    await userEvent.type(screen.getByLabelText('Universitat'), 'Universitat de Prova')
    await userEvent.type(screen.getByLabelText('Centre'), 'Facultat de Prova')
    await userEvent.type(screen.getByLabelText('Codi del centre'), 'FPT')
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))

    await userEvent.type(screen.getByLabelText('Nom'), 'Aina')
    await userEvent.type(screen.getByLabelText('Cognoms'), 'Prova')
    await userEvent.type(screen.getByLabelText('Correu electrònic'), 'admin@uacademic.cat')
    await userEvent.type(screen.getByLabelText('Contrasenya'), 'una-contrasenya-llarga')
    await userEvent.type(screen.getByLabelText('Repeteix la contrasenya'), 'una-altra-diferent')
    await userEvent.click(screen.getByRole('button', { name: 'Instal·la' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Les contrasenyes no coincideixen')
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/install/run'))).toBe(
      false,
    )
  })

  it('ends by telling the operator to restart the API', async () => {
    vi.stubGlobal(
      'fetch',
      routes({
        '/install/status': { installed: false, tokenReady: true },
        '/install/database': { ok: true, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' },
        '/install/run': {
          ok: true,
          envFile: '/var/www/uacademic/shared/.env',
          steps: [
            { key: 'database', ok: true },
            { key: 'migrations', ok: true },
            { key: 'organisation', ok: true },
            { key: 'configuration', ok: true },
          ],
        },
      }),
    )

    render(<InstallPage />)
    await userEvent.type(await screen.findByLabelText('Testimoni'), 'a'.repeat(32))
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))
    await userEvent.click(screen.getByRole('button', { name: 'Prova la connexió' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Següent' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))

    await userEvent.type(screen.getByLabelText('Universitat'), 'Universitat de Prova')
    await userEvent.type(screen.getByLabelText('Centre'), 'Facultat de Prova')
    await userEvent.type(screen.getByLabelText('Codi del centre'), 'FPT')
    await userEvent.click(screen.getByRole('button', { name: 'Següent' }))

    await userEvent.type(screen.getByLabelText('Nom'), 'Aina')
    await userEvent.type(screen.getByLabelText('Cognoms'), 'Prova')
    await userEvent.type(screen.getByLabelText('Correu electrònic'), 'admin@uacademic.cat')
    await userEvent.type(screen.getByLabelText('Contrasenya'), 'una-contrasenya-llarga')
    await userEvent.type(screen.getByLabelText('Repeteix la contrasenya'), 'una-contrasenya-llarga')
    await userEvent.click(screen.getByRole('button', { name: 'Instal·la' }))

    expect(await screen.findByText('pm2 restart uacademic')).toBeInTheDocument()
    expect(screen.getByText(/Configuració escrita a/)).toBeInTheDocument()
  })
})
