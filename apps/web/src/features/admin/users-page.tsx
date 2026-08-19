import type { ListResult } from '@uacademic/shared'
import { formatDate, formatPersonName } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Send, UserPlus, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'

interface UserRow {
  id: string
  email: string
  firstName: string
  lastName: string
  status: 'active' | 'invited' | 'pending_activation' | 'suspended'
  linkedToEntra: boolean
  lastLoginAt: string | null
  roles: string[]
  grants: { id: string; role: string }[]
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

  const [creating, setCreating] = useState(false)
  const EMPTY = { email: '', firstName: '', lastName: '', role: 'COORDINATOR', locale: 'ca' }
  const [form, setForm] = useState(EMPTY)

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

  const create = useMutation({
    mutationFn: (input: typeof EMPTY) =>
      apiJson<{ invitationSent: boolean }>('/api/v1/users', 'POST', input),
    onSuccess: async (result) => {
      // "Invited" rather than "created": the account is linked to their
      // Microsoft identity the first time they sign in, not now. And it only
      // says invited when somebody was actually written to — with no mail
      // server the message goes to a log nobody reads.
      if (result.invitationSent) toast.success('admin.userInvited')
      else toast.warning('admin.userCreatedNoMail', { durationMs: 10_000 })
      setForm(EMPTY)
      setCreating(false)
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  // Which row has its panel open. One at a time: this is a table, not a form.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ firstName: '', lastName: '', status: 'active' })
  const [grantRole, setGrantRole] = useState('COORDINATOR')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] })

