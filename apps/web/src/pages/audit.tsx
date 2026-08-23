/**
 * The audit viewer (R4): what changed, who changed it, and whether it was a
 * person, the assistant or the system that did it.
 *
 * The log is append-only, so this screen only ever reads. The entity filter is
 * built from what the center has actually recorded rather than a hardcoded
 * list that drifts as the product grows.
 */
import { formatDate } from '@uacademic/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, TableSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { type AuditQuery, useAudit } from '../features/collaboration/queries'
import { ColumnPicker } from '../components/ui/column-picker'
import { useColumnVisibility } from '../hooks/use-columns'
import { currentLocale } from '../i18n'

const SOURCES = ['user', 'ai', 'system'] as const

function Payload({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null

  return (
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <pre className="mt-1 max-h-40 overflow-auto rounded-control bg-surface-muted p-2 text-xs text-text">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

export function AuditPage() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const [filters, setFilters] = useState<AuditQuery>({ page: 1 })
  const [expanded, setExpanded] = useState<string | null>(null)

  /** The log is wide, and what somebody is auditing is usually two of these. */
  const columns = useColumnVisibility('audit', [
    { key: 'entity', label: t('audit.entity') },
    { key: 'action', label: t('audit.action') },
    { key: 'user', label: t('audit.user') },
    { key: 'source', label: t('audit.source') },
  ])
  const query = useAudit(filters)

  const set = (patch: Partial<AuditQuery>) =>
    setFilters((current) => ({ ...current, ...patch, page: 1 }))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('audit.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('audit.subtitle')}</p>
      </header>

      <Card>
        <CardHeader title={t('common.filters')} />
        <CardBody className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('audit.entity')}</span>
            <select
              value={filters.entity ?? ''}
              onChange={(event) => set({ entity: event.target.value || undefined })}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              <option value="">{t('common.all')}</option>
              {(query.data?.entities ?? []).map((entity) => (
                <option key={entity.entity} value={entity.entity}>
                  {`${entity.entity} (${entity.count})`}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('audit.source')}</span>
            <select
              value={filters.source ?? ''}
              onChange={(event) => set({ source: event.target.value || undefined })}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              <option value="">{t('common.all')}</option>
              {SOURCES.map((source) => (
                <option key={source} value={source}>
                  {t(`audit.sources.${source}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('audit.from')}</span>
            <input
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => set({ from: event.target.value || undefined })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('audit.to')}</span>
            <input
              type="date"
              value={filters.to ?? ''}
              min={filters.from ?? undefined}
              onChange={(event) => set({ to: event.target.value || undefined })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('audit.title')} />
        <CardBody className="overflow-x-auto">
          <div className="mb-3 flex justify-end">
            <ColumnPicker columns={columns} />
          </div>

          {query.isPending ? <TableSkeleton rows={6} columns={5} /> : null}
          {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : null}
          {query.data && query.data.items.length === 0 ? (
            <EmptyState title={t('audit.empty')} />
          ) : null}

          {query.data && query.data.items.length > 0 ? (
            <>
              <table className="w-full min-w-[48rem] text-sm">
                <caption className="sr-only">{t('audit.title')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('audit.date')}
                    </th>
                    {columns.shows('entity') ? (
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('audit.entity')}
                      </th>
                    ) : null}
                    {columns.shows('action') ? (
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('audit.action')}
                      </th>
                    ) : null}
                    {columns.shows('user') ? (
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('audit.user')}
                      </th>
                    ) : null}
                    {columns.shows('source') ? (
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('audit.source')}
                      </th>
                    ) : null}
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('audit.details')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((entry) => (
                    <tr key={entry.id} className="border-b border-border align-top last:border-b-0">
                      <td className="tabular py-3 pr-4 text-text-muted">
                        {formatDate(locale, new Date(entry.createdAt), {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      {columns.shows('entity') ? (
                        <td className="px-3 py-3 text-text">{entry.entity}</td>
                      ) : null}
                      {columns.shows('action') ? (
                        <td className="px-3 py-3 text-text">{entry.action}</td>
                      ) : null}
                      {columns.shows('user') ? (
                        <td className="px-3 py-3 text-text-muted">
                          {entry.userName ?? t('common.none')}
                        </td>
                      ) : null}
                      {columns.shows('source') ? (
                        <td className="px-3 py-3 text-text-muted">
                          {t(`audit.sources.${entry.source}`)}
                        </td>
                      ) : null}
                      <td className="px-3 py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={expanded === entry.id}
                          onClick={() =>
                            setExpanded((current) => (current === entry.id ? null : entry.id))
                          }
                        >
                          {t('audit.details')}
                        </Button>
                        {expanded === entry.id ? (
                          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                            <Payload label={t('audit.before')} value={entry.before} />
                            <Payload label={t('audit.after')} value={entry.after} />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 flex items-center justify-between">
                <p className="tabular text-sm text-text-muted">
                  {`${query.data.page} / ${query.data.totalPages} · ${query.data.total}`}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={query.data.page <= 1}
                    onClick={() =>
                      setFilters((current) => ({ ...current, page: (current.page ?? 1) - 1 }))
                    }
                  >
                    {t('common.back')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={query.data.page >= query.data.totalPages}
                    onClick={() =>
                      setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))
                    }
                  >
                    {t('common.next')}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
