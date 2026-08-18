/**
 * "You are offline, and this is what that means here."
 *
 * A generic "no connection" toast tells somebody what they already know. What
 * is worth saying is which of the two situations they are in: the timetable on
 * screen is the copy saved on this device and is still usable, or the screen
 * they are looking at is not one that survives without a network.
 */
import { CloudOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOnline } from './use-online'

export function OfflineBanner({ scope = 'generic' }: { scope?: 'generic' | 'calendar' }) {
  const { t } = useTranslation()
  const online = useOnline()

  if (online) return null

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/10 p-3 text-sm text-text"
    >
      <CloudOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        <span className="font-medium">{t('offline.title')}. </span>
        {t(`offline.${scope}`)}
      </span>
    </p>
  )
}
