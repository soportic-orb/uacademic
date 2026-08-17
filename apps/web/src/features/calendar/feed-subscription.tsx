/**
 * The subscribable calendar address.
 *
 * The URL is a bearer capability: it is shown once, the server keeps only its
 * hash, and revoking it is one click. The warning is not decoration — anyone
 * holding the link can read the timetable, so the screen says so plainly.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'

interface FeedStatus {
  active: boolean
  id: string | null
  createdAt: string | null
  lastFetchedAt: string | null
}

export function FeedSubscription() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [url, setUrl] = useState<string | null>(null)

  const status = useQuery({
    queryKey: ['calendar-feed'],
    queryFn: () => apiFetch<FeedStatus>('/api/v1/calendar/feed'),
  })

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const create = useMutation({
    mutationFn: () => apiJson<{ id: string; url: string }>('/api/v1/calendar/feed', 'POST', {}),
    onSuccess: async (result) => {
      setUrl(result.url)
      await queryClient.invalidateQueries({ queryKey: ['calendar-feed'] })
    },
    onError,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/calendar/feed/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setUrl(null)
      toast.success('calendar.subscribe.revoked')
      await queryClient.invalidateQueries({ queryKey: ['calendar-feed'] })
    },
    onError,
  })

  return (
    <Card>
      <CardHeader
        title={t('calendar.subscribe.title')}
        description={t('calendar.subscribe.description')}
        action={
          <Button variant="secondary" onClick={() => create.mutate()} disabled={create.isPending}>
            <Link2 className="size-4" aria-hidden="true" />
            {t('calendar.subscribe.create')}
          </Button>
        }
      />

      <CardBody className="space-y-3">
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
              {t('calendar.subscribe.copy')}
            </Button>
          </div>
        ) : status.data?.active ? (
          <p className="text-sm text-text-muted">{t('calendar.subscribe.description')}</p>
        ) : (
          <p className="text-sm text-text-muted">{t('calendar.subscribe.none')}</p>
        )}

        <p className="text-xs text-warning">{t('calendar.subscribe.warning')}</p>

        {status.data?.active && status.data.id ? (
          <Button
            variant="ghost"
            onClick={() => {
              if (!window.confirm(t('calendar.subscribe.revokeConfirm'))) return
              revoke.mutate(status.data!.id!)
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
