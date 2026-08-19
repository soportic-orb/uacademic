/**
 * The platform panel: what is running, what is available, and one button.
 *
 * The line that matters most on this screen is the one about teachers: the
 * update does not interrupt anybody. The service worker picks the new version
 * up quietly and applies it at the next start, so somebody writing a message
 * while this button is pressed loses nothing and notices nothing.
 *
 * The update itself takes a minute or two — download, checksum, database
 * backup, migrations, symlink, reload, health check — and the API answers when
 * it is over, having already rolled back if the new version did not come up.
 */
import { formatDate } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Download, History, Info, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { currentLocale } from '../i18n'
import { ApiRequestError, apiFetch, apiJson } from '../lib/api'

interface PlatformStatus {
  configured: boolean
  currentVersion: string | null
  runningVersion: string | null
  releasePath: string
  checkedAt: string
  available: { version: string; changelog: string; publishedAt: string } | null
  updateAvailable: boolean
  history: {
    version: string
    status: 'available' | 'applying' | 'applied' | 'failed' | 'rolled_back'
    appliedAt: string | null
    changelog: string | null
  }[]
}

interface UpdateResult {
  version: string
  status: 'applied' | 'failed' | 'rolled_back'
  backupFile?: string
  error?: string
}

export function PlatformPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const queryClient = useQueryClient()

  const status = useQuery({
    queryKey: ['platform-version'],
    queryFn: () => apiFetch<PlatformStatus>('/api/v1/platform/version'),
    retry: false,
  })

  const update = useMutation({
    mutationFn: () => apiJson<UpdateResult>('/api/v1/platform/update', 'POST', {}),
    onSuccess: async (result) => {
      if (result.status === 'applied') {
        toast.success('platform.applied', { params: { version: result.version } })
      } else if (result.status === 'rolled_back') {
        toast.error('platform.rolledBack', { durationMs: 12_000 })
      } else {
        toast.error('platform.failed', { durationMs: 12_000 })
      }
      await queryClient.invalidateQueries({ queryKey: ['platform-version'] })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  if (status.isPending) return <CardSkeleton />
  if (status.isError) return <ErrorState onRetry={() => void status.refetch()} />

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('platform.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('platform.subtitle')}</p>
      </header>

      <Card className="max-w-3xl">
        <CardHeader
          title={t('platform.installed')}
          description={
            status.data.runningVersion ?? status.data.currentVersion ?? t('platform.unknown')
          }
        />
        <CardBody className="space-y-4">
          {/*
            Where the running code came from. It reads like a detail and is the
            opposite: a process left running from an old release directory
            looks identical to a healthy one from every other angle.
          */}
          <dl className="grid gap-1 text-xs text-text-muted sm:grid-cols-[auto_1fr] sm:gap-x-3">
            <dt>{t('platform.releasePath')}</dt>
            <dd className="break-all font-mono">{status.data.releasePath}</dd>
            {status.data.currentVersion &&
            status.data.currentVersion !== status.data.runningVersion ? (
              <>
                <dt>{t('platform.lastInstalled')}</dt>
                <dd>{status.data.currentVersion}</dd>
              </>
            ) : null}
          </dl>

          {!status.data.configured ? (
            <p className="rounded-control border border-border bg-surface-muted p-3 text-sm text-text-muted">
              {t('platform.errors.notConfigured')}
            </p>
          ) : status.data.updateAvailable && status.data.available ? (
            <>
              <div>
                <p className="text-sm font-medium text-text">
                  {t('platform.available')}: {status.data.available.version}
                </p>
                <p className="text-xs text-text-muted">
                  {formatDate(locale, new Date(status.data.available.publishedAt), {
                    dateStyle: 'long',
                  })}
                </p>
              </div>

              {status.data.available.changelog ? (
                <div>
                  <h3 className="text-sm font-semibold text-text">{t('platform.changelog')}</h3>
                  <pre className="mt-1 whitespace-pre-wrap rounded-control border border-border bg-surface-muted p-3 font-sans text-xs text-text">
                    {status.data.available.changelog}
                  </pre>
                </div>
              ) : null}

              <p className="flex items-start gap-2 text-xs text-text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                {t('platform.invisible')}
              </p>

              <Button disabled={update.isPending} onClick={() => update.mutate()}>
                {update.isPending ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                {update.isPending ? t('platform.updating') : t('platform.update')}
              </Button>
            </>
          ) : !status.data.available ? (
            // Configured, reachable, and the repository has published nothing.
            // Saying "you are up to date" here claims a comparison that never
            // happened.
            <p className="flex items-start gap-2 text-sm text-text-muted">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              {t('platform.noReleases')}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-success">
              <CircleCheck className="size-4" aria-hidden="true" />
              {t('platform.upToDate')}
            </p>
          )}

          {status.data.configured ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <Button
                variant="secondary"
                disabled={status.isFetching}
                onClick={() => void status.refetch()}
              >
                {status.isFetching ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
                {t('platform.check')}
              </Button>
              <p className="text-xs text-text-muted">
                {t('platform.checkedAt', {
                  at: formatDate(locale, new Date(status.data.checkedAt), {
                    timeStyle: 'short',
                  }),
                })}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <History className="size-4 text-text-muted" aria-hidden="true" />
              {t('platform.history')}
            </span>
          }
        />
        <CardBody>
          {status.data.history.length === 0 ? (
            <p className="text-sm text-text-muted">{t('platform.noHistory')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {status.data.history.map((entry) => (
                <li key={entry.version} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-text">{entry.version}</span>
                  <span className="flex items-center gap-3 text-xs text-text-muted">
                    {entry.appliedAt
                      ? formatDate(locale, new Date(entry.appliedAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : null}
                    <span
                      className={`rounded-control border px-2 py-0.5 ${
                        entry.status === 'applied'
                          ? 'border-success/30 bg-success/10 text-success'
                          : entry.status === 'failed' || entry.status === 'rolled_back'
                            ? 'border-danger/30 bg-danger/10 text-danger'
                            : 'border-border bg-surface-muted'
                      }`}
                    >
                      {t(`platform.status.${entry.status}`)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