  const reportError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const reinvite = useMutation({
    mutationFn: (id: string) =>
      apiJson<{ sent: boolean }>(`/api/v1/users/${id}/invite`, 'POST', {}),
    onSuccess: (result) => {
      if (result.sent) toast.success('admin.inviteResent')
      else toast.warning('admin.userCreatedNoMail', { durationMs: 10_000 })
    },
    onError: reportError,
  })

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string; input: typeof draft }) =>
      apiJson(`/api/v1/users/${id}`, 'PATCH', input),
    onSuccess: async () => {
      toast.success('admin.saved')
      setEditing(null)
      await invalidate()
    },
    onError: reportError,
  })

  const grant = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiJson(`/api/v1/users/${id}/roles`, 'POST', { role }),
    onSuccess: async () => {
      toast.success('admin.roleGranted')
      await invalidate()
    },
    onError: reportError,
  })

  const revoke = useMutation({
    mutationFn: ({ id, grantId }: { id: string; grantId: string }) =>
      apiFetch(`/api/v1/users/${id}/roles/${grantId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      // Losing the last role means losing the center, which is what "remove
      // from this center" means for a person who may work in another.
      toast.success('admin.roleRevoked')
      await invalidate()
    },
    onError: reportError,
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('admin.users')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('admin.title')}</p>
        </div>

        <Button onClick={() => setCreating((open) => !open)} aria-expanded={creating}>
          <UserPlus className="size-4" aria-hidden="true" />
          {t('admin.newUser')}
        </Button>
      </header>

      {creating ? (
        <Card>
          <CardHeader title={t('admin.newUser')} description={t('admin.newUserHint')} />
          <CardBody>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                create.mutate(form)
              }}
            >
              <Field label={t('admin.fields.firstName')}>
                <Input
                  value={form.firstName}
                  onChange={(value) => setForm({ ...form, firstName: value })}
                  required
                />
              </Field>

              <Field label={t('admin.fields.lastName')}>
                <Input
                  value={form.lastName}
                  onChange={(value) => setForm({ ...form, lastName: value })}
                  required
                />
              </Field>

              <Field label={t('admin.fields.email')} hint={t('admin.emailHint')}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(value) => setForm({ ...form, email: value })}
                  required
                />
              </Field>

              <Field label={t('admin.fields.role')}>
                <select
                  value={form.role}
                  onChange={(event) => setForm({ ...form, role: event.target.value })}
                  className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
                >
                  {ROLES.map((option) => (
                    <option key={option} value={option}>
                      {t(`roles.${option}`)}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="sm:col-span-2">
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? t('common.saving') : t('admin.invite')}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

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
                      <Fragment key={user.id}>
                        <tr className="border-b border-border/60">
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
                            <div className="flex flex-wrap justify-end gap-2">
                              {user.status === 'pending_activation' ? (
                                <Button size="sm" onClick={() => activate.mutate(user.id)}>
                                  {t('admin.activate')}
                                </Button>
                              ) : null}

                              {/*
                              Only worth offering to somebody who has never
                              arrived: once they have signed in, an invitation
                              tells them nothing they do not know.
                            */}
                              {user.linkedToEntra ? null : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={reinvite.isPending}
                                  onClick={() => reinvite.mutate(user.id)}
                                >
                                  <Send className="size-4" aria-hidden="true" />
                                  {t('admin.resendInvite')}
                                </Button>
                              )}

                              <Button
                                variant="secondary"
                                size="sm"
                                aria-expanded={editing === user.id}
                                onClick={() => {
                                  setEditing(editing === user.id ? null : user.id)
                                  setDraft({
                                    firstName: user.firstName,
                                    lastName: user.lastName,
                                    status: user.status,
                                  })
                                }}
                              >
                                <Pencil className="size-4" aria-hidden="true" />
                                {t('admin.edit')}
                              </Button>
                            </div>
                          </td>
                        </tr>

                        {editing === user.id ? (
                          <tr className="border-b border-border/60 bg-surface-muted">
                            <td colSpan={5} className="p-4">
                              <div className="grid gap-6 lg:grid-cols-2">
                                <form
                                  className="grid gap-4 sm:grid-cols-2"
                                  onSubmit={(event) => {
                                    event.preventDefault()
                                    save.mutate({ id: user.id, input: draft })
                                  }}
                                >
                                  <Field label={t('admin.fields.firstName')}>
                                    <Input
                                      value={draft.firstName}
                                      onChange={(value) => setDraft({ ...draft, firstName: value })}
                                      required
                                    />
                                  </Field>

                                  <Field label={t('admin.fields.lastName')}>
                                    <Input
                                      value={draft.lastName}
                                      onChange={(value) => setDraft({ ...draft, lastName: value })}
                                      required
                                    />
                                  </Field>

                                  <Field label={t('admin.fields.status')}>
                                    <select
                                      value={draft.status}
                                      onChange={(event) =>
                                        setDraft({ ...draft, status: event.target.value })
                                      }
                                      className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
                                    >
                                      {STATUSES.map((option) => (
                                        <option key={option} value={option}>
                                          {t(`userStatus.${option}`)}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>

                                  <div className="flex items-end">
                                    <Button type="submit" disabled={save.isPending}>
                                      {save.isPending ? t('common.saving') : t('common.save')}
                                    </Button>
                                  </div>
                                </form>

                                <div className="space-y-3">
                                  <h3 className="text-sm font-medium text-text">
                                    {t('admin.rolesInCenter')}
                                  </h3>

                                  <ul className="flex flex-wrap gap-2">
                                    {user.grants.map((held) => (
                                      <li
                                        key={held.id}
                                        className="flex items-center gap-2 rounded-control border border-border bg-surface px-2 py-1 text-xs text-text"
                                      >
                                        {t(`roles.${held.role}`)}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            revoke.mutate({ id: user.id, grantId: held.id })
                                          }
                                          className="text-text-muted hover:text-danger"
                                          aria-label={t('admin.revokeRole', {
                                            role: t(`roles.${held.role}`),
                                          })}
                                        >
                                          <X className="size-3.5" aria-hidden="true" />
                                        </button>
                                      </li>
                                    ))}
                                  </ul>

                                  <div className="flex flex-wrap items-end gap-2">
                                    <Field label={t('admin.fields.role')}>
                                      <select
                                        value={grantRole}
                                        onChange={(event) => setGrantRole(event.target.value)}
                                        className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
                                      >
                                        {ROLES.map((option) => (
                                          <option key={option} value={option}>
                                            {t(`roles.${option}`)}
                                          </option>
                                        ))}
                                      </select>
                                    </Field>

                                    <Button
                                      variant="secondary"
                                      disabled={grant.isPending}
                                      onClick={() => grant.mutate({ id: user.id, role: grantRole })}
                                    >
                                      {t('admin.grantRole')}
                                    </Button>
                                  </div>

                                  <p className="text-xs text-text-muted">{t('admin.revokeHint')}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
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

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  // The hint sits outside the <label>: inside, it becomes part of the field's
  // accessible name.
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-text">{label}</span>
        {children}
      </label>
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  )
}

function Input({
  value,
  onChange,
  type = 'text',
  required,
}: {
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <input
      type={type}
      required={required}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
    />
  )
}
