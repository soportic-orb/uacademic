/**
 * A proposal, before it is anything else.
 *
 * R5 made visible: what would change, side by side with what is there now,
 * the conflicts it would cause, and two buttons. Nothing has happened yet, and
 * the card says so rather than assuming it is understood.
 */
import { Check, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { type AiProposal, useResolveProposal } from './queries'

export interface ProposalCardProps {
  proposalId: string
  proposal: AiProposal
  status: 'pending' | 'confirmed' | 'rejected' | 'expired' | 'failed'
}

function Fields({ values }: { values: Record<string, unknown> | null }) {
  if (!values) return <span className="text-text-muted">—</span>

  return (
    <ul className="space-y-0.5">
      {Object.entries(values).map(([key, value]) => (
        <li key={key} className="tabular text-xs">
          <span className="text-text-muted">{key}: </span>
          <span className="text-text">{value === null ? '—' : String(value)}</span>
        </li>
      ))}
    </ul>
  )
}

export function ProposalCard({ proposalId, proposal, status }: ProposalCardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const resolve = useResolveProposal()

  const blocked = proposal.violations.length > 0 || proposal.changes.length === 0
  const pending = status === 'pending'

  const act = (action: 'confirm' | 'reject') => {
    resolve.mutate(
      { id: proposalId, action },
      {
        onSuccess: () =>
          toast.success(action === 'confirm' ? 'assistant.confirmed' : 'assistant.rejected'),
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )
  }

  return (
    <section
      className="rounded-card border border-primary-200 bg-primary-50 p-3 dark:border-primary-700 dark:bg-primary-900/30"
      aria-label={t('assistant.proposal')}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">
            {t(`assistant.tools.${proposal.tool}`, { defaultValue: proposal.tool })}
          </h3>
          <p className="mt-0.5 text-sm text-text">{proposal.summary}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-muted">
          {t(`assistant.${status === 'pending' ? 'proposal' : status}`, {
            defaultValue: status,
          })}
        </span>
      </header>

      {proposal.changes.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-text-muted">{t('assistant.changes')}</h4>
          <ul className="mt-1 space-y-2">
            {proposal.changes.slice(0, 8).map((change, index) => (
              <li
                key={`${change.entity}-${change.entityId ?? index}`}
                className="rounded-control border border-border bg-surface p-2"
              >
                <p className="text-xs font-medium text-text">{change.label}</p>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] uppercase text-text-muted">{t('assistant.before')}</p>
                    <Fields values={change.before} />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-text-muted">{t('assistant.after')}</p>
                    <Fields values={change.after} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {proposal.violations.length > 0 ? (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            {t('assistant.conflicts')}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text-muted">
            {proposal.violations.map((violation, index) => (
              <li key={`${violation.messageKey}-${index}`}>
                {t(violation.messageKey, violation.params)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {proposal.warnings.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-warning">{t('assistant.warnings')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text-muted">
            {proposal.warnings.map((warning, index) => (
              <li key={`${warning.messageKey}-${index}`}>
                {t(warning.messageKey.replace('assistant.warnings.', 'assistant.warningsText.'), {
                  ...warning.params,
                  defaultValue: warning.messageKey,
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending ? (
        <>
          <p className="mt-3 text-xs text-text-muted">
            {blocked ? t('assistant.blocked') : t('assistant.proposalHint')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={blocked || resolve.isPending}
              onClick={() => act('confirm')}
            >
              <Check className="size-4" aria-hidden="true" />
              {t('assistant.confirm')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={resolve.isPending}
              onClick={() => act('reject')}
            >
              <X className="size-4" aria-hidden="true" />
              {t('assistant.reject')}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}
