/**
 * The subscription: one address, revocable, plus the instructions for the four
 * clients people actually use — and the warning about Google, which re-reads a
 * feed on its own schedule and cannot be hurried.
 *
 * The address is a bearer capability: shown once, stored as a hash, revoked in
 * one click. Changing what it carries does not change the address, because a
 * feed nobody re-adds in four clients is a feed that goes stale.
 */
import { AlertTriangle, Copy, Link2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { LatencyNote } from './latency-note'
import {
  type FeedFilters,
  type FeedStatus,
  useCreateFeed,
  useRevokeFeed,
  useSaveFilters,
} from './queries'

const CLIENTS = ['apple', 'google', 'outlook', 'thunderbird'] as const

export function FeedCard({ feed }: { feed: FeedStatus }) {
  const { t } = useTranslation()
  const toast = useToast()
  const create = useCreateFeed()
  const revoke = useRevokeFeed()
  const save = useSaveFilters(feed.id)
  const [url, setUrl] = useState<string | null>(null)
  const [filters, setFilters] = useState<FeedFilters>(feed.filters)

  useEffect(() => setFilters(feed.filters), [feed.filters])

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  return (
    <Card>
      <CardHeader
        title={t('connections.feed.title')}
        description={t('connections.levels.icsHint')}
        action={
          <Button
            variant="secondary"
            disabled={create.isPending}
            onClick={() =>
              create.mutate(filters, {
                onSuccess: (result) => setUrl(result.url),
                onError,
              })
            }
          >
            <Link2 className="size-4" aria-hidden="true" />
            {t('calendar.subscribe.create')}
          </Button>
        }
      />

      <CardBody className="space-y-4">
        {url ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="mb-1 block text-xs text-text-muted">
                {t('calendar.subscribe.url')}
              </span>
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="h-10 w-full rounded-control border border-border bg-surface-muted px-3 font-mono text-xs text-text"
              />
            </label>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(url)
                toast.success('calendar.subscribe.copied')
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
              {t('common.copy')}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            {feed.active ? t('calendar.subscribe.description') : t('calendar.subscribe.none')}
          </p>
        )}

        <p className="text-xs text-warning">{t('calendar.subscribe.warning')}</p>

        <fieldset className="rounded-control border border-border p-3">
          <legend className="px-1 text-xs font-medium text-text">
            {t('connections.feed.filters')}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={Boolean(filters.includeColleagues)}
              onChange={(event) => {
                const next = { ...filters, includeColleagues: event.target.checked }
                setFilters(next)
                if (feed.id) {
                  save.mutate(next, {
                    onSuccess: () => toast.success('connections.feed.saved'),
                    onError,
                  })
                }
              }}
            />
            {t('connections.feed.includeColleagues')}
          </label>
        </fieldset>

        <section>
          <h3 className="text-sm font-medium text-text">{t('connections.feed.instructions')}</h3>
          <ul className="mt-2 space-y-2 text-xs text-text-muted">
            {CLIENTS.map((client) => (
              <li key={client}>
                <span className="font-medium text-text">
                  {t(`connections.feed.steps.${client}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium text-text">{t('connections.clients.apple')}</p>
            <LatencyNote latency={feed.latency.apple} />
          </div>
          <div>
            <p className="text-xs font-medium text-text">{t('connections.clients.outlook')}</p>
            <LatencyNote latency={feed.latency.outlook} />
          </div>
          <div>
            <p className="text-xs font-medium text-text">{t('connections.clients.google')}</p>
            <LatencyNote latency={feed.latency.google} />
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/10 p-3 text-xs text-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {t('connections.feed.googleWarning')}
        </p>

        {feed.active && feed.id ? (
          <Button
            variant="ghost"
            onClick={() => {
              if (!window.confirm(t('calendar.subscribe.revokeConfirm'))) return
              revoke.mutate(feed.id!, {
                onSuccess: () => {
                  setUrl(null)
                  toast.success('calendar.subscribe.revoked')
                },
                onError,
              })
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t('calendar.subscribe.revoke')}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  )
}
