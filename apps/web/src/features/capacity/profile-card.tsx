/**
 * The teacher profile card: contract, reductions with their reason and
 * approver, and what the person can teach.
 *
 * Every hour figure shown here comes from the API, which computed it with the
 * shared domain logic and the center's thresholds — the card only formats.
 */
import type { ReductionInputDto, TeacherProfileDto } from '@uacademic/shared'
import { formatDate, formatHours, formatPercent, formatPersonName } from '@uacademic/shared'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadBadge } from '../../components/data/load-badge'
import { EmptyState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError } from '../../lib/api'
import { useSubjects } from '../../hooks/use-api'
import { useDeleteReduction, useSaveReduction, useSaveSkills } from './queries'

export function ProfileCard({
  teacherId,
  profile,
  canManage,
  canManageSkills,
}: {
  teacherId: string
  profile: TeacherProfileDto
  /** Center admins own the contract side: reductions and their approval. */
  canManage: boolean
  /** Coordinators decide who can teach what, so they edit the skills. */
  canManageSkills: boolean
}) {
  const { t } = useTranslation()
  const locale = currentLocale()

  const facts: { label: string; value: string }[] = [
    { label: t('teachers.category'), value: t(`teacherCategory.${profile.category}`) },
    { label: t('teachers.dedication'), value: t(`dedication.${profile.dedication}`) },
    {
      label: t('load.contracted'),
      value: `${formatHours(locale, profile.contractedHours)} ${t('common.hoursShort')}`,
    },
    {
      label: t('load.reductions'),
      value: `${formatHours(locale, profile.reductionHours)} ${t('common.hoursShort')}`,
    },
    {
      label: t('load.capacity'),
      value: `${formatHours(locale, profile.capacityHours)} ${t('common.hoursShort')}`,
    },
    {
      label: t('load.assigned'),
      value: `${formatHours(locale, profile.assignedHours)} ${t('common.hoursShort')}`,
    },
    {
      label: t('load.remaining'),
      value: `${formatHours(locale, profile.remainingHours)} ${t('common.hoursShort')}`,
    },
    { label: t('load.ratio'), value: formatPercent(locale, profile.ratioPercent) },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={formatPersonName(profile.firstName, profile.lastName)}
          description={profile.email}
          action={<LoadBadge status={profile.status} ratioPercent={profile.ratioPercent} />}
        />
        <CardBody>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-xs text-text-muted">{fact.label}</dt>
                <dd className="tabular mt-0.5 text-sm font-medium text-text">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {profile.notes ? (
            <p className="mt-6 border-t border-border pt-4 text-sm text-text-muted">
              {profile.notes}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <ReductionsCard teacherId={teacherId} profile={profile} canManage={canManage} />
      <SkillsCard teacherId={teacherId} profile={profile} canManage={canManageSkills} />
    </div>
  )
}

function ReductionsCard({
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
  const locale = currentLocale()
  const save = useSaveReduction(teacherId)
  const remove = useDeleteReduction(teacherId)

  const [editing, setEditing] = useState<{ id?: string; values: ReductionInputDto } | null>(null)

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    save.mutate(editing, {
      onSuccess: () => {
        toast.success('teachers.reductions.saved')
        setEditing(null)
      },
      onError,
    })
  }

  return (
    <Card>
      <CardHeader
        title={t('teachers.reductions.title')}
        description={t('teachers.reductions.description')}
        action={
          canManage ? (
            <Button
              variant="secondary"
              onClick={() => setEditing({ values: { reason: '', hours: 0, status: 'pending' } })}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('teachers.reductions.add')}
            </Button>
          ) : null
        }
      />

      <CardBody className="space-y-4">
        {editing ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-text-muted">{t('teachers.reductions.reason')}</span>
              <input
                type="text"
                required
                minLength={3}
                value={editing.values.reason}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    values: { ...editing.values, reason: event.target.value },
                  })
                }
                className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('teachers.reductions.hours')}</span>
              <input
                type="number"
                required
                min={0}
                step={0.5}
                value={editing.values.hours}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    values: { ...editing.values, hours: Number(event.target.value) },
                  })
                }
                className="tabular h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('teachers.reductions.status')}</span>
              <select
                value={editing.values.status}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    values: {
                      ...editing.values,
                      status: event.target.value as ReductionInputDto['status'],
                    },
                  })
                }
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
              >
                {(['pending', 'approved', 'rejected'] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(`reductionStatus.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 sm:col-span-4">
              <Button type="submit" disabled={save.isPending}>
                {t('common.save')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : null}

        {profile.reductions.length === 0 ? (
          <EmptyState title={t('teachers.reductions.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('teachers.reductions.title')}</caption>
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('teachers.reductions.reason')}
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    {t('teachers.reductions.hours')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('teachers.reductions.status')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('teachers.reductions.approver')}
                  </th>
                  {canManage ? (
                    <th scope="col" className="py-2 text-right font-medium">
                      {t('admin.actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {profile.reductions.map((reduction) => (
                  <tr key={reduction.id} className="border-b border-border/60">
                    <th scope="row" className="py-3 pr-4 text-left font-medium text-text">
                      {reduction.reason}
                    </th>
                    <td className="tabular py-3 pr-4 text-right text-text">
                      {formatHours(locale, reduction.hours)}
                    </td>
                    <td className="py-3 pr-4 text-text-muted">
                      {t(`reductionStatus.${reduction.status}`)}
                    </td>
                    <td className="py-3 pr-4 text-text-muted">
                      {reduction.approverName
                        ? `${reduction.approverName}${
                            reduction.approvedAt
                              ? ` · ${formatDate(locale, new Date(reduction.approvedAt))}`
                              : ''
                          }`
                        : '—'}
                    </td>
                    {canManage ? (
                      <td className="py-3 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('teachers.reductions.edit')}
                            onClick={() =>
                              setEditing({
                                id: reduction.id,
                                values: {
                                  reason: reduction.reason,
                                  hours: reduction.hours,
                                  status: reduction.status,
                                },
                              })
                            }
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common.remove')}
                            onClick={() => {
                              if (!window.confirm(t('teachers.reductions.confirmRemove'))) return
                              remove.mutate(reduction.id, {
                                onSuccess: () => toast.success('teachers.reductions.removed'),
                                onError,
                              })
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-text-muted">{t('teachers.reductions.pendingHint')}</p>
      </CardBody>
    </Card>
  )
}

function SkillsCard({
  teacherId,
  profile,
  canManage,
}: {
  teacherId: string
  profile: TeacherProfileDto
  canManage: boolean
}) {
  const { t } = useTranslation()

  const subjects = profile.skills.filter((skill) => skill.subjectId)
  const areas = profile.skills.filter((skill) => skill.knowledgeArea)

  const [editing, setEditing] = useState(false)

  return (
    <Card>
      <CardHeader
        title={t('teachers.skills.title')}
        description={t('teachers.skills.description')}
        action={
          canManage ? (
            <Button variant="secondary" onClick={() => setEditing((current) => !current)}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('teachers.skills.edit')}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {editing ? (
          <SkillsForm
            teacherId={teacherId}
            profile={profile}
            onDone={() => setEditing(false)}
            className="mb-6 border-b border-border pb-6"
          />
        ) : null}

        {profile.skills.length === 0 ? (
          <EmptyState title={t('teachers.skills.empty')} />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <section>
              <h3 className="text-sm font-medium text-text">{t('teachers.skills.subjects')}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {subjects.map((skill) => (
                  <li
                    key={skill.id}
                    className="rounded-control border border-border bg-surface-muted px-2 py-1 text-sm text-text"
                  >
                    {`${skill.subjectCode ?? ''} · ${skill.subjectName ?? ''}`}
                  </li>
                ))}
                {subjects.length === 0 ? (
                  <li className="text-sm text-text-muted">{t('common.none')}</li>
                ) : null}
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-medium text-text">
                {t('teachers.skills.knowledgeAreas')}
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {areas.map((skill) => (
                  <li
                    key={skill.id}
                    className="rounded-control border border-border bg-surface-muted px-2 py-1 text-sm text-text"
                  >
                    {skill.knowledgeArea}
                  </li>
                ))}
                {areas.length === 0 ? (
                  <li className="text-sm text-text-muted">{t('common.none')}</li>
                ) : null}
              </ul>
            </section>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Editing what a person can teach: the subjects come from the center's own
 * catalog, the knowledge areas are free text. Both are saved as a set, so the
 * form always describes the whole answer rather than a delta.
 */
function SkillsForm({
  teacherId,
  profile,
  onDone,
  className,
}: {
  teacherId: string
  profile: TeacherProfileDto
  onDone: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveSkills(teacherId)
  const subjects = useSubjects()

  const [subjectIds, setSubjectIds] = useState(
    profile.skills.flatMap((skill) => (skill.subjectId ? [skill.subjectId] : [])),
  )
  const [areas, setAreas] = useState(
    profile.skills.flatMap((skill) => (skill.knowledgeArea ? [skill.knowledgeArea] : [])),
  )
  const [draftArea, setDraftArea] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    save.mutate(
      { subjectIds, knowledgeAreas: areas },
      {
        onSuccess: () => {
          toast.success('teachers.skills.saved')
          onDone()
        },
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className={className}>
      <div className="grid gap-6 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-text-muted">{t('teachers.skills.subjects')}</span>
          <select
            multiple
            size={6}
            value={subjectIds}
            onChange={(event) =>
              setSubjectIds([...event.target.selectedOptions].map((option) => option.value))
            }
            className="w-full rounded-control border border-border bg-surface p-2 text-text"
          >
            {(subjects.data?.items ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {`${subject.code} · ${subject.nameCa}`}
              </option>
            ))}
          </select>
        </label>

        <div className="text-sm">
          <span className="mb-1 block text-text-muted">{t('teachers.skills.knowledgeAreas')}</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={draftArea}
              placeholder={t('teachers.skills.areaPlaceholder')}
              onChange={(event) => setDraftArea(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const value = draftArea.trim()
                if (value.length >= 2 && !areas.includes(value)) setAreas([...areas, value])
                setDraftArea('')
              }}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
            <Button
              variant="secondary"
              onClick={() => {
                const value = draftArea.trim()
                if (value.length >= 2 && !areas.includes(value)) setAreas([...areas, value])
                setDraftArea('')
              }}
            >
              {t('teachers.skills.addArea')}
            </Button>
          </div>

          <ul className="mt-2 flex flex-wrap gap-2">
            {areas.map((area) => (
              <li key={area}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('common.remove')} ${area}`}
                  onClick={() => setAreas(areas.filter((entry) => entry !== area))}
                >
                  {area}
                  <Trash2 className="size-3" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
