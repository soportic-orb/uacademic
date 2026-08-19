/**
 * The document library.
 *
 * Two audiences share this screen. A coordinator or an administrator manages
 * what the assistant is allowed to read — and, above all, *until when*: a
 * teaching plan from 2024-25 that nobody retired keeps answering questions
 * about 2026-27, which is why validity is a filter and expiry is a badge
 * rather than a date buried in a detail pane.
 *
 * A teacher sees the same list minus everything filed as assistant-only,
 * because for them this is a repository, not a control panel.
 *
 * The viewer opens from a citation — `?doc=…&chunk=…` — so a source chip in an
 * answer lands on the exact fragment the answer rested on.
 */
import { type ListResult, MAX_PAGE_SIZE, formatBytes, formatDate } from '@uacademic/shared'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Clock, FileText, RefreshCw, ScanText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'

import { useRoles } from '../app/use-roles'
import { EmptyState, ErrorState, TableSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { DocumentViewer } from '../features/documents/document-viewer'
import { OcrDialog } from '../features/documents/ocr-dialog'
import {
  type DocumentDto,
  type DocumentFilters,
  useDeleteDocument,
  useDocuments,
  useReprocessDocument,
} from '../features/documents/queries'
import { UploadForm } from '../features/documents/upload-form'
import { useSubjects } from '../hooks/use-api'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError, apiFetch } from '../lib/api'
import { currentLocale } from '../i18n'

const SCOPES = ['university', 'center', 'degree', 'subject'] as const
const TYPES = ['regulation', 'teaching_plan', 'agreement', 'guide', 'minutes', 'other'] as const
const VALIDITIES = ['all', 'current', 'expired'] as const

const STATUS_STYLE: Record<DocumentDto['status'], string> = {
  uploaded: 'border-border bg-surface-muted text-text-muted',
  processing: 'border-primary/30 bg-primary-50 text-primary-700 dark:bg-primary-900/30',
  indexed: 'border-success/30 bg-success/10 text-success',
  failed: 'border-danger/30 bg-danger/10 text-danger',
  archived: 'border-border bg-surface-muted text-text-muted',
}

