/**
 * One provider: what it is, where it stands, and the two things a teacher can
 * do with it — connect it, or let it read their busy time.
 *
 * The card states the two rules the integration is built on, rather than
 * leaving them to be discovered: everything is written into a calendar of its
 * own, and UAcademic is the source of truth, so a class deleted on a phone
 * comes back.
 */
import { formatDate } from '@uacademic/shared'
import { CalendarCheck, PlugZap, RefreshCw, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError } from '../../lib/api'
import { LatencyNote } from './latency-note'
import {
  type ProviderStatus,
  useAuthorize,
  useDisconnect,
  useSyncNow,
  useToggleBusySync,
} from './queries'

export function ProviderCard({ status }: { status: ProviderStatus }) {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const authorize = useAuthorize()
  const disconnect = useDisconnect()
  const sync = useSyncNow()
  const busy = useToggleBusySync()

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const stateKey = status.connected ? (status.status ?? 'active') : 'disconnected'

  return (
    <Card>
      <CardHeader
        title={t(`connections.levels.${status.provider}`)}
        description={t(`connections.levels.${status.provider}Hint`)}
        action={
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
              stateKey === 'active'
                ? 'border-success/30 bg-success/10 text-success'
                : stateKey === 'disconnected'
                  ? 'border-border bg-surface-muted text-text-muted'
                  : 'border-danger/30 bg-danger/10 text-danger'
            }`}
          >
            {t(`connections.status.${stateKey}`)}
          </span>
        }
      />

      <CardBody className="space-y-4">
        {!status.configured ? (
          <p className="text-sm text-text-muted">{t('connections.notConfigured')}</p>
        ) : null}

        <LatencyNote latency={status.latency} />

        <div className="rounded-control border border-border bg-surface-muted p-3">
          <p className="text-xs font-medium text-text">{t('connections.dedicatedCalendar')}</p>
          <p className="mt-1 text-xs text-text-muted">{t('connections.dedicatedCalendarHint')}</p>
          <p className="mt-2 text-xs text-text-muted">{t('connections.sourceOfTruth')}</p>
        </div>

        {status.connected ? (
          <dl className="space-y-1 text-xs text-text-muted">
            <div className="flex justify-between gap-2">
              <dt>{t('connections.lastSync')}</dt>
              <dd className="tabular">
                {status.lastSyncAt
                  ? formatDate(locale, new Date(status.lastSyncAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : t('connections.never')}
              </dd>
            </div>
            {status.calendarName ? (
              <div className="flex justify-between gap-2">
                <dt>{t('connections.dedicatedCalendar')}</dt>
                <dd>{status.calendarName}</dd>
              </div>
            ) : null}
            {status.lastError ? <p className="text-danger">{status.lastError}</p> : null}
          </dl>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {status.configured && !status.connected ? (
            <Button
              disabled={authorize.isPending}
              onClick={() =>
                authorize.mutate(status.provider, {
                  // Consent happens on the provider's own page: a full-page
                  // trip, never an iframe or a popup we could be blamed for.
                  onSuccess: (result) => {
                    window.location.href = result.url
                  },
                  onError,
                })
              }
            >
              <PlugZap className="size-4" aria-hidden="true" />
              {t('connections.connect')}
            </Button>
          ) : null}

          {status.connected ? (
            <>
              <Button
                variant="secondary"
                disabled={sync.isPending}
                onClick={() =>
                  sync.mutate(status.provider, {
                    onSuccess: () => toast.success('connections.syncQueued'),
                    onError,
                  })
                }
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {t('connections.syncNow')}
              </Button>

              {status.status === 'revoked' || status.status === 'expired' ? (
                <Button
                  onClick={() =>
                    authorize.mutate(status.provider, {
                      onSuccess: (result) => {
                        window.location.href = result.url
                      },
                      onError,
                    })
                  }
                >
                  <PlugZap className="size-4" aria-hidden="true" />
                  {t('connections.reconnect')}
                </Button>
              ) : null}

              <Button
                variant="ghost"
                onClick={() =>
                  disconnect.mutate(
                    { provider: status.provider, deleteRemote: false },
                    {
                      onSuccess: () => toast.success('connections.disconnected'),
                      onError,
                    },
                  )
                }
              >
                <Unplug className="size-4" aria-hidden="true" />
                {t('connections.disconnect')}
              </Button>

              <Button
                variant="ghost"
                onClick={() =>
                  disconnect.mutate(
                    { provider: status.provider, deleteRemote: true },
                    {
                      onSuccess: () => toast.success('connections.disconnected'),
                      onError,
                    },
                  )
                }
              >
                <CalendarCheck className="size-4" aria-hidden="true" />
                {t('connections.disconnectRemote')}
              </Button>
            </>
          ) : null}
        </div>

        {status.connected ? (
          <div className="rounded-control border border-border p-3">
            <div className="flex items-start gap-3">
              <input
                id={`busy-${status.provider}`}
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={status.busySyncEnabled}
                onChange={(event) =>
                  busy.mutate(
                    { provider: status.provider, enabled: event.target.checked },
                    {
                      onSuccess: () =>
                        toast.success(
                          event.target.checked
                            ? 'connections.busy.enabled'
                            : 'connections.busy.disabled',
                        ),
                      onError,
                    },
                  )
                }
              />
              <div>
                <label
                  htmlFor={`busy-${status.provider}`}
                  className="block text-sm font-medium text-text"
                >
                  {t('connections.busy.title')}
                </label>
                <p className="mt-1 text-xs text-text-muted">{t('connections.busy.description')}</p>
                <p className="mt-1 text-xs text-text-muted">{t('connections.busy.repeats')}</p>
              </div>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
