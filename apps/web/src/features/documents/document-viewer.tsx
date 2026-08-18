/**
 * The viewer: the document as the assistant reads it, with the cited fragment
 * highlighted and scrolled to.
 *
 * It shows the indexed text rather than the original file, because that is
 * what an answer actually rested on — and a citation that opens a 90-page PDF
 * at page one is not a citation. The original is one click away for anybody
 * who wants to check the formatting.
 */
import { ExternalLink, FileText } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiDownload } from '../../lib/api'
import { useDocument } from './queries'

export interface DocumentViewerProps {
  documentId: string
  /** The fragment an answer cited, highlighted and scrolled into view. */
  chunkId?: string | null
  page?: number | null
}

export function DocumentViewer({ documentId, chunkId, page }: DocumentViewerProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useDocument(documentId)
  const highlighted = useRef<HTMLLIElement>(null)

  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: 'center' })
  }, [query.data, chunkId, page])

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const document = query.data

  const open = async () => {
    try {
      const blob = await apiDownload(`/api/v1/documents/${documentId}/file`)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // Revoked on the next tick: the new tab has already taken its copy.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    }
  }

  return (
    <Card>
      <CardHeader
        title={document.title}
        description={`${t(`documents.scope.${document.scope}`)} · ${t(
          `documents.type.${document.type}`,
        )}`}
        action={
          <button
            type="button"
            onClick={() => void open()}
            className="inline-flex items-center gap-2 text-sm text-primary underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('documents.viewer.openFile')}
          </button>
        }
      />

      <CardBody>
        {document.chunks.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <FileText className="size-4" aria-hidden="true" />
            {document.errorKey
              ? t(`documents.errors.${document.errorKey}`)
              : t(`documents.status.${document.status}`)}
          </p>
        ) : (
          <ul className="max-h-[32rem] space-y-3 overflow-y-auto">
            {document.chunks.map((chunk) => {
              const cited =
                (chunkId && chunk.id === chunkId) ||
                (!chunkId && page !== null && page !== undefined && chunk.pageFrom === page)

              return (
                <li
                  key={chunk.id}
                  ref={cited ? highlighted : undefined}
                  aria-current={cited ? 'true' : undefined}
                  className={`rounded-control border p-3 ${
                    cited
                      ? 'border-primary bg-primary-50 dark:bg-primary-900/30'
                      : 'border-border bg-surface'
                  }`}
                >
                  <p className="text-xs text-text-muted">
                    {[
                      chunk.headingPath,
                      chunk.pageFrom ? `p. ${chunk.pageFrom}` : null,
                      cited ? t('documents.viewer.fragment') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text">{chunk.content}</p>
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
