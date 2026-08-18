/**
 * The notification centre: the full history, the per-event preferences and the
 * only place push is ever turned on.
 */
import { formatDate } from '@uacademic/shared'
import { BellOff, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { CardSkeleton, EmptyState, ErrorState } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import {
  useNotifications,
  usePreferences,
  useReadNotification,
} from '../features/collaboration/queries'
import { PreferencesForm } from '../features/notifications/preferences-form'
import { PushCard } from '../features/notifications/push-card'
import { currentLocale } from '../i18n'

export function NotificationsPage() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const list = useNotifications()
  const preferences = usePreferences()
  const markRead = useReadNotification()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('notifications.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('notifications.preferencesHint')}</p>
        </div>
        {(list.data?.unread ?? 0) > 0 ? (
          <Button variant="secondary" onClick={() => markRead.mutate('all')}>
            <Check className="size-4" aria-hidden="true" />
            {t('common.markAllRead')}
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader title={t('notifications.title')} />
        <CardBody>
          {list.isPending ? <CardSkeleton /> : null}
          {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
          {list.data && list.data.items.length === 0 ? (
            <EmptyState
              title={t('notifications.empty')}
              icon={<BellOff className="size-8" aria-hidden="true" />}
            />
          ) : null}

          {list.data && list.data.items.length > 0 ? (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li
                  key={item.id}
                  className={item.readAt ? 'py-3' : 'border-l-2 border-l-primary py-3 pl-3'}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text">
                        {item.payload.title ?? t(`notify.${item.type}.title`)}
                      </p>
                      <p className="mt-0.5 text-sm text-text-muted">{item.payload.body}</p>
                      {item.payload.url ? (
                        <Link
                          to={item.payload.url}
                          className="mt-1 inline-block text-sm text-primary underline-offset-2 hover:underline"
                        >
                          {t('notifications.open')}
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular text-xs text-text-muted">
                        {formatDate(locale, new Date(item.createdAt), {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                      {item.readAt ? null : (
                        <Button variant="ghost" size="sm" onClick={() => markRead.mutate(item.id)}>
                          {t('notifications.markRead')}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {preferences.isPending ? <CardSkeleton /> : null}
      {preferences.isError ? <ErrorState onRetry={() => void preferences.refetch()} /> : null}
      {preferences.data ? (
        <>
          <PushCard
            available={preferences.data.push.available}
            publicKey={preferences.data.push.publicKey}
          />
          <PreferencesForm items={preferences.data.items} />
        </>
      ) : null}
    </div>
  )
}
