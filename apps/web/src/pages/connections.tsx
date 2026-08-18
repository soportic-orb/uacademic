/**
 * Calendar connections: three levels, and an honest account of what each one
 * can promise.
 *
 * The order on screen is the order of usefulness — the subscription works
 * everywhere and is slowest, Microsoft is the recommended one because the
 * login is already Entra ID, Google exists because its subscriptions are too
 * slow for a same-day change. Apple gets an explanation rather than a button:
 * iCloud has no public calendar API and we will not ask anyone for an
 * app-specific password.
 */
import { Info } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'

import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { FeedCard } from '../features/connections/feed-card'
import { ProviderCard } from '../features/connections/provider-card'
import { useConnections, useFeed } from '../features/connections/queries'
import { useToast } from '../hooks/use-toast'

export function ConnectionsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const connections = useConnections()
  const feed = useFeed()
  const [params, setParams] = useSearchParams()

  // The provider sends the browser back here after the consent screen.
  const connected = params.get('connected')
  const failed = params.get('error')

  useEffect(() => {
    if (!connected && !failed) return

    if (connected) toast.success('connections.connected')
    else toast.error('connections.errors.connectFailed')

    setParams({}, { replace: true })
  }, [connected, failed, setParams, toast])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('connections.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('connections.subtitle')}</p>
      </header>

      {connections.isPending || feed.isPending ? <CardSkeleton /> : null}
      {connections.isError ? <ErrorState onRetry={() => void connections.refetch()} /> : null}

      {feed.data ? <FeedCard feed={feed.data} /> : null}

      {connections.data?.providers.map((provider) => (
        <ProviderCard key={provider.provider} status={provider} />
      ))}

      <Card>
        <CardHeader title={t('connections.apple.title')} />
        <CardBody>
          <p className="flex items-start gap-2 text-sm text-text-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('connections.apple.body')}
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
