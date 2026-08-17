import type { ListResult } from '@uacademic/shared'
import { formatDate, formatNumber } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { ResourceConfig } from './resource-config'
import { ResourceForm } from './resource-form'

type Row = Record<string, unknown>

/**
 * The table every admin resource gets: search, filters, sorting and pagination
 * all resolved on the server, so a center with 4 000 subjects behaves like one
 * with 8.
 */
export function ResourcePage({ resource }: { resource: ResourceConfig }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const locale = currentLocale()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<{ column: string; order: 'asc' | 'desc' } | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search.trim()) params.set('q', search.trim())
    if (sort) {
      params.set('sort', sort.column)
      params.set('order', sort.order)
    }
    for (const [name, value] of Object.entries(filters)) {
      if (value) params.set(name, value)
    }
    return params.toString()
  }, [page, pageSize, search, sort, filters])

  const listKey = ['admin-resource', resource.key, queryString]

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => apiFetch<ListResult<Row>>(`/api/v1/${resource.path}?${queryString}`),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/${resource.path}/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('admin.deleted')
      await queryClient.invalidateQueries({ queryKey: ['admin-resource', resource.key] })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  const save = useMutation({
    mutationFn: async (payload: { id?: string; values: Record<string, unknown> }) =>
      payload.id
        ? apiJson(`/api/v1/${resource.path}/${payload.id}`, 'PATCH', payload.values)
        : apiJson(`/api/v1/${resource.path}`, 'POST', payload.values),
    onSuccess: async (_result, payload) => {
      toast.success(payload.id ? 'admin.updated' : 'admin.created')
      setEditing(null)
      await queryClient.invalidateQueries({ queryKey: ['admin-resource', resource.key] })
    },
  })

  const toggleSort = (column: string) => {
    setPage(1)
    setSort((current) =>
      current?.column === column
        ? { column, order: current.order === 'asc' ? 'desc' : 'asc' }
        : { column, order: 'asc' },
    )
  }

  const renderCell = (row: Row, column: ResourceConfig['columns'][number]) => {
    const value = row[column.key]
    if (value === null || value === undefined || value === '') return '—'

    switch (column.render) {
      case 'enum':
        return t(`${column.enumPrefix}.${String(value)}`)
      case 'date':
        return formatDate(locale, new Date(String(value)))
      case 'number':
        return formatNumber(locale, Number(value))
      case 'boolean':
        return value ? t('common.yes') : t('common.no')
      default:
        return String(value)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t(resource.titleKey)}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('admin.title')}</p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden="true" />
          {t('admin.create')}
        </Button>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1">
              <span className="sr-only">{t('common.search')}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder={t('admin.searchPlaceholder')}
                className="h-10 w-full min-w-48 rounded-control border border-border bg-surface px-3 text-sm text-text"
              />
            </label>

            {(resource.filters ?? []).map((filter) => (
              <label key={filter.name}>
                <span className="mb-1 block text-xs text-text-muted">{t(filter.labelKey)}</span>
                <select
                  value={filters[filter.name] ?? ''}
                  onChange={(event) => {
                    setFilters({ ...filters, [filter.name]: event.target.value })
                    setPage(1)
                  }}
                  className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
                >
                  <option value="">{t('common.optional')}</option>
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {query.isPending ? (
            <TableSkeleton rows={6} columns={resource.columns.length + 1} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : query.data.items.length === 0 ? (
            <EmptyState
              title={
                search || Object.values(filters).some(Boolean)
                  ? t('admin.noResults')
                  : t('states.emptyDefaultTitle')
              }
              actionLabel={t('admin.create')}
              onAction={() => setEditing('new')}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t(resource.titleKey)}</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      {resource.columns.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          className={cn(
                            'py-2 pr-4 font-medium',
                            column.align === 'right' && 'text-right',
                          )}
                        >
                          {column.sortable ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(column.key)}
                              aria-label={t('admin.sortBy', { column: t(column.labelKey) })}
                              className="inline-flex items-center gap-1 hover:text-text"
                            >
                              {t(column.labelKey)}
                              {sort?.column === column.key ? (
                                sort.order === 'asc' ? (
                                  <ArrowUp className="size-3" aria-hidden="true" />
                                ) : (
                                  <ArrowDown className="size-3" aria-hidden="true" />
                                )
                              ) : null}
                            </button>
                          ) : (
                            t(column.labelKey)
                          )}
                        </th>
                      ))}
                      <th scope="col" className="py-2 text-right font-medium">
                        {t('admin.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((row) => (
                      <tr key={String(row.id)} className="border-b border-border/60">
                        {resource.columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'py-3 pr-4 text-text',
                              column.align === 'right' && 'tabular text-right',
                            )}
                          >
                            {renderCell(row, column)}
                          </td>
                        ))}
                        <td className="py-3 text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('admin.edit')}
                              onClick={() => setEditing(row)}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('admin.delete')}
                              onClick={() => {
                                const name = String(row[resource.labelField] ?? '')
                                if (window.confirm(t('admin.deleteConfirm', { name }))) {
                                  remove.mutate(String(row.id))
                                }
                              }}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
                <label className="flex items-center gap-2">
                  {t('admin.rowsPerPage')}
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value))
                      setPage(1)
                    }}
                    className="h-9 rounded-control border border-border bg-surface px-2 text-sm text-text"
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-center gap-3">
                  <span className="tabular">
                    {t('admin.pageOf', {
                      page: query.data.page,
                      total: Math.max(query.data.totalPages, 1),
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={query.data.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    {t('admin.previousPage')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={query.data.page >= query.data.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t('admin.nextPage')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {editing ? (
        <ResourceForm
          resource={resource}
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={(values) =>
            save.mutateAsync({
              ...(editing === 'new' ? {} : { id: String(editing.id) }),
              values,
            })
          }
        />
      ) : null}
    </div>
  )
}
