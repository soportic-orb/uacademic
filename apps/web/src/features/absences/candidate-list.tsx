/**
 * Who can cover one class, best first — and, just as usefully, who cannot and
 * why. "Nobody is free on Tuesday" is a real answer; a blank list is not.
 *
 * The order is the pure ranking in `@uacademic/shared`; this only draws it.
 */
import { useTranslation } from 'react-i18next'

import { CardSkeleton, EmptyState, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { useAskSubstitute, useCandidates } from '../collaboration/queries'

export function CandidateList({
  absenceId,
  sessionId,
  canManage,
}: {
  absenceId: string
  sessionId: string
  canManage: boolean
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useCandidates(absenceId, sessionId)
  const ask = useAskSubstitute(absenceId)

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const eligible = query.data.items.filter((candidate) => candidate.eligible)
  const ineligible = query.data.items.filter((candidate) => !candidate.eligible)

  if (query.data.items.length === 0) return <EmptyState title={t('substitutes.empty')} />

  const assign = (teacherProfileId: string, name: string) => {
    ask.mutate(
      { sessionId, teacherProfileId },
      {
        onSuccess: () => toast.success('substitutes.assigned', { params: { name } }),
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium text-text">{t('substitutes.eligible')}</h3>
        {eligible.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t('substitutes.empty')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {eligible.map((candidate) => (
              <li
                key={candidate.teacherProfileId}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{candidate.name}</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
                    {candidate.reasons.map((reason, index) => (
                      <li key={`${reason.messageKey}-${index}`}>
                        {t(reason.messageKey, reason.params)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className="tabular text-sm text-text-muted"
                    aria-label={t('substitutes.score')}
                  >
                    {candidate.score}
                  </span>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={ask.isPending}
                      onClick={() => assign(candidate.teacherProfileId, candidate.name)}
                    >
                      {t('substitutes.assign')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ineligible.length > 0 ? (
        <section>
          <h3 className="text-sm font-medium text-text">{t('substitutes.ineligible')}</h3>
          <ul className="mt-2 divide-y divide-border">
            {ineligible.map((candidate) => (
              <li key={candidate.teacherProfileId} className="py-2">
                <p className="text-sm text-text-muted">{candidate.name}</p>
                <ul className="mt-0.5 space-y-0.5 text-xs text-text-muted">
                  {candidate.blockers.map((blocker) => (
                    <li key={blocker}>{t(`substitutes.blockers.${blocker}`)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
