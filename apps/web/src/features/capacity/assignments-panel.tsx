import type { TeacherProfileDto } from '@uacademic/shared'
import { formatHours } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'

const CONCEPTS = ['lecture', 'tutoring', 'coordination', 'tfg', 'other'] as const

/**
 * "Fonaments de matemàtiques (MAT101) · A1".
 *
 * Built here rather than inline so the punctuation is not mistaken for text
 * somebody forgot to translate — and so both places that name a group agree.
 */
function groupLabel(subject: { name: string; code: string }, groupCode: string): string {
  return `${subject.name} (${subject.code}) · ${groupCode}`
}

interface AssignableGroup {
  id: string
  code: string
  type: string
  plannedHours: number
  subjectCode: string
  subjectName: string
  heldConcepts: string[]
}

/**
 * What this person teaches, and the way to change it.
 *
 * Assigning somebody to a group had no route at all: the only thing that could
 * write one was the assistant's execute step, so a coordinator without the
 * assistant — or at a center that has it switched off — could not staff a
 * subject from anywhere in the product.
 */
export function AssignmentsPanel({
  teacherId,
  profile,
  canManage,
}: {
  teacherId: string
  profile: TeacherProfileDto
  canManage: boolean
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const locale = currentLocale()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ groupId: '', concept: 'lecture', assignedHours: '' })

  const groups = useQuery({
    queryKey: ['assignable-groups', teacherId],
    queryFn: () =>
      apiFetch<{ items: AssignableGroup[] }>(`/api/v1/teachers/${teacherId}/assignable-groups`),
    enabled: canManage && adding,
  })

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['teacher', teacherId] })
    await queryClient.invalidateQueries({ queryKey: ['assignable-groups', teacherId] })
    await queryClient.invalidateQueries({ queryKey: ['center-load'] })
  }

  const assign = useMutation({
    mutationFn: () =>
      apiJson(`/api/v1/teachers/${teacherId}/assignments`, 'POST', {
        groupId: form.groupId,
        concept: form.concept,
        assignedHours: Number(form.assignedHours),
      }),
    onSuccess: async () => {
      toast.success('teachers.assignments.added')
      setForm({ groupId: '', concept: 'lecture', assignedHours: '' })
      setAdding(false)
      await refresh()
    },
    onError,
  })

  const remove = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/api/v1/teachers/${teacherId}/assignments/${assignmentId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('teachers.assignments.removed')
      await refresh()
    },
    onError,
  })

  // A group already held under every concept has nothing left to offer.
  const available = (groups.data?.items ?? []).filter(
    (group) => group.heldConcepts.length < CONCEPTS.length,
  )
  const chosen = available.find((group) => group.id === form.groupId)

  return (
    <Card>
      <CardHeader
        title={t('teachers.assignments.title')}
        description={t('teachers.assignments.hint')}
        action={
          canManage && !adding ? (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('teachers.assignments.add')}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {profile.assignments.length === 0 ? (
          <p className="text-sm text-text-muted">{t('teachers.assignments.none')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {profile.assignments.map((assignment) => (
              <li key={assignment.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text">
                    {groupLabel(
                      { name: assignment.subjectName, code: assignment.subjectCode },
                      assignment.groupCode,
                    )}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t(`assignmentConcept.${assignment.concept}`)}
                  </p>
                </div>

                <span className="tabular text-sm text-text">
                  {formatHours(locale, assignment.hours)} {t('common.hoursShort')}
                </span>

                {canManage ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(assignment.id)}
                    className="text-text-muted hover:text-danger"
                    aria-label={t('teachers.assignments.remove', {
                      group: assignment.groupCode,
                      subject: assignment.subjectCode,
                    })}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
            onSubmit={(event) => {
              event.preventDefault()
              assign.mutate()
            }}
          >
            <label className="min-w-56 flex-1 text-sm">
              <span className="mb-1 block text-xs text-text-muted">
                {t('teachers.assignments.group')}
              </span>
              <select
                required
                value={form.groupId}
                onChange={(event) => {
                  const group = available.find((entry) => entry.id === event.target.value)
                  setForm({
                    ...form,
                    groupId: event.target.value,
                    // The group's planned hours are the offer, not the rule:
                    // what a group is worth in a load is the center's call.
                    assignedHours: group ? String(group.plannedHours) : form.assignedHours,
                  })
                }}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('common.choose')}</option>
                {available.map((group) => (
                  <option key={group.id} value={group.id}>
                    {groupLabel({ name: group.subjectName, code: group.subjectCode }, group.code)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-text-muted">
                {t('teachers.assignments.concept')}
              </span>
              <select
                value={form.concept}
                onChange={(event) => setForm({ ...form, concept: event.target.value })}
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                {CONCEPTS.filter((concept) => !chosen?.heldConcepts.includes(concept)).map(
                  (concept) => (
                    <option key={concept} value={concept}>
                      {t(`assignmentConcept.${concept}`)}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-text-muted">{t('load.assigned')}</span>
              <input
                type="number"
                min={0}
                step="0.5"
                required
                value={form.assignedHours}
                onChange={(event) => setForm({ ...form, assignedHours: event.target.value })}
                className="tabular h-10 w-28 rounded-control border border-border bg-surface px-3 text-sm text-text"
              />
            </label>

            <Button type="submit" disabled={assign.isPending || !form.groupId}>
              {assign.isPending ? t('common.saving') : t('common.add')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  )
}
