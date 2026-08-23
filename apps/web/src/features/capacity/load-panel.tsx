/**
 * The center load panel: every teacher, their capacity, their workload and the
 * traffic light, with filters by degree, category and load status.
 *
 * Filtering and sorting happen on the server so the Excel export can reuse the
 * exact same query string — the download is the table, not a second query that
 * drifts from it.
 */
import { formatHours, formatPercent, formatPersonName } from '@uacademic/shared'
import { ArrowDown, ArrowUp, Download, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useRoles } from '../../app/use-roles'
import { LoadBadge } from '../../components/data/load-badge'
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback/states'
import { Avatar } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Card, CardBody } from '../../components/ui/card'
import { ContractTeacher } from './contract-teacher'
import { ColumnPicker } from '../../components/ui/column-picker'
import { useColumnVisibility } from '../../hooks/use-columns'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiDownload } from '../../lib/api'
import { cn } from '../../lib/cn'
import { type LoadPanelFilters, loadQueryString, useCenterLoad } from './queries'

const SORTABLE = [
  { key: 'name', labelKey: 'teachers.name' },
  { key: 'capacity', labelKey: 'load.capacity' },
  { key: 'assigned', labelKey: 'load.assigned' },
  { key: 'ratio', labelKey: 'load.ratio' },
  { key: 'status', labelKey: 'teachers.status' },
] as const

