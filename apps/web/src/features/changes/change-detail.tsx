/**
 * One request, everything that decides it: the class it touches, what is being
 * proposed, whatever the engine has against it, and only the steps this reader
 * is actually allowed to take.
 *
 * The buttons come from the API, which asks the same pure ladder the server
 * enforces — the screen never guesses what is legal.
 */
import type { Violation } from '@uacademic/shared'
import { formatDate } from '@uacademic/shared'
import { AlertTriangle, CircleCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError } from '../../lib/api'
import { type ChangeRequestDto, useChange, useTransition } from '../collaboration/queries'

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation()
  const tone =
    status === 'applied'
      ? 'bg-success/10 text-success border-success/30'
      : status === 'rejected' || status === 'expired' || status === 'cancelled'
        ? 'bg-danger/10 text-danger border-danger/30'
        : status === 'draft'
          ? 'bg-surface-muted text-text-muted border-border'
          : 'bg-warning/10 text-warning border-warning/30'

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${tone}`}>
      {t(`changes.status.${status}`)}
    </span>
  )
}

function ProposalList({ proposal }: { proposal: Record<string, unknown> }) {
  const { t } = useTranslation()
  const entries = Object.entries(proposal).filter(([, value]) => value !== null && value !== '')
  if (entries.length === 0) return null

  return (
    <dl className="divide-y divide-border">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-sm text-text-muted">
            {t(`changes.form.${key}`, { defaultValue: key })}
          </dt>
          <dd className="tabular text-sm text-text">
            {key === 'weekday' ? t(`weekday.${String(value)}`) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Conflicts({ violations }: { violations: Violation[] }) {
  const { t } = useTranslation()

  if (violations.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-success">
        <CircleCheck className="size-4" aria-hidden="true" />
        {t('changes.noConflicts')}
      </p>
    )
  }

  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-medium text-danger">
        <AlertTriangle className="size-4" aria-hidden="true" />
        {t('changes.conflicts')}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-muted">
        {violations.map((violation, index) => (
          <li key={`${violation.messageKey}-${index}`}>
            {t(violation.messageKey, violation.params)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChangeDetail({ id }: { id: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const query = useChange(id)
  const transition = useTransition(id)

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const change: ChangeRequestDto = query.data

  const act = (action: string) => {
    transition.mutate(action, {
      onSuccess: () => toast.success(`changes.done.${action}`),
      onError: (error) => {
        if (error instanceof ApiRequestError)
          toast.raw({ variant: 'error', message: error.localizedMessage })
        else toast.error('errors.generic')
      },
    })
  }

  return (
    <Card>
      <CardHeader
        title={t(`changes.type.${change.type}`)}
        description={t('changes.requestedBy', { name: change.requesterName })}
        action={<StatusPill status={change.status} />}
      />
      <CardBody className="space-y-5">
        {change.targetName ? (
          <p className="text-sm text-text-muted">
            {t('changes.targetIs', { name: change.targetName })}
          </p>
        ) : null}

        {change.session ? (
          <div>
            <h3 className="text-sm font-medium text-text">{t('changes.session')}</h3>
            <p className="tabular mt-1 text-sm text-text-muted">
              {`${change.session.label} · ${t(`weekday.${change.session.weekday}`)} ${change.session.startTime}–${change.session.endTime}`}
            </p>
          </div>
        ) : null}

        <div>
          <h3 className="text-sm font-medium text-text">{t('changes.proposal')}</h3>
          <ProposalList proposal={change.proposal} />
        </div>

        {change.reason ? (
          <div>
            <h3 className="text-sm font-medium text-text">{t('common.reason')}</h3>
            <p className="mt-1 text-sm text-text-muted">{change.reason}</p>
          </div>
        ) : null}

        <Conflicts violations={change.violations ?? []} />

        <p className="tabular text-xs text-text-muted">
          {change.expiresAt
            ? t('changes.expiresAt', {
                date: formatDate(locale, new Date(change.expiresAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })
            : t('changes.expiresNever')}
        </p>

        {change.actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {change.actions.map((action) => (
              <Button
                key={action}
                variant={action === 'reject' || action === 'cancel' ? 'secondary' : 'primary'}
                disabled={transition.isPending}
                onClick={() => act(action)}
              >
                {t(`changes.actions.${action}`)}
              </Button>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
