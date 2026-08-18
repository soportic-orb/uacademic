/**
 * How long a change actually takes to reach somebody's calendar.
 *
 * Shown next to every method, because the honest answer differs by an order of
 * magnitude — a Graph write lands in seconds, a Google subscription can take a
 * day — and a teacher deciding how to set this up deserves the real number.
 */
import type { Latency } from './queries'

import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function LatencyNote({ latency }: { latency: Latency }) {
  const { t } = useTranslation()

  const format = (minutes: number) =>
    minutes >= 60
      ? t('connections.latency.hours', { count: Math.round(minutes / 60) })
      : t('connections.latency.minutes', { count: minutes })

  return (
    <p className="flex items-center gap-1.5 text-xs text-text-muted">
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {latency.maxMinutes <= 5
          ? t('connections.latency.immediate')
          : t('connections.latency.range', {
              min: format(latency.minMinutes),
              max: format(latency.maxMinutes),
            })}
        {latency.clientControlled ? ` · ${t('connections.latency.clientControlled')}` : ''}
      </span>
    </p>
  )
}
