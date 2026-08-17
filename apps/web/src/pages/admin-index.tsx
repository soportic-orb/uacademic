import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useRoles } from '../app/use-roles'
import { EmptyState } from '../components/feedback/states'
import { Card, CardBody } from '../components/ui/card'
import { resourcesForRoles } from '../features/admin/resource-config'

/** Entry point to the management screens the current role may open. */
export function AdminIndexPage() {
  const { t } = useTranslation()
  const roles = useRoles()
  const resources = resourcesForRoles(roles)
  const canManageUsers = roles.includes('CENTER_ADMIN')

  if (resources.length === 0 && !canManageUsers) {
    return <EmptyState title={t('errors.forbidden')} />
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('admin.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('settings.subtitle')}</p>
      </header>

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

        {canManageUsers ? (
          <li>
            <Card>
              <CardBody>
                <Link
                  to="/admin/users"
                  className="text-base font-medium text-primary hover:underline"
                >
                  {t('admin.users')}
                </Link>
              </CardBody>
            </Card>
          </li>
        ) : null}
      </ul>
    </div>
  )
}
