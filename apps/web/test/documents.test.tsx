import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { SourceChips } from '../src/features/assistant/source-chips'
import { DocumentViewer } from '../src/features/documents/document-viewer'
import { OcrDialog } from '../src/features/documents/ocr-dialog'
import type { DocumentDto } from '../src/features/documents/queries'
import { UploadForm } from '../src/features/documents/upload-form'
import { useSessionStore } from '../src/stores/session'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {children}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** Routes a stubbed `fetch` by path. */
function router(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => routes[match] } as Response
  })
}

function documentDto(overrides: Partial<DocumentDto> = {}): DocumentDto {
  return {
    id: 'doc-1',
    title: 'Normativa POD 2026-27',
    scope: 'center',
    scopeId: null,
    type: 'regulation',
    status: 'indexed',
    errorKey: null,
    errorDetail: null,
    language: 'ca',
    visibility: 'ai_only',
    academicYearId: null,
    validFrom: '2026-09-01T00:00:00.000Z',
    validTo: '2027-08-31T00:00:00.000Z',
    sizeBytes: 120_000,
    mime: 'application/pdf',
    pageCount: 20,
    chunkCount: 8,
    tokenCount: 4_000,
    extractedWith: 'pdf',
    createdAt: '2026-08-18T10:00:00.000Z',
    processedAt: '2026-08-18T10:01:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  useSessionStore.setState({ centerId: 'center-1' })
})

afterEach(() => vi.unstubAllGlobals())

describe('uploading a document', () => {
  it('warns about student data before asking for anything else', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<UploadForm subjects={[]} degrees={[]} academicYears={[]} onUploaded={() => {}} />))

    expect(screen.getByText(/No pugis llistats d’alumnes/)).toBeInTheDocument()
  })

  it('asks for the validity window, because an old plan must not answer for a new year', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<UploadForm subjects={[]} degrees={[]} academicYears={[]} onUploaded={() => {}} />))

    const from = screen.getByLabelText('Vigent des de')
    const to = screen.getByLabelText('Vigent fins a')
    expect(from).toBeRequired()
    expect(to).toBeRequired()
  })

  it('offers only assistant-only or repository, never a public address', () => {
    vi.stubGlobal('fetch', router({}))

    render(wrap(<UploadForm subjects={[]} degrees={[]} academicYears={[]} onUploaded={() => {}} />))

    const visibility = screen.getByLabelText('Visibilitat')
    expect(
      within(visibility)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Només per a l’assistent', 'Visible també per al professorat'])
  })
})

describe('the viewer', () => {
  const detail = {
    ...documentDto(),
    chunks: [
      {
        id: 'chunk-1',
        ordinal: 0,
        headingPath: '1. Dedicació',
        pageFrom: 3,
        pageTo: 3,
        content: 'El professorat a temps complet imparteix 240 hores.',
      },
      {
        id: 'chunk-2',
        ordinal: 1,
        headingPath: '2. Reduccions',
        pageFrom: 5,
        pageTo: 5,
        content: 'La coordinació de titulació dona dret a 60 hores.',
      },
    ],
  }

  it('marks the fragment the answer rested on, and only that one', async () => {
    vi.stubGlobal('fetch', router({ '/api/v1/documents/doc-1': detail }))

    render(wrap(<DocumentViewer documentId="doc-1" chunkId="chunk-2" />))

    const cited = await screen.findByText(/60 hores/)
    expect(cited.closest('li')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText(/240 hores/).closest('li')).not.toHaveAttribute('aria-current')
  })

  it('says what went wrong in words when there is nothing indexed to show', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/api/v1/documents/doc-1': {
          ...documentDto({ status: 'failed', errorKey: 'needsOcr' }),
          chunks: [],
        },
      }),
    )

    render(wrap(<DocumentViewer documentId="doc-1" />))

    expect(await screen.findByText(/cal llegir-lo amb la IA/)).toBeInTheDocument()
  })
})

describe('reading a scanned document with the model', () => {
  it('puts the cost on the screen before the question', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/ocr-estimate': {
          pages: 32,
          estimatedTokens: 80_000,
          tooLong: false,
          allowed: true,
          maxPages: 40,
        },
      }),
    )

    render(
      wrap(
        <OcrDialog
          documentId="doc-1"
          title="Conveni escanejat"
          onClose={() => {}}
          onConfirm={() => {}}
        />,
      ),
    )

    expect(await screen.findByText(/32 pàgines/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Llegeix-lo i indexa’l' })).toBeEnabled()
  })

  it('does not offer to spend anything when the center switched it off', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        '/ocr-estimate': {
          pages: 32,
          estimatedTokens: 80_000,
          tooLong: false,
          allowed: false,
          maxPages: 40,
        },
      }),
    )

    render(
      wrap(
        <OcrDialog documentId="doc-1" title="Conveni" onClose={() => {}} onConfirm={() => {}} />,
      ),
    )

    expect(await screen.findByText(/lectura amb IA està desactivada/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Llegeix-lo i indexa’l' })).toBeDisabled(),
    )
  })

  it('is dismissed with Escape, like every other dialog', async () => {
    vi.stubGlobal('fetch', router({}))
    const onClose = vi.fn()

    render(
      wrap(<OcrDialog documentId="doc-1" title="Conveni" onClose={onClose} onConfirm={() => {}} />),
    )

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('the sources of an answer', () => {
  it('links each citation to the fragment it came from', () => {
    render(
      wrap(
        <SourceChips
          documents={[{ documentId: 'doc-1', title: 'Normativa POD', scope: 'center' }]}
          citations={[
            {
              documentId: 'doc-1',
              title: 'Normativa POD',
              page: 14,
              section: null,
              chunkId: 'chunk-9',
            },
          ]}
        />,
      ),
    )

    const link = screen.getByRole('link', { name: /Normativa POD, p. 14/ })
    expect(link).toHaveAttribute('href', '/documents?doc=doc-1&page=14&chunk=chunk-9')
  })

  it('still names a document that was read but never cited', () => {
    render(
      wrap(
        <SourceChips
          documents={[{ documentId: 'doc-2', title: 'Criteris del centre', scope: 'center' }]}
          citations={[]}
        />,
      ),
    )

    expect(screen.getByRole('link', { name: /Criteris del centre/ })).toHaveAttribute(
      'href',
      '/documents?doc=doc-2',
    )
  })

  it('shows nothing at all when no document fed the answer', () => {
    const { container } = render(wrap(<SourceChips documents={[]} citations={[]} />))
    expect(container).not.toHaveTextContent('Fonts consultades')
  })
})
