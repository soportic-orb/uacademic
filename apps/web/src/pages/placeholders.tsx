import { useTranslation } from 'react-i18next'

import { EmptyState } from '../components/feedback/states'

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-text">{t('errors.notFound')}</h1>
      <EmptyState title={t('states.emptyDefaultTitle')} />
    </div>
  )
}