export function LoadPanel() {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()

  /** The name always stays: a row of hours with nobody attached says nothing. */
  const columns = useColumnVisibility('teacher-load', [
    { key: 'capacity', label: t('load.capacity') },
    { key: 'assigned', label: t('load.assigned') },
    { key: 'ratio', label: t('load.ratio') },
    { key: 'status', label: t('teachers.status') },
    { key: 'category', label: t('teachers.category') },
  ])

  const [filters, setFilters] = useState<LoadPanelFilters>({ sort: 'name', order: 'asc' })
  const [exporting, setExporting] = useState(false)
  const [contracting, setContracting] = useState(false)
  const roles = useRoles()
  const canContract = roles.some((role) => role === 'CENTER_ADMIN' || role === 'COORDINATOR')
  const query = useCenterLoad(filters)

  const toggleSort = (key: string) =>
    setFilters((current) => ({
      ...current,
      sort: key,
      order: current.sort === key && current.order === 'asc' ? 'desc' : 'asc',
    }))

  const download = async () => {
    setExporting(true)
    try {
      const blob = await apiDownload(`/api/v1/teachers/load/export?${loadQueryString(filters)}`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'uacademic-load.xlsx'
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success('teachers.panel.exported')
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('teachers.panel.exportFailed')
    } finally {
      setExporting(false)
    }
  }

  const facets = query.data?.facets
  const hasFilters = Boolean(filters.degreeId ?? filters.category ?? filters.status ?? filters.q)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('teachers.panel.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('teachers.panel.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/*
            The screen listed contracts and offered no way to write one: a
            center could only add teaching staff by importing a spreadsheet.
          */}
          {canContract ? (
            <Button onClick={() => setContracting(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              {t('teachers.newTitle')}
            </Button>
          ) : null}

          <Button
            variant="secondary"
            onClick={() => void download()}
            disabled={exporting || !query.data}
          >
            <Download className="size-4" aria-hidden="true" />
            {exporting ? t('teachers.panel.exporting') : t('load.export')}
          </Button>
        </div>
      </header>

      {contracting ? <ContractTeacher onDone={() => setContracting(false)} /> : null}

      {query.data ? <LoadSummary summary={query.data.summary} /> : null}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1">
              <span className="sr-only">{t('teachers.panel.search')}</span>
              <input
                type="search"
                value={filters.q ?? ''}
                onChange={(event) => setFilters({ ...filters, q: event.target.value })}
                placeholder={t('teachers.panel.search')}
                className="h-10 w-full min-w-48 rounded-control border border-border bg-surface px-3 text-sm text-text"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs text-text-muted">
                {t('teachers.panel.degree')}
              </span>
              <select
                value={filters.degreeId ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, degreeId: event.target.value || undefined })
                }
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('common.all')}</option>
                {(facets?.degrees ?? []).map((degree) => (
                  <option key={degree.id} value={degree.id}>
                    {`${degree.code} · ${degree.name}`}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs text-text-muted">
                {t('teachers.panel.category')}
              </span>
              <select
                value={filters.category ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, category: event.target.value || undefined })
                }
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('common.all')}</option>
                {(facets?.categories ?? []).map((category) => (
                  <option key={category} value={category}>
                    {t(`teacherCategory.${category}`)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs text-text-muted">
                {t('teachers.panel.status')}
              </span>
              <select
                value={filters.status ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, status: event.target.value || undefined })
                }
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('common.all')}</option>
                {(['under', 'optimal', 'limit', 'over'] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(`load.status.${status}`)}
                  </option>
                ))}
              </select>
            </label>

            {hasFilters ? (
              <Button
                variant="ghost"
                onClick={() => setFilters({ sort: filters.sort, order: filters.order })}
              >
                {t('common.clear')}
              </Button>
            ) : null}

            <ColumnPicker columns={columns} />
          </div>

          {query.isPending ? (
            <TableSkeleton rows={8} columns={6} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : query.data.teachers.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('teachers.panel.noResults') : t('teachers.empty.title')}
              description={
                hasFilters ? t('teachers.panel.noResultsHint') : t('teachers.empty.description')
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('teachers.panel.title')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    {SORTABLE.filter((column) => columns.shows(column.key)).map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className={cn(
                          'py-2 pr-4 font-medium',
                          ['capacity', 'assigned', 'ratio'].includes(column.key) && 'text-right',
                        )}
                        aria-sort={
                          filters.sort === column.key
                            ? filters.order === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          aria-label={t('admin.sortBy', { column: t(column.labelKey) })}
                          className="inline-flex items-center gap-1 hover:text-text"
                        >
                          {t(column.labelKey)}
                          {filters.sort === column.key ? (
                            filters.order === 'asc' ? (
                              <ArrowUp className="size-3" aria-hidden="true" />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden="true" />
                            )
                          ) : null}
                        </button>
                      </th>
                    ))}
                    {columns.shows('category') ? (
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('teachers.category')}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {query.data.teachers.map((teacher) => (
                    <tr key={teacher.teacherProfileId} className="border-b border-border/60">
                      <th scope="row" className="py-3 pr-4 text-left font-medium">
                        <Link
                          to={`/teachers/${teacher.teacherProfileId}`}
                          className="flex items-center gap-3 text-primary underline-offset-2 hover:underline"
                        >
                          <Avatar
                            name={formatPersonName(teacher.firstName, teacher.lastName)}
                            url={teacher.avatarUrl}
                          />
                          {formatPersonName(teacher.firstName, teacher.lastName)}
                        </Link>
                      </th>
                      {columns.shows('capacity') ? (
                        <td className="tabular py-3 pr-4 text-right text-text">
                          {formatHours(locale, teacher.capacityHours)}
                        </td>
                      ) : null}
                      {columns.shows('assigned') ? (
                        <td className="tabular py-3 pr-4 text-right text-text">
                          {formatHours(locale, teacher.assignedHours)}
                        </td>
                      ) : null}
                      {columns.shows('ratio') ? (
                        <td className="tabular py-3 pr-4 text-right text-text">
                          {formatPercent(locale, teacher.ratioPercent)}
                        </td>
                      ) : null}
                      {columns.shows('status') ? (
                        <td className="py-3 pr-4">
                          <LoadBadge status={teacher.status} ratioPercent={teacher.ratioPercent} />
                        </td>
                      ) : null}
                      {columns.shows('category') ? (
                        <td className="py-3 pr-4 text-text-muted">
                          {t(`teacherCategory.${teacher.category}`)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-3 text-sm text-text-muted">
                {t('teachers.panel.results', { count: query.data.teachers.length })}
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function LoadSummary({
  summary,
}: {
  summary: { totalCapacityHours: number; totalAssignedHours: number; ratioPercent: number | null }
}) {
  const { t } = useTranslation()
  const locale = currentLocale()

  const items = [
    {
      label: t('load.capacity'),
      value: `${formatHours(locale, summary.totalCapacityHours)} ${t('common.hoursShort')}`,
    },
    {
      label: t('load.assigned'),
      value: `${formatHours(locale, summary.totalAssignedHours)} ${t('common.hoursShort')}`,
    },
    { label: t('load.ratio'), value: formatPercent(locale, summary.ratioPercent) },
  ]

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-card border border-border bg-surface p-4">
          <dt className="text-sm text-text-muted">{item.label}</dt>
          <dd className="tabular mt-1 text-xl font-semibold text-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
