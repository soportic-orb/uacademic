import { formatHours, formatPercent } from '@uacademic/shared'
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { LoadBadge } from '../components/data/load-badge'
import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useTeacherWorkload } from '../features/capacity/queries'
import { WorkloadBreakdown } from '../features/capacity/workload-breakdown'
import { currentLocale } from '../i18n'

/**
 * Screen (e): the teacher's own hours — the totals that decide the traffic
 * light, then the breakdown by subject and by concept.
 */
export function MyLoadPage() {
  const { t } = useTranslation()
  const query = useTeacherWorkload('me')
  const locale = currentLocale()

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const load = query.data
  const rows: { label: string; value: string }[] = [
    { label: t('load.contracted'), value: formatHours(locale, load.contractedHours) },
    { label: t('load.reductions'), value: formatHours(locale, load.reductionHours) },
    { label: t('load.capacity'), value: formatHours(locale, load.capacityHours) },
    { label: t('load.assigned'), value: formatHours(locale, load.assignedHours) },
    { label: t('load.remaining'), value: formatHours(locale, load.remainingHours) },
  ]

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('load.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('teachers.workload.subtitle')}</p>
        </div>
        <Link
          to="/teachers/me"
          className="inline-flex items-center gap-2 text-sm text-primary underline-offset-2 hover:underline"
        >
          <CalendarClock className="size-4" aria-hidden="true" />
          {t('teachers.availability.title')}
        </Link>
      </header>

      <Card className="max-w-2xl">
        <CardHeader
          title={t('load.ratio')}
          description={t(`load.statusHint.${load.status}`)}
          action={<LoadBadge status={load.status} ratioPercent={load.ratioPercent} />}
        />
        <CardBody>
          <p className="tabular text-2xl font-semibold text-text">
            {formatPercent(locale, load.ratioPercent)}
          </p>

          <dl className="mt-6 divide-y divide-border">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2">
                <dt className="text-sm text-text-muted">{row.label}</dt>
                <dd className="tabular text-sm font-medium text-text">
                  {`${row.value} ${t('common.hoursShort')}`}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <WorkloadBreakdown workload={load} />
    </div>
  )
}
