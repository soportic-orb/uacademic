/**
 * The version comparator: what changes between two versions, as sentences
 * rather than as a diff of rows.
 *
 * The same list, grouped by teacher, is what publication turns into
 * notifications — so what a coordinator reads here is exactly what the people
 * affected will read.
 */
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState, TableSkeleton } from '../../components/feedback/states'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { cn } from '../../lib/cn'
import { type VersionListItem, useCompare } from './queries'

const KIND_STYLE: Record<string, string> = {
  added: 'text-load-optimal',
  removed: 'text-load-over',
  changed: 'text-load-limit',
}

export function CompareView({
  versions,
  initialBaseId,
  initialTargetId,
}: {
  versions: VersionListItem[]
  initialBaseId: string
  initialTargetId: string
}) {
  const { t } = useTranslation()
  const [baseId, setBaseId] = useState(initialBaseId)
  const [targetId, setTargetId] = useState(initialTargetId)
  const query = useCompare(baseId, targetId)

  return (
    <Card>
      <CardHeader title={t('planner.compare.title')} description={t('planner.compare.subtitle')} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('planner.compare.base')}</span>
            <select
              value={baseId}
              onChange={(event) => setBaseId(event.target.value)}
              className="h-10 min-w-56 rounded-control border border-border bg-surface px-2 text-sm text-text"
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </select>
          </label>

          <ArrowRight className="mb-3 size-4 text-text-muted" aria-hidden="true" />

          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">
              {t('planner.compare.target')}
            </span>
            <select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="h-10 min-w-56 rounded-control border border-border bg-surface px-2 text-sm text-text"
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {query.isPending ? (
          <TableSkeleton rows={4} columns={2} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data.changes.length === 0 ? (
          <p className="text-sm text-text-muted">{t('planner.compare.noChanges')}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(['added', 'removed', 'changed', 'unchanged', 'teachers'] as const).map((key) => (
                <div key={key} className="rounded-control border border-border p-3">
                  <dt className="text-xs text-text-muted">{t(`planner.compare.summary.${key}`)}</dt>
                  <dd className="tabular text-lg font-semibold text-text">
                    {key === 'teachers'
                      ? query.data.summary.teachersAffected
                      : query.data.summary[key]}
                  </dd>
                </div>
              ))}
            </dl>

            <section>
              <h3 className="text-sm font-medium text-text">{t('planner.compare.byTeacher')}</h3>
              <ul className="mt-2 space-y-4">
                {query.data.byTeacher.map((entry) => (
                  <li key={entry.teacherProfileId}>
                    <p className="text-sm font-medium text-text">
                      {entry.teacherName ?? entry.teacherProfileId}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {entry.changes.map((change, index) => (
                        <li
                          key={`${change.messageKey}-${index}`}
                          className={cn('text-sm', KIND_STYLE[change.kind] ?? 'text-text')}
                        >
                          {t(change.messageKey, {
                            ...change.params,
                            weekday: t(`weekday.${change.params.weekday ?? 1}`),
                            previousWeekday: t(`weekday.${change.params.previousWeekday ?? 1}`),
                          })}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </CardBody>
    </Card>
  )
}
