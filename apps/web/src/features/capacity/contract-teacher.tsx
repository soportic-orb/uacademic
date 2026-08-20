import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

const CATEGORIES = [
  'full_professor',
  'associate_professor',
  'assistant_professor',
  'lecturer',
  'adjunct',
  'visiting',
  'external',
] as const

const DEDICATIONS = ['full_time', 'part_time', 'hourly'] as const

interface Candidate {
  userId: string
  email: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  status: string
}

/**
 * Giving somebody in this center a contract for the year in force.
 *
 * Deliberately not a place to create an account: the person has to already
 * hold the lecturer role, which is granted on the users screen. Access and
 * workload are separate decisions, and the panel says where the other one
 * lives when there is nobody left to contract.
 */
export function ContractTeacher({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const centerId = useSessionStore((state) => state.centerId)

  const [form, setForm] = useState({
    userId: '',
    category: 'associate_professor' as string,
    dedication: 'full_time' as string,
    contractedHours: '240',
  })

  const candidates = useQuery({
    queryKey: ['teacher-candidates', centerId],
    queryFn: () => apiFetch<{ items: Candidate[] }>('/api/v1/teachers/candidates'),
  })

  const create = useMutation({
    mutationFn: () =>
      apiJson('/api/v1/teachers', 'POST', {
        userId: form.userId,
        category: form.category,
        dedication: form.dedication,
        contractedHours: Number(form.contractedHours),
      }),
    onSuccess: async () => {
      toast.success('teachers.contracted')
      await queryClient.invalidateQueries({ queryKey: ['center-load'] })
      await queryClient.invalidateQueries({ queryKey: ['teacher-candidates'] })
      onDone()
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  const people = candidates.data?.items ?? []
  const chosen = people.find((person) => person.userId === form.userId)

  return (
    <Card>
      <CardHeader title={t('teachers.newTitle')} description={t('teachers.newHint')} />
      <CardBody>
        {candidates.isSuccess && people.length === 0 ? (
          <p className="text-sm text-text-muted">{t('teachers.noCandidates')}</p>
        ) : (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            <label className="sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-text">
                {t('teachers.person')}
              </span>
              <select
                required
                value={form.userId}
                onChange={(event) => setForm({ ...form, userId: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('teachers.choosePerson')}</option>
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.lastName}, {person.firstName} · {person.email}
                  </option>
                ))}
              </select>
            </label>

            {chosen ? (
              <p className="flex items-center gap-2 text-sm text-text-muted sm:col-span-2">
                <Avatar
                  name={`${chosen.firstName} ${chosen.lastName}`}
                  url={chosen.avatarUrl}
                  size="xs"
                />
                {t(`userStatus.${chosen.status}`)}
              </p>
            ) : null}

            <label>
              <span className="mb-1 block text-sm font-medium text-text">
                {t('teachers.category')}
              </span>
              <select
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                {CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {t(`teacherCategory.${option}`)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-sm font-medium text-text">
                {t('teachers.dedication')}
              </span>
              <select
                value={form.dedication}
                onChange={(event) => setForm({ ...form, dedication: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                {DEDICATIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`dedication.${option}`)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-sm font-medium text-text">{t('load.capacity')}</span>
              <input
                type="number"
                min={0}
                step="0.5"
                required
                value={form.contractedHours}
                onChange={(event) => setForm({ ...form, contractedHours: event.target.value })}
                className="tabular h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
              />
            </label>

            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={create.isPending || !form.userId}>
                {create.isPending ? t('common.saving') : t('teachers.contract')}
              </Button>
              <Button type="button" variant="secondary" onClick={onDone}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  )
}
