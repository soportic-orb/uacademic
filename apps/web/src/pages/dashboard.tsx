import { type LoadStatus, formatHours, formatPercent } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'

import { LoadBadge } from '../components/data/load-badge'
import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Card, CardBody } from '../components/ui/card'
import { InstallPrompt } from '../features/pwa/install-prompt'
import { OfflineBanner } from '../features/pwa/offline-banner'
import { useOwnLoad, useTeacherLoad } from '../hooks/use-api'
import { currentLocale } from '../i18n'
import { useRoles } from '../app/use-roles'

const STATUSES: LoadStatus[] = ['under', 'optimal', 'limit', 'over']

export function DashboardPage() {
  const { t } = useTranslation()
  const roles = useRoles()
  const canSeeCenter = roles.some((role) => role === 'CENTER_ADMIN' || role === 'COORDINATOR')

  const centerLoad = useTeacherLoad(canSeeCenter)
  const ownLoad = useOwnLoad(!canSeeCenter)
  const locale = currentLocale()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('dashboard.subtitle')}</p>
      </header>

      <OfflineBanner />
      <InstallPrompt />

      {canSeeCenter ? (
        centerLoad.isPending ? (
          <div className="grid gap-4 md:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : centerLoad.isError ? (
          <ErrorState onRetry={() => void centerLoad.refetch()} />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Metric
                label={t('dashboard.teachersWithLoad')}
                value={String(centerLoad.data.summary.teachers)}
              />
              <Metric
                label={t('load.capacity')}
                value={`${formatHours(locale, centerLoad.data.summary.totalCapacityHours)} ${t('common.hoursShort')}`}
              />
              <Metric
                label={t('load.ratio')}
                value={formatPercent(locale, centerLoad.data.summary.ratioPercent)}
              />
            </div>

            <Card>
              <CardBody>
                <h2 className="text-sm font-medium text-text-muted">
                  {t('load.trafficLightLabel')}
                </h2>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {STATUSES.map((status) => (
                    <li
                      key={status}
                      className="flex items-center justify-between rounded-control border border-border px-3 py-2"
                    >
                      <LoadBadge status={status} />
                      <span className="tabular text-lg font-semibold text-text">
                        {centerLoad.data.summary.byStatus[status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </>
        )
      ) : ownLoad.isPending ? (
        <CardSkeleton />
      ) : ownLoad.isError ? (
        <ErrorState onRetry={() => void ownLoad.refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Metric
            label={t('load.capacity')}
            value={`${formatHours(locale, ownLoad.data.capacityHours)} ${t('common.hoursShort')}`}
          />
          <Metric
            label={t('load.assigned')}
            value={`${formatHours(locale, ownLoad.data.assignedHours)} ${t('common.hoursShort')}`}
          />
          <Card>
            <CardBody>
              <p className="text-sm text-text-muted">{t('load.ratio')}</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="tabular text-2xl font-semibold text-text">
                  {formatPercent(locale, ownLoad.data.ratioPercent)}
                </span>
                <LoadBadge status={ownLoad.data.status} />
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-text-muted">{label}</p>
        <p className="tabular mt-2 text-2xl font-semibold text-text">{value}</p>
      </CardBody>
    </Card>
  )
}
