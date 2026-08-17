import { formatHours, formatPercent } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'

import { LoadBadge } from '../components/data/load-badge'
import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useOwnLoad } from '../hooks/use-api'
import { currentLocale } from '../i18n'

export function MyLoadPage() {
  const { t } = useTranslation()
  const query = useOwnLoad()
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
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('load.title')}</h1>
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
    </div>
  )
}
