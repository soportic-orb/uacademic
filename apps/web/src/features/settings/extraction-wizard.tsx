/**
 * The wizard: one block of the regulation per screen.
 *
 * Eight screens rather than one long form, because that is how the reading is
 * produced — a job per block — and because forty parameters at once is not
 * something anybody reviews carefully. The last screen is the honest one: what
 * was applied, what was refused, and what the document never answered and is
 * still waiting for somebody to decide.
 */
import { EXTRACTION_BLOCKS, blockHelpKey, blockLabelKey, paramLabelKey } from '@uacademic/shared'
import { ArrowLeft, ArrowRight, CircleCheck, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { ExtractionRow } from './extraction-row'
import {
  type ApplySummary,
  useAcceptHighConfidence,
  useApplyRun,
  useExtractionRun,
  useResolveRow,
} from './queries'

export interface ExtractionWizardProps {
  runId: string
  onFinished?: () => void
}

export function ExtractionWizard({ runId, onFinished }: ExtractionWizardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const run = useExtractionRun(runId)
  const resolve = useResolveRow(runId)
  const acceptHigh = useAcceptHighConfidence(runId)
  const apply = useApplyRun(runId)

  const [step, setStep] = useState(0)
  const [summary, setSummary] = useState<ApplySummary | null>(null)

  const fail = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  if (run.isPending) return <CardSkeleton />
  if (run.isError) return <ErrorState onRetry={() => void run.refetch()} />

  if (summary) return <Summary summary={summary} onFinished={onFinished} />

  const block = EXTRACTION_BLOCKS[step] ?? EXTRACTION_BLOCKS[0]
  const status = run.data.blocks[block]
  const rows = run.data.rows.filter((row) => row.block === block)
  const last = step === EXTRACTION_BLOCKS.length - 1

  return (
    <Card>
      <CardHeader
        title={`${block} · ${t(blockLabelKey(block))}`}
        description={t(blockHelpKey(block))}
        action={
          <span className="text-xs text-text-muted">
            {t(`settings.extraction.blockState.${status?.state ?? 'pending'}`)}
          </span>
        }
      />

      <CardBody className="space-y-4">
        {/* Where in the eight blocks this is, and which are already back. */}
        <ol className="flex flex-wrap gap-1" aria-label={t('settings.extraction.title')}>
          {EXTRACTION_BLOCKS.map((entry, index) => (
            <li key={entry}>
              <button
                type="button"
                onClick={() => setStep(index)}
                aria-current={index === step ? 'step' : undefined}
                className={`size-8 rounded-control border text-xs ${
                  index === step
                    ? 'border-primary bg-primary text-primary-contrast'
                    : run.data.blocks[entry]?.state === 'ready'
                      ? 'border-success/40 bg-success/10 text-success'
                      : run.data.blocks[entry]?.state === 'failed'
                        ? 'border-danger/40 bg-danger/10 text-danger'
                        : 'border-border bg-surface text-text-muted'
                }`}
              >
                {entry}
              </button>
            </li>
          ))}
        </ol>

        {status?.state === 'pending' || status?.state === 'running' ? (
          <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            {t('settings.extraction.running')}
          </p>
        ) : null}

        {status?.state === 'failed' ? (
          <p className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {t(status.errorKey ?? 'settings.extraction.errors.failed')}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  acceptHigh.mutate(block, {
                    onSuccess: (result) =>
                      toast.success('settings.extraction.acceptedCount', {
                        params: { count: result.accepted },
                      }),
                    onError: fail,
                  })
                }
              >
                {t('settings.extraction.acceptAllHigh')}
              </Button>
            </div>

            <ul>
              {rows.map((row) => (
                <ExtractionRow
                  key={row.id}
                  row={row}
                  conflicted={run.data.conflicts.includes(row.paramKey)}
                  onResolve={(input) =>
                    resolve.mutate(input, {
                      onSuccess: () => toast.success('settings.extraction.resolved'),
                      onError: fail,
                    })
                  }
                />
              ))}
            </ul>
          </>
        ) : status?.state === 'ready' ? (
          <p className="text-sm text-text-muted">{t('settings.extraction.notFound.absent')}</p>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button
            variant="secondary"
            disabled={step === 0}
            onClick={() => setStep(Math.max(0, step - 1))}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('common.back')}
          </Button>

          {last ? (
            <Button
              disabled={apply.isPending}
              onClick={() =>
                apply.mutate(undefined, {
                  onSuccess: (result) => {
                    setSummary(result)
                    toast.success('settings.extraction.applied')
                  },
                  onError: fail,
                })
              }
            >
              {t('settings.extraction.apply')}
            </Button>
          ) : (
            <Button onClick={() => setStep(Math.min(EXTRACTION_BLOCKS.length - 1, step + 1))}>
              {t('common.next')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * The last screen. What is still not configured is the part worth reading, so
 * it gets its own list with a link into the parameter rather than a number in
 * a corner.
 */
function Summary({
  summary,
  onFinished,
}: {
  summary: ApplySummary
  onFinished?: (() => void) | undefined
}) {
  const { t } = useTranslation()

  const groups = [
    { key: 'applied', items: summary.applied },
    { key: 'rejected', items: summary.rejected },
    { key: 'pending', items: summary.pending },
  ] as const

  return (
    <Card>
      <CardHeader
        title={t('settings.extraction.summary.title')}
        description={t('settings.extraction.subtitle')}
      />
      <CardBody className="space-y-6">
        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
              {group.key === 'applied' ? (
                <CircleCheck className="size-4 text-success" aria-hidden="true" />
              ) : null}
              {t(`settings.extraction.summary.${group.key}`)} ({group.items.length})
            </h3>

            {group.items.length === 0 ? (
              <p className="mt-1 text-sm text-text-muted">
                {t('settings.extraction.summary.none')}
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {group.items.map((key) => (
                  <li key={key} className="flex items-center justify-between gap-3">
                    <span className="text-text">{t(paramLabelKey(key))}</span>
                    {group.key === 'pending' ? (
                      <a
                        href={`/settings#${key}`}
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        {t('settings.extraction.summary.configure')}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {onFinished ? (
          <Button variant="secondary" onClick={onFinished}>
            {t('common.close')}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  )
}
