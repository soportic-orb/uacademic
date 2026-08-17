import type { LoadStatus } from '@uacademic/shared'
import { ArrowDown, ArrowUp, Check, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '../../lib/cn'

/**
 * Teaching-load traffic light. Color is never the only carrier of meaning:
 * every badge shows an icon and a text label as well (R8).
 */
const STATUS_STYLES: Record<LoadStatus, string> = {
  under: 'bg-load-under-surface text-load-under border-load-under/30',
  optimal: 'bg-load-optimal-surface text-load-optimal border-load-optimal/30',
  limit: 'bg-load-limit-surface text-load-limit border-load-limit/30',
  over: 'bg-load-over-surface text-load-over border-load-over/30',
}

const STATUS_ICON = {
  under: ArrowDown,
  optimal: Check,
  limit: TriangleAlert,
  over: ArrowUp,
} as const

export interface LoadBadgeProps {
  status: LoadStatus
  ratioPercent?: number | null
  className?: string
}

export function LoadBadge({ status, ratioPercent, className }: LoadBadgeProps) {
  const { t } = useTranslation()
  const Icon = STATUS_ICON[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-xs font-medium',
        STATUS_STYLES[status],
        className,
      )}
      title={t(`load.statusHint.${status}`)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{t(`load.status.${status}`)}</span>
      {ratioPercent !== undefined && ratioPercent !== null ? (
        <span className="tabular font-semibold">{`${ratioPercent.toFixed(0)}%`}</span>
      ) : null}
    </span>
  )
}
