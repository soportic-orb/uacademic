/**
 * Turning push on — never by itself.
 *
 * Two rules drive this card. The permission is only ever requested from a real
 * click, because a prompt fired on load is denied once and forever; and on iOS
 * the Push API only exists inside a PWA that was added to the home screen
 * (16.4+), so a phone that is not installed gets the instructions instead of a
 * button that cannot work.
 */
import { pushReadiness } from '@uacademic/shared'
import { BellRing, Share } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { apiJson } from '../../lib/api'

export interface PushCardProps {
  available: boolean
  publicKey: string | null
}

/** The VAPID key travels as base64url and the browser wants raw bytes. */
function decodeKey(value: string): ArrayBuffer {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const binary = atob(padded)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return buffer
}

function environment() {
  const supportsPush =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  return {
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    standalone:
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        // Safari's own flag, which is what an installed iOS PWA reports.
        (navigator as { standalone?: boolean }).standalone === true),
    supportsPush,
    permission: supportsPush ? Notification.permission : ('default' as NotificationPermission),
  }
}

export function PushCard({ available, publicKey }: PushCardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [readiness, setReadiness] = useState(() => pushReadiness(environment()))
  const [busy, setBusy] = useState(false)

  // Permission granted is not the same as subscribed: a browser that was
  // allowed once but never registered — or whose subscription the server
  // pruned — has to be able to ask for a new one.
  useEffect(() => {
    if (readiness !== 'granted' || !('serviceWorker' in navigator)) return

    let cancelled = false
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled && !subscription) setReadiness('ready')
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [readiness])

  const enable = async () => {
    setBusy(true)
    try {
      // Requested here and nowhere else: inside the handler of a real click.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setReadiness(permission === 'denied' ? 'denied' : 'ready')
        toast.error('notifications.push.denied')
        return
      }

      const registration = await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey ? decodeKey(publicKey) : undefined,
        }))

      const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> }
      await apiJson('/api/v1/notifications/push', 'POST', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        userAgent: navigator.userAgent,
      })

      setReadiness('granted')
      toast.success('notifications.push.enabled')
    } catch {
      toast.error('errors.generic')
    } finally {
      setBusy(false)
    }
  }

  if (!available) {
    return (
      <Card>
        <CardHeader title={t('notifications.push.title')} />
        <CardBody>
          <p className="text-sm text-text-muted">{t('notifications.push.unavailable')}</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title={t('notifications.push.title')} />
      <CardBody className="space-y-3">
        {readiness === 'needsInstall' ? (
          <div className="rounded-control border border-primary-200 bg-primary-50 p-4 dark:border-primary-700 dark:bg-primary-900/40">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
              <Share className="size-4" aria-hidden="true" />
              {t('notifications.push.iosTitle')}
            </h3>
            <p className="mt-2 text-sm text-text">{t('notifications.push.iosSteps')}</p>
            <p className="mt-2 text-xs text-text-muted">{t('notifications.push.iosNote')}</p>
          </div>
        ) : null}

        {readiness === 'unsupported' ? (
          <p className="text-sm text-text-muted">{t('notifications.push.unsupported')}</p>
        ) : null}

        {readiness === 'denied' ? (
          <p className="text-sm text-text-muted">{t('notifications.push.denied')}</p>
        ) : null}

        {readiness === 'granted' ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <BellRing className="size-4" aria-hidden="true" />
            {t('notifications.push.enabled')}
          </p>
        ) : null}

        {readiness === 'ready' ? (
          <Button onClick={() => void enable()} disabled={busy}>
            <BellRing className="size-4" aria-hidden="true" />
            {t('notifications.push.enable')}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  )
}
