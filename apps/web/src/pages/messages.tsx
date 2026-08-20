/**
 * Messaging: conversations on the left, the open thread on the right, and a
 * search that reaches every message the reader is allowed to see.
 *
 * Unread first, then most recent — the order is the pure `sortConversations`
 * the API applies, so both ends agree on what "top of the list" means.
 */
import { MessageSquare, PenSquare, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'

import { EmptyState, ErrorState, TableSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useConversations, useMessageSearch } from '../features/collaboration/queries'
import { ComposeMessage } from '../features/messaging/compose'
import { ThreadView } from '../features/messaging/thread-view'

export function MessagesPage() {
  const { t } = useTranslation()
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const conversations = useConversations()
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const search = useMessageSearch(query)

  const items = conversations.data?.items ?? []
  const current = params.id ?? items[0]?.id ?? null

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-text">{t('messages.title')}</h1>

        {/*
          The screen listed the threads somebody was already in and had no door
          into a new one, so the only conversations that existed were the ones
          the platform opened by itself.
        */}
        <Button onClick={() => setComposing(true)}>
          <PenSquare className="size-4" aria-hidden="true" />
          {t('messages.newTitle')}
        </Button>
      </header>

      {composing ? <ComposeMessage onClose={() => setComposing(false)} /> : null}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="sr-only">{t('messages.search')}</span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                placeholder={t('messages.search')}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-control border border-border bg-surface pl-9 pr-3 text-text"
              />
            </span>
          </label>

          {query.trim().length >= 2 ? (
            <Card>
              <CardHeader title={t('messages.search')} />
              <CardBody>
                {search.isPending ? <TableSkeleton rows={3} columns={2} /> : null}
                {search.data && search.data.items.length === 0 ? (
                  <p className="text-sm text-text-muted">{t('messages.searchEmpty')}</p>
                ) : null}
                <ul className="divide-y divide-border">
                  {(search.data?.items ?? []).map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="w-full rounded-control px-2 py-2 text-left hover:bg-surface-muted"
                        onClick={() => void navigate(`/messages/${hit.conversationId}`)}
                      >
                        <span className="block truncate text-sm text-text">{hit.body}</span>
                        <span className="block text-xs text-text-muted">{hit.senderName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t('messages.conversations')} />
            <CardBody>
              {conversations.isPending ? <TableSkeleton rows={4} columns={2} /> : null}
              {conversations.isError ? (
                <ErrorState onRetry={() => void conversations.refetch()} />
              ) : null}
              {conversations.data && items.length === 0 ? (
                <EmptyState
                  title={t('messages.empty.title')}
                  description={t('messages.empty.description')}
                  icon={<MessageSquare className="size-8" aria-hidden="true" />}
                />
              ) : null}

              {items.length > 0 ? (
                <ul className="divide-y divide-border">
                  {items.map((conversation) => (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        aria-current={current === conversation.id}
                        onClick={() => void navigate(`/messages/${conversation.id}`)}
                        className={`w-full rounded-control px-2 py-3 text-left hover:bg-surface-muted ${
                          current === conversation.id ? 'bg-surface-muted' : ''
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-text">
                            {conversation.title ?? t(`messages.types.${conversation.type}`)}
                          </span>
                          {conversation.unread > 0 ? (
                            <span
                              className="tabular rounded-full bg-primary px-2 text-xs text-primary-contrast"
                              aria-label={t('common.unread')}
                            >
                              {conversation.unread}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-text-muted">
                          {conversation.lastMessage ?? t(`messages.types.${conversation.type}`)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
        </div>

        {current ? (
          <ThreadView key={current} conversationId={current} />
        ) : (
          <EmptyState
            title={t('messages.empty.title')}
            description={t('messages.empty.description')}
          />
        )}
      </div>
    </div>
  )
}
