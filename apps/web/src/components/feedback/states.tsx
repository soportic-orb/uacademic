import { CircleAlert, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '../../lib/cn'
import { Button } from '../ui/button'

/**
 * The three states every screen owes the user (CLAUDE.md §4): loading with
 * skeletons — never a full-page spinner — empty with a suggested action, and
 * error with a retry.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('motion-safe:animate-pulse rounded-control bg-surface-muted', className)}
      aria-hidden="true"
    />
  )
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t('states.loadingLabel')} aria-busy="true" className="space-y-3">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cn('h-6 flex-1', column === 0 && 'max-w-56')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      aria-label={t('states.loadingLabel')}
      aria-busy="true"
      className={cn('rounded-card border border-border bg-surface p-6', className)}
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-24" />
    </div>
  )
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      <div className="mb-4 text-text-muted">
        {icon ?? <Inbox className="size-8" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm text-text-muted">{description}</p> : null}
      {actionLabel && onAction ? (
        <Button className="mt-6" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function ErrorState({
  onRetry,
  description,
}: {
  onRetry?: () => void
  description?: string
}) {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-card border border-danger/30 bg-surface px-6 py-12 text-center"
    >
      <CircleAlert className="mb-4 size-8 text-danger" aria-hidden="true" />
      <h3 className="text-base font-semibold text-text">{t('states.errorTitle')}</h3>
      <p className="mt-2 max-w-md text-sm text-text-muted">
        {description ?? t('states.errorDescription')}
      </p>
      {onRetry ? (
        <Button className="mt-6" variant="secondary" onClick={onRetry}>
          {t('states.retry')}
        </Button>
      ) : null}
    </div>
  )
}
