import type { ListResult } from '@uacademic/shared'
import { formatDate, formatPersonName } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { apiFetch } from '../../lib/api'

interface UserRow {
  id: string
  email: string
  firstName: string
  lastName: string
  status: 'active' | 'invited' | 'pending_activation' | 'suspended'
  linkedToEntra: boolean
  lastLoginAt: string | null
  roles: string[]
}

const ROLES = ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'] as const
const STATUSES = ['active', 'invited', 'pending_activation', 'suspended'] as const

/**
 * Users are the one admin screen that is not generic: they are global rows
 * with per-center roles, and the list is bounded by membership in the active
 * center rather than by a `center_id` column (R2).
 */
export function UsersPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const locale = currentLocale()

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')

  const params = new URLSearchParams({ page: String(page), pageSize: '25' })
  if (search.trim()) params.set('q', search.trim())
  if (role) params.set('role', role)
  if (status) params.set('status', status)

  const query = useQuery({
    queryKey: ['admin-users', params.toString()],
    queryFn: () => apiFetch<ListResult<UserRow>>(`/api/v1/users?${params.toString()}`),
  })

  const activate = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/users/${id}/activate`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('admin.activated')
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('admin.users')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('admin.title')}</p>
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

            <label>
              <span className="mb-1 block text-xs text-text-muted">{t('admin.roles')}</span>
              <select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value)
                  setPage(1)
                }}
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('common.optional')}</option>
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {t(`roles.${option}`)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs text-text-muted">{t('teachers.status')}</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(1)
                }}
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('common.optional')}</option>
                {STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {t(`userStatus.${option}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {query.isPending ? (
            <TableSkeleton rows={6} columns={5} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : query.data.items.length === 0 ? (
            <EmptyState title={t('admin.noResults')} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('admin.users')}</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('teachers.name')}
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('admin.roles')}
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('teachers.status')}
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('auth.linkedAccount')}
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        {t('admin.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((user) => (
                      <tr key={user.id} className="border-b border-border/60">
                        <th scope="row" className="py-3 pr-4 text-left font-medium text-text">
                          {formatPersonName(user.firstName, user.lastName)}
                          <span className="block text-xs font-normal text-text-muted">
                            {user.email}
                          </span>
                        </th>
                        <td className="py-3 pr-4 text-text-muted">
                          {user.roles.map((item) => t(`roles.${item}`)).join(', ')}
                        </td>
                        <td className="py-3 pr-4 text-text-muted">
                          {t(`userStatus.${user.status}`)}
                        </td>
                        <td className="py-3 pr-4 text-text-muted">
                          {user.linkedToEntra
                            ? user.lastLoginAt
                              ? formatDate(locale, new Date(user.lastLoginAt))
                              : t('common.yes')
                            : t('common.no')}
                        </td>
                        <td className="py-3 text-right">
                          {user.status === 'pending_activation' ? (
                            <Button size="sm" onClick={() => activate.mutate(user.id)}>
                              {t('admin.activate')}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-3 text-sm text-text-muted">
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
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
