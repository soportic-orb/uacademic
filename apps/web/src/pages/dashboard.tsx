import { type LoadStatus, formatHours, formatPercent } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { LoadBadge } from '../components/data/load-badge'
import { CardSkeleton, EmptyState, ErrorState } from '../components/feedback/states'
import { Card, CardBody } from '../components/ui/card'
import { resourcesForRoles } from '../features/admin/resource-config'
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
  // The platform administrator manages universities, centers and tenants; they
  // have no teaching load and no center of their own to summarise. Asking the
  // teacher endpoint about them is how a new installation greeted its first
  // user with an error.
  const isPlatformAdmin = !canSeeCenter && roles.includes('SUPERADMIN')

  const centerLoad = useTeacherLoad(canSeeCenter)
  const ownLoad = useOwnLoad(!canSeeCenter && !isPlatformAdmin)
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
      ) : isPlatformAdmin ? (
        <PlatformShortcuts roles={roles} />
      ) : ownLoad.isPending ? (
        <CardSkeleton />
      ) : ownLoad.isError ? (
        <ErrorState onRetry={() => void ownLoad.refetch()} />
      ) : !ownLoad.data ? (
        // Signed in, but nobody has given this person any teaching yet.
        <EmptyState title={t('dashboard.noLoadTitle')} description={t('dashboard.noLoadBody')} />
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

/**
 * What a platform administrator opens the product to do. Links rather than
 * figures: the numbers that matter to them live inside each screen, and an
 * installation minutes old has none of them yet.
 */
function PlatformShortcuts({ roles }: { roles: readonly string[] }) {
  const { t } = useTranslation()
  const resources = resourcesForRoles(roles as Parameters<typeof resourcesForRoles>[0])

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {resources.map((resource) => (
        <li key={resource.key}>
          <Card>
            <CardBody>
              <Link
                to={`/admin/${resource.key}`}
                className="text-base font-medium text-primary hover:underline"
              >
                {t(resource.titleKey)}
              </Link>
            </CardBody>
          </Card>
        </li>
      ))}
      <li>
        <Card>
          <CardBody>
            <Link to="/platform" className="text-base font-medium text-primary hover:underline">
              {t('nav.platform')}
            </Link>
          </CardBody>
        </Card>
      </li>
    </ul>
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
