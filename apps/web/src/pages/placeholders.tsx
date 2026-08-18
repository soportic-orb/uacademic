import { useTranslation } from 'react-i18next'

import { EmptyState } from '../components/feedback/states'

export function PlatformPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('platform.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('platform.subtitle')}</p>
      </header>
      <EmptyState title={t('states.emptyDefaultTitle')} description={t('toast.comingSoon')} />
    </div>
  )
}

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-text">{t('errors.notFound')}</h1>
      <EmptyState title={t('states.emptyDefaultTitle')} />
    </div>
  )
}
