/**
 * Class changes: the list on the left, the request you are looking at on the
 * right, and the form to open a new one.
 */
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'

import { EmptyState, ErrorState, TableSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { ChangeDetail, StatusPill } from '../features/changes/change-detail'
import { ChangeForm } from '../features/changes/change-form'
import { useChanges } from '../features/collaboration/queries'

const SCOPES = ['mine', 'open', 'all'] as const
type Scope = (typeof SCOPES)[number]

export function ChangesPage() {
  const { t } = useTranslation()
  const params = useParams<{ id?: string }>()
  const [scope, setScope] = useState<Scope>('mine')
  const [selected, setSelected] = useState<string | null>(params.id ?? null)
  const [creating, setCreating] = useState(false)
  const query = useChanges(scope)

  const items = query.data?.items ?? []
  const current = selected ?? items[0]?.id ?? null

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('changes.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('changes.subtitle')}</p>
        </div>
        <Button onClick={() => setCreating((value) => !value)}>
          <Plus className="size-4" aria-hidden="true" />
          {t('changes.create')}
        </Button>
      </header>

      {creating ? (
        <ChangeForm
          onCreated={(id) => {
            setSelected(id)
            setCreating(false)
          }}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader
            title={t('changes.title')}
            action={
              <div className="flex gap-1" role="group" aria-label={t('common.filters')}>
                {SCOPES.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={scope === value ? 'primary' : 'ghost'}
                    aria-pressed={scope === value}
                    onClick={() => setScope(value)}
                  >
                    {t(`changes.${value}`)}
                  </Button>
                ))}
              </div>
            }
          />
          <CardBody>
            {query.isPending ? <TableSkeleton rows={4} columns={2} /> : null}
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : null}
            {query.data && items.length === 0 ? (
              <EmptyState
                title={t('changes.empty')}
                actionLabel={t('changes.create')}
                onAction={() => setCreating(true)}
              />
            ) : null}

            {items.length > 0 ? (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(item.id)}
                      aria-current={current === item.id}
                      className={`w-full rounded-control px-2 py-3 text-left hover:bg-surface-muted ${
                        current === item.id ? 'bg-surface-muted' : ''
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-text">
                          {t(`changes.type.${item.type}`)}
                        </span>
                        <StatusPill status={item.status} />
                      </span>
                      <span className="mt-1 block truncate text-xs text-text-muted">
                        {item.session
                          ? `${item.session.label} · ${t(`weekday.${item.session.weekday}`)} ${item.session.startTime}`
                          : t('changes.requestedBy', { name: item.requesterName })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        {current ? <ChangeDetail id={current} /> : <EmptyState title={t('changes.empty')} />}
      </div>
    </div>
  )
}
