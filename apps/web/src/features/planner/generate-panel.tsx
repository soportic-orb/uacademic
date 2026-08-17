/**
 * Automatic generation, from the coordinator's side.
 *
 * The run happens in a worker thread on the server; here we start it, follow
 * its progress over SSE (falling back to polling, since a shared host may not
 * keep a stream open), and then show the proposals with the plain-language
 * account of what each one gave up.
 */
import type { Proposal, SolverProgress } from '@uacademic/shared'
import { Play, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fetchRun, useApplyProposal, useStartGeneration } from './queries'

const POLL_INTERVAL_MS = 1200

export function GeneratePanel({ versionId, editable }: { versionId: string; editable: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const start = useStartGeneration(versionId)
  const apply = useApplyProposal(versionId)

  const [runId, setRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<SolverProgress | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [running, setRunning] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const follow = useCallback(
    (id: string) => {
      stopPolling()
      timer.current = setInterval(() => {
        void fetchRun(id)
          .then((run) => {
            setProgress(run.progress)
            if (run.status === 'processing') return

            stopPolling()
            setRunning(false)
            if (run.status === 'failed') {
              toast.error('planner.generate.failed')
              return
            }
            setProposals(run.proposals)
            if (run.stoppedEarly) toast.info('planner.generate.timedOut')
          })
          .catch(() => {
            stopPolling()
            setRunning(false)
            toast.error('planner.generate.failed')
          })
      }, POLL_INTERVAL_MS)
    },
    [stopPolling, toast],
  )

  const run = () => {
    setProposals([])
    setProgress(null)
    setRunning(true)

    start.mutate(
      {},
      {
        onSuccess: (result) => {
          setRunId(result.runId)
          follow(result.runId)
        },
        onError: (error) => {
          setRunning(false)
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('planner.generate.failed')
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader
        title={t('planner.generate.title')}
        description={t('planner.generate.subtitle')}
        action={
          editable ? (
            <Button onClick={run} disabled={running}>
              {running ? (
                <Sparkles className="size-4 motion-safe:animate-pulse" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              {running ? t('planner.generate.running') : t('planner.generate.run')}
            </Button>
          ) : null
        }
      />

      <CardBody className="space-y-4">
        {running ? (
          <div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress?.percent ?? 0}
              aria-label={t('planner.generate.title')}
              className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
            >
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress?.percent ?? 5}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {t('planner.generate.progress', {
                percent: progress?.percent ?? 0,
                placed: progress?.placed ?? 0,
              })}
            </p>
          </div>
        ) : null}

        {proposals.length > 0 ? (
          <ul className="space-y-3">
            {proposals.map((proposal, index) => (
              <li
                key={proposal.id}
                className={cn(
                  'rounded-control border p-3',
                  index === 0 ? 'border-primary' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text">
                      {t('planner.generate.proposal', { number: index + 1 })}
                    </p>
                    <p className="tabular text-sm text-text-muted">
                      {t('planner.generate.cost', { cost: proposal.cost })}
                      {' · '}
                      {proposal.unplaced.length === 0
                        ? t('planner.generate.allPlaced')
                        : t('planner.generate.unplaced', { count: proposal.unplaced.length })}
                    </p>
                  </div>

                  {editable && runId ? (
                    <Button
                      variant={index === 0 ? 'primary' : 'secondary'}
                      disabled={apply.isPending}
                      onClick={() =>
                        apply.mutate(
                          { runId, proposalId: proposal.id },
                          { onSuccess: () => toast.success('planner.generate.applied') },
                        )
                      }
                    >
                      {t('planner.generate.apply')}
                    </Button>
                  ) : null}
                </div>

                <p className="mt-2 text-xs font-medium text-text">
                  {t('planner.generate.sacrifices')}
                </p>
                {proposal.sacrifices.length === 0 ? (
                  <p className="text-sm text-text-muted">{t('planner.generate.noSacrifices')}</p>
                ) : (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-text-muted">
                    {proposal.sacrifices.map((sacrifice) => (
                      <li key={sacrifice.constraint}>
                        {t(sacrifice.messageKey, sacrifice.params)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  )
}
