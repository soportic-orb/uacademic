/**
 * The bell: what happened while you were doing something else.
 *
 * It is not a toast replacement — toasts answer for the action you just took
 * (CLAUDE.md §4), the bell holds what the system decided on its own. Realtime
 * keeps it current; the query underneath also refetches on its own so a lost
 * stream never leaves it silently stale.
 */
import { formatDate } from '@uacademic/shared'
import { Bell, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { Button } from '../../components/ui/button'
import { currentLocale } from '../../i18n'
import { useNotifications, useReadNotification } from '../collaboration/queries'

export function NotificationBell() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const query = useNotifications()
  const markRead = useReadNotification()

  const unread = query.data?.unread ?? 0
  const items = (query.data?.items ?? []).slice(0, 8)

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div className="relative" ref={container}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          unread > 0
            ? `${t('layout.notifications')} (${t('notifications.unreadCount', { count: unread })})`
            : t('layout.notifications')
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 ? (
          <span className="tabular absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 z-40 mt-2 w-80 rounded-card border border-border bg-surface-raised shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text">{t('notifications.title')}</h2>
            {unread > 0 ? (
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => markRead.mutate('all')}
              >
                {t('common.markAllRead')}
              </button>
            ) : null}
          </div>

          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-text-muted">
                {t('notifications.empty')}
              </li>
            ) : (
              items.map((item) => (
                <li key={item.id} className="border-b border-border last:border-b-0">
                  <div className="flex items-start gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">
                        {item.payload.title ?? t(`notify.${item.type}.title`)}
                      </p>
                      <p className="mt-0.5 text-sm text-text-muted">{item.payload.body}</p>
                      <p className="tabular mt-1 text-xs text-text-muted">
                        {formatDate(locale, new Date(item.createdAt), {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                      {item.payload.url ? (
                        <Link
                          to={item.payload.url}
                          onClick={() => setOpen(false)}
                          className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {t('notifications.open')}
                        </Link>
                      ) : null}
                    </div>
                    {item.readAt ? null : (
                      <button
                        type="button"
                        aria-label={t('notifications.markRead')}
                        title={t('notifications.markRead')}
                        className="rounded-control p-1 text-text-muted hover:bg-surface-muted hover:text-text"
                        onClick={() => markRead.mutate(item.id)}
                      >
                        <Check className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-border px-4 py-2 text-center">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              {t('notifications.viewAll')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
