import { useTranslation } from 'react-i18next'

import { EmptyState } from '../components/feedback/states'
import { useToast } from '../hooks/use-toast'
import { useRoles } from '../app/use-roles'

/**
 * Screens whose feature lands in a later phase. They still ship their empty
 * state with a suggested action, because "blank page" is not a state.
 */
function PlaceholderPage({ namespace }: { namespace: 'planning' | 'messages' | 'documents' }) {
  const { t } = useTranslation()
  const toast = useToast()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t(`${namespace}.title`)}</h1>
      </header>

      <EmptyState
        title={t(`${namespace}.empty.title`)}
        description={t(`${namespace}.empty.description`)}
        actionLabel={t(`${namespace}.empty.action`)}
        onAction={() => toast.info('toast.comingSoon')}
      />
    </div>
  )
}

export function MessagesPage() {
  return <PlaceholderPage namespace="messages" />
}

export function DocumentsPage() {
  return <PlaceholderPage namespace="documents" />
}

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

export function AssistantPage() {
  const { t } = useTranslation()
  const roles = useRoles()

  // The assistant is a coordination tool; anyone else gets told why, not a 404.
  if (!roles.includes('COORDINATOR')) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-text">{t('assistant.title')}</h1>
        </header>
        <EmptyState title={t('assistant.restricted')} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('assistant.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('assistant.subtitle')}</p>
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
