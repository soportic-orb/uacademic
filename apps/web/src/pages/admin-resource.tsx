import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'

import { useRoles } from '../app/use-roles'
import { EmptyState } from '../components/feedback/states'
import { resourceByKey } from '../features/admin/resource-config'
import { ResourcePage } from '../features/admin/resource-page'

/**
 * One route for every admin table. The API re-checks the role on each request,
 * so this guard is about not showing a screen that would only 403.
 */
export function AdminResourcePage() {
  const { t } = useTranslation()
  const { resourceKey } = useParams()
  const roles = useRoles()

  const resource = resourceByKey(resourceKey)
  if (!resource) return <EmptyState title={t('errors.notFound')} />

  const allowed = resource.roles.some((role) => roles.includes(role))
  if (!allowed) return <EmptyState title={t('errors.forbidden')} />

  return <ResourcePage resource={resource} />
}