export function DocumentsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const roles = useRoles()
  const locale = currentLocale()
  const [params, setParams] = useSearchParams()

  const manages = roles.some((role) => ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR'].includes(role))
  const managesCenter = roles.some((role) => ['SUPERADMIN', 'CENTER_ADMIN'].includes(role))

  const [filters, setFilters] = useState<DocumentFilters>({ validity: 'all' })
  const [ocrFor, setOcrFor] = useState<DocumentDto | null>(null)

  const list = useDocuments(filters)
  const remove = useDeleteDocument()
  const reprocess = useReprocessDocument()
  const subjects = useSubjects()

  const years = useQuery({
    queryKey: ['document-years'],
    queryFn: () =>
      apiFetch<ListResult<{ id: string; name: string }>>(
        '/api/v1/admin/academic-years?pageSize=50',
      ),
    enabled: manages,
  })

  const degrees = useQuery({
    queryKey: ['document-degrees'],
    queryFn: () =>
      apiFetch<ListResult<{ id: string; code: string; nameCa: string }>>(
        `/api/v1/admin/degrees?pageSize=${MAX_PAGE_SIZE}`,
      ),
    enabled: managesCenter,
  })

  const selectedId = params.get('doc')
  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('doc', id)
    else {
      next.delete('doc')
      next.delete('chunk')
      next.delete('page')
    }
    setParams(next, { replace: true })
  }

  const fail = (error: unknown) => {
    if (error instanceof ApiRequestError) {
      const key = error.details[0]?.messageKey
      if (key) toast.error(key)
      else toast.raw({ variant: 'error', message: error.localizedMessage })
    } else {
      toast.error('errors.generic')
    }
  }

  const runReprocess = (document: DocumentDto, useOcr: boolean) => {
    reprocess.mutate(
      { id: document.id, useOcr },
      { onSuccess: () => toast.success('documents.reprocessed'), onError: fail },
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('documents.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('documents.subtitle')}</p>
      </header>

      {manages ? (
        <UploadForm
          subjects={(subjects.data?.items ?? []).map((subject) => ({
            id: subject.id,
            code: subject.code,
            name:
              locale === 'es' ? subject.nameEs : locale === 'en' ? subject.nameEn : subject.nameCa,
          }))}
          degrees={(degrees.data?.items ?? []).map((degree) => ({
            id: degree.id,
            code: degree.code,
            name: degree.nameCa,
          }))}
          academicYears={years.data?.items ?? []}
          onUploaded={() => void list.refetch()}
        />
      ) : null}

      <Card>
        <CardHeader
          title={t('documents.title')}
          description={
            list.data
              ? t('documents.quota', {
                  used: formatBytes(locale, list.data.quota.usedBytes),
                  total: formatBytes(locale, list.data.quota.quotaBytes),
                })
              : undefined
          }
        />

        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('documents.fields.scope')}</span>
              <select
                value={filters.scope ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, scope: event.target.value || undefined })
                }
                className="h-10 rounded-control border border-border bg-surface px-2 text-text"
              >
                <option value="">{t('common.all')}</option>
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {t(`documents.scope.${scope}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('documents.fields.type')}</span>
              <select
                value={filters.type ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, type: event.target.value || undefined })
                }
                className="h-10 rounded-control border border-border bg-surface px-2 text-text"
              >
                <option value="">{t('common.all')}</option>
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`documents.type.${type}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('documents.fields.validity')}</span>
              <select
                value={filters.validity ?? 'all'}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    validity: event.target.value as (typeof VALIDITIES)[number],
                  })
                }
                className="h-10 rounded-control border border-border bg-surface px-2 text-text"
              >
                {VALIDITIES.map((validity) => (
                  <option key={validity} value={validity}>
                    {t(`documents.validity.${validity}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('common.search')}</span>
              <input
                type="search"
                value={filters.q ?? ''}
                onChange={(event) => setFilters({ ...filters, q: event.target.value || undefined })}
                className="h-10 rounded-control border border-border bg-surface px-3 text-text"
              />
            </label>
          </div>

          {list.isPending ? (
            <TableSkeleton rows={5} columns={5} />
          ) : list.isError ? (
            <ErrorState onRetry={() => void list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <EmptyState title={t('documents.empty')} description={t('documents.noStudentData')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('documents.title')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('documents.fields.title')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('documents.fields.scope')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('documents.fields.validTo')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('documents.fields.status')}
                    </th>
                    <th scope="col" className="py-2 pl-4 text-right font-medium">
                      {t('documents.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((document) => (
                    <tr key={document.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          onClick={() => select(document.id)}
                          className="text-left font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {document.title}
                        </button>
                        <p className="text-xs text-text-muted">
                          {[
                            t(`documents.type.${document.type}`),
                            t(`documents.visibility.${document.visibility}`),
                            formatBytes(locale, document.sizeBytes),
                            document.uploadedBy,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </td>

                      <td className="py-3 pr-4 text-text-muted">
                        {t(`documents.scope.${document.scope}`)}
                      </td>

                      <td className="py-3 pr-4">
                        <span className="tabular-nums text-text-muted">
                          {document.validTo
                            ? formatDate(locale, new Date(document.validTo))
                            : t('common.none')}
                        </span>
                        {document.expired ? (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-control border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs text-danger">
                            <AlertTriangle className="size-3" aria-hidden="true" />
                            {t('documents.expired')}
                          </span>
                        ) : document.expiringSoon ? (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-control border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                            <Clock className="size-3" aria-hidden="true" />
                            {t('documents.expiringSoon')}
                          </span>
                        ) : null}
                      </td>

                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-xs ${STATUS_STYLE[document.status]}`}
                        >
                          <FileText className="size-3" aria-hidden="true" />
                          {t(`documents.status.${document.status}`)}
                        </span>
                        {document.errorKey ? (
                          <div className="mt-1 max-w-xs space-y-1">
                            <p className="text-xs text-danger">
                              {t(`documents.errors.${document.errorKey}`)}
                            </p>
                            {manages && document.errorDetail ? (
                              // What the parser actually said, for whoever can
                              // act on it. A person who uploaded a file that
                              // will not read needs the reason, not a guess.
                              <details className="text-xs text-text-muted">
                                <summary className="cursor-pointer">
                                  {t('documents.errorDetail')}
                                </summary>
                                <p className="mt-1 break-words font-mono">{document.errorDetail}</p>
                              </details>
                            ) : null}
                          </div>
                        ) : document.status === 'indexed' ? (
                          <p className="mt-1 text-xs text-text-muted">
                            {t('documents.fragments', { count: document.chunkCount ?? 0 })}
                          </p>
                        ) : null}
                      </td>

                      <td className="py-3 pl-4">
                        <div className="flex justify-end gap-1">
                          {manages ? (
                            <>
                              {document.errorKey === 'needsOcr' ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setOcrFor(document)}
                                >
                                  <ScanText className="size-4" aria-hidden="true" />
                                  {t('documents.runOcr')}
                                </Button>
                              ) : null}

                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t('documents.reprocess')}
                                title={t('documents.reprocess')}
                                onClick={() => runReprocess(document, false)}
                              >
                                <RefreshCw className="size-4" aria-hidden="true" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t('common.remove')}
                                title={t('common.remove')}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      t('documents.deleteConfirm', { title: document.title }),
                                    )
                                  )
                                    return

                                  remove.mutate(document.id, {
                                    onSuccess: () => {
                                      toast.success('documents.deleted')
                                      if (selectedId === document.id) select(null)
                                    },
                                    onError: fail,
                                  })
                                }}
                              >
                                <Trash2 className="size-4 text-danger" aria-hidden="true" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {selectedId ? (
        <DocumentViewer
          documentId={selectedId}
          chunkId={params.get('chunk')}
          page={params.get('page') ? Number(params.get('page')) : null}
        />
      ) : null}

      {ocrFor ? (
        <OcrDialog
          documentId={ocrFor.id}
          title={ocrFor.title}
          onClose={() => setOcrFor(null)}
          onConfirm={() => {
            runReprocess(ocrFor, true)
            setOcrFor(null)
          }}
        />
      ) : null}
    </div>
  )
}
