/**
 * Starting a reading, and picking up one already made.
 *
 * Only an indexed regulation can be read: the quotes are checked against the
 * indexed text, so a document the platform has not read itself cannot be cited
 * from.
 */
import { FileText, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { useDocuments } from '../documents/queries'
import { currentLocale } from '../../i18n'
import { formatDate } from '@uacademic/shared'
import { useExtractionRuns, useStartExtraction } from './queries'

export interface ExtractionCardProps {
  onOpenRun: (runId: string) => void
}

export function ExtractionCard({ onOpenRun }: ExtractionCardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const documents = useDocuments({ type: 'regulation', validity: 'current' })
  const runs = useExtractionRuns()
  const start = useStartExtraction()
  const [documentId, setDocumentId] = useState('')

  const readable = (documents.data?.items ?? []).filter((entry) => entry.status === 'indexed')

  return (
    <Card>
      <CardHeader
        title={t('settings.extraction.title')}
        description={t('settings.extraction.subtitle')}
      />

      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('settings.extraction.startHint')}</span>
            <select
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              className="h-10 min-w-72 rounded-control border border-border bg-surface px-2 text-text"
            >
              <option value="">{t('common.none')}</option>
              {readable.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>

          <Button
            disabled={!documentId || start.isPending}
            onClick={() =>
              start.mutate(documentId, {
                onSuccess: (result) => {
                  toast.success('settings.extraction.started')
                  onOpenRun(result.runId)
                },
                onError: (error) => {
                  if (error instanceof ApiRequestError) {
                    const key = error.details[0]?.messageKey
                    if (key) toast.error(key)
                    else toast.raw({ variant: 'error', message: error.localizedMessage })
                  } else toast.error('errors.generic')
                },
              })
            }
          >
            <Wand2 className="size-4" aria-hidden="true" />
            {t('settings.extraction.start')}
          </Button>
        </div>

        {runs.isPending ? (
          <CardSkeleton />
        ) : runs.isError ? (
          <ErrorState onRetry={() => void runs.refetch()} />
        ) : runs.data.items.length === 0 ? (
          <p className="text-sm text-text-muted">{t('settings.extraction.noRuns')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.data.items.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 text-sm text-text">
                  <FileText className="size-4 text-text-muted" aria-hidden="true" />
                  {run.documentTitle}
                  <span className="text-xs text-text-muted">
                    {formatDate(locale, new Date(run.createdAt))}
                  </span>
                  {run.appliedAt ? (
                    <span className="rounded-control border border-success/30 bg-success/10 px-2 py-0.5 text-xs text-success">
                      {t('settings.extraction.applied')}
                    </span>
                  ) : null}
                </span>

                <Button variant="ghost" size="sm" onClick={() => onOpenRun(run.id)}>
                  {t('common.edit')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
