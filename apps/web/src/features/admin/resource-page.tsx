import type { ListResult } from '@uacademic/shared'
import { formatDate, formatNumber } from '@uacademic/shared'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthConfig } from '../../auth/config'
import { adminConsentUrl } from '../../auth/consent'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody } from '../../components/ui/card'
import { ColumnPicker } from '../../components/ui/column-picker'
import { useColumnVisibility } from '../../hooks/use-columns'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiFetch, apiJson, apiUpload } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { ResourceConfig } from './resource-config'
import { type ImageIntent, ResourceForm } from './resource-form'

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
  // Only the tenants table uses it, and only to name the application in a link.
  const entraClientId = useAuthConfig().data?.entra?.clientId ?? null

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<{ column: string; order: 'asc' | 'desc' } | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)

  /**
   * Lists that belong to the center rather than to the platform — the kinds of
   * day a calendar is made of, which a center may add to. The table and the
   * filter read the same list the form offers, so a type somebody created is
   * named everywhere rather than showing as its raw key.
   */
  const lookupPaths = [
    ...new Set(
      [
        ...resource.columns.map((column) => column.optionsFrom),
        ...(resource.filters ?? []).map((filter) => filter.optionsFrom),
      ]
        .filter((source): source is { path: string; labelField: string } => Boolean(source))
        .map((source) => source.path),
    ),
  ]

  const lookupQueries = useQueries({
    queries: lookupPaths.map((path) => ({
      queryKey: ['admin-options', path],
      queryFn: () => apiFetch<ListResult<Record<string, unknown>>>(`/api/v1/${path}?pageSize=100`),
      staleTime: 60_000,
    })),
  })

  /**
   * The columns this person keeps. Every admin listing is drawn from the same
   * description, so they all get the control for free.
   */
  const columns = useColumnVisibility(
    `admin:${resource.key}`,
    resource.columns.map((column) => ({ key: column.key, label: t(column.labelKey) })),
  )
  const shown = resource.columns.filter((column) => columns.shows(column.key))

  const lookupOptions = (source: { path: string; labelField: string }) => {
    const rows = lookupQueries[lookupPaths.indexOf(source.path)]?.data?.items ?? []
    return rows.map((item) => ({
      value: String(item.id),
      label: String(item[source.labelField] ?? item.id),
    }))
  }

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
    mutationFn: async (payload: {
      id?: string
      values: Record<string, unknown>
      images: ImageIntent
    }) => {
      const row = payload.id
        ? await apiJson<Row>(`/api/v1/${resource.path}/${payload.id}`, 'PATCH', payload.values)
        : await apiJson<Row>(`/api/v1/${resource.path}`, 'POST', payload.values)

      // Pictures go after the row, never before it: they are stored under the
      // id, and on a create that id does not exist until this point.
      const id = payload.id ?? String(row.id ?? '')
      for (const field of resource.fields) {
        if (!field.upload || !id) continue

        const file = payload.images.files[field.name]
        if (file) {
          const form = new FormData()
          form.append('file', file)
          await apiUpload(`/api/v1/${resource.path}/${id}/${field.upload}`, form)
        } else if (payload.images.removals.includes(field.name)) {
          await apiFetch(`/api/v1/${resource.path}/${id}/${field.upload}`, { method: 'DELETE' })
        }
      }

      return row
    },
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
    /*
      Not a field of the row: a link built from it. A multi-tenant application
      exists only in the tenant it was registered in, so until an administrator
      of *this* organisation installs it, Microsoft refuses everyone here with
      AADSTS500011 and shows no consent prompt to click — there is no resource
      in that tenant to prompt about. This is the link that fixes it, and the
      superadmin registering the tenant is exactly who has to send it on.
    */
    if (column.render === 'entraConsent') {
      const tenantId = row.tenantId
      if (!entraClientId || typeof tenantId !== 'string' || !tenantId) return '—'

      return (
        <a
          href={adminConsentUrl({
            clientId: entraClientId,
            tenantId,
            origin: window.location.origin,
          })}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary-600"
        >
          {t('admin.grantConsent')}
        </a>
      )
    }

    const value = row[column.key]

    // The code alone identifies a subject only to somebody who has the
    // catalogue memorised; the name alone is ambiguous between two years of
    // the same one. Both, together, are what a person reads.
    if (column.render === 'nameWithCode') {
      const code = column.codeKey ? row[column.codeKey] : undefined
      if (!value && !code) return '—'
      if (!code) return String(value)
      if (!value) return String(code)
      return `${String(value)} (${String(code)})`
    }

    if (value === null || value === undefined || value === '') return '—'

    switch (column.render) {
      case 'enum':
        return t(`${column.enumPrefix}.${String(value)}`)
      case 'lookup': {
        if (!column.optionsFrom) return String(value)
        const match = lookupOptions(column.optionsFrom).find(
          (option) => option.value === String(value),
        )
        // Until the list arrives — and for a value it does not contain — the
        // key itself is the honest thing to show.
        return match?.label ?? String(value)
      }
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
                  <option value="">{t('common.all')}</option>
                  {filter.optionsFrom
                    ? lookupOptions(filter.optionsFrom).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))
                    : (filter.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      ))}
                </select>
              </label>
            ))}

            <ColumnPicker columns={columns} />
          </div>

          {query.isPending ? (
            <TableSkeleton rows={6} columns={shown.length + 1} />
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
                      {shown.map((column) => (
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
                        {shown.map((column) => (
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
          onSubmit={(values, images) =>
            save.mutateAsync({
              ...(editing === 'new' ? {} : { id: String(editing.id) }),
              values,
              images,
            })
          }
        />
      ) : null}
    </div>
  )
}
