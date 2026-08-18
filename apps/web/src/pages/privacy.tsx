/**
 * Privacy, as a screen rather than as a PDF nobody reads.
 *
 * Three things a person can actually do — take their data, ask for it to be
 * gone, see what is held and for how long — and one thing they should know
 * without going looking: what the assistant sends to a third party.
 *
 * The erasure card is deliberately honest about its limits. Promising that
 * everything disappears would be a lie: a university cannot forget who taught
 * a class or who approved a change, and saying so before somebody asks is
 * better than explaining it afterwards.
 */
import {
  ERASED_ON_REQUEST,
  KEPT_AFTER_ERASURE,
  PROCESSING_ACTIVITIES,
  activityBasisKey,
  activityLabelKey,
  activityPurposeKey,
  erasureLabelKey,
} from '@uacademic/shared'
import { useQuery } from '@tanstack/react-query'
import { Bot, Download, ShieldCheck, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError, apiDownload, apiFetch, apiJson } from '../lib/api'
import { useSessionStore } from '../stores/session'

interface ProcessingResponse {
  activities: {
    key: string
    tables: string[]
    retentionDays: number | null
    externalRecipient: string
  }[]
  contact: string
}

export function PrivacyPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const centerId = useSessionStore((state) => state.centerId)

  const processing = useQuery({
    queryKey: ['privacy-processing', centerId],
    queryFn: () => apiFetch<ProcessingResponse>('/api/v1/privacy/processing'),
    enabled: Boolean(centerId),
  })

  const fail = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const download = async () => {
    try {
      const blob = await apiDownload('/api/v1/me/export')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'uacademic-personal-data.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success('privacy.export.done')
    } catch (error) {
      fail(error)
    }
  }

  const requestErasure = async () => {
    try {
      await apiJson('/api/v1/me/erasure-request', 'POST', {})
      toast.success('privacy.erasure.requested')
    } catch (error) {
      fail(error)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('privacy.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('privacy.subtitle')}</p>
      </header>

      <Card className="max-w-3xl">
        <CardHeader title={t('privacy.export.title')} description={t('privacy.export.hint')} />
        <CardBody className="space-y-3">
          <Button onClick={() => void download()}>
            <Download className="size-4" aria-hidden="true" />
            {t('privacy.export.action')}
          </Button>
          <p className="text-xs text-text-muted">{t('privacy.export.excluded')}</p>
        </CardBody>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader title={t('privacy.erasure.title')} description={t('privacy.erasure.hint')} />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-text">{t('privacy.erasure.erased')}</h3>
              <ul className="mt-2 space-y-1 text-sm text-text-muted">
                {ERASED_ON_REQUEST.map((category) => (
                  <li key={category}>{t(erasureLabelKey(category))}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-text">{t('privacy.erasure.kept')}</h3>
              <ul className="mt-2 space-y-1 text-sm text-text-muted">
                {KEPT_AFTER_ERASURE.map((category) => (
                  <li key={category}>{t(erasureLabelKey(category))}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-muted">{t('privacy.erasure.keptWhy')}</p>
            </div>
          </div>

          <Button variant="secondary" onClick={() => void requestErasure()}>
            <Trash2 className="size-4 text-danger" aria-hidden="true" />
            {t('privacy.erasure.action')}
          </Button>
        </CardBody>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Bot className="size-4 text-primary" aria-hidden="true" />
              {t('privacy.ai.title')}
            </span>
          }
        />
        <CardBody>
          <p className="text-sm text-text-muted">{t('privacy.ai.body')}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              {t('privacy.activities.title')}
            </span>
          }
          description={t('privacy.activities.hint')}
        />
        <CardBody>
          {processing.isPending ? (
            <CardSkeleton />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('privacy.activities.title')}</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('privacy.activities.purpose')}
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('privacy.activities.basis')}
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('privacy.activities.recipient')}
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        {t('privacy.activities.retention')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PROCESSING_ACTIVITIES.map((activity) => {
                      const live = processing.data?.activities.find(
                        (entry) => entry.key === activity.key,
                      )

                      return (
                        <tr key={activity.key} className="border-b border-border last:border-0">
                          <td className="py-3 pr-4">
                            <p className="font-medium text-text">
                              {t(activityLabelKey(activity.key))}
                            </p>
                            <p className="text-xs text-text-muted">
                              {t(activityPurposeKey(activity.key))}
                            </p>
                            <p className="mt-1 font-mono text-[11px] text-text-muted">
                              {activity.tables.join(', ')}
                            </p>
                          </td>
                          <td className="py-3 pr-4 text-text-muted">
                            {t(activityBasisKey(activity.key))}
                          </td>
                          <td className="py-3 pr-4 text-text-muted">
                            {t(`privacy.activities.recipients.${activity.externalRecipient}`)}
                          </td>
                          <td className="py-3 tabular-nums text-text-muted">
                            {live?.retentionDays
                              ? t('privacy.activities.days', { count: live.retentionDays })
                              : t('privacy.activities.keeps')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 text-xs text-text-muted">
                {processing.data?.contact
                  ? t('privacy.activities.contact', { contact: processing.data.contact })
                  : t('privacy.activities.noContact')}
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
