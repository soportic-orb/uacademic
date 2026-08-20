/**
 * The assistant's own screen: the same panel, plus the conversations it has
 * already had. The panel itself is what appears next to planning and load —
 * one implementation, so an answer never depends on where it was asked from.
 */
import { formatDate } from '@uacademic/shared'
import { MessagesSquare, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRoles } from '../app/use-roles'
import { EmptyState } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { AssistantPanel } from '../features/assistant/assistant-panel'
import { useAssistantStatus, useConversations } from '../features/assistant/queries'
import { currentLocale } from '../i18n'

export function AssistantPage() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const roles = useRoles()
  const status = useAssistantStatus()
  const conversations = useConversations()
  const [open, setOpen] = useState(true)

  if (!roles.includes('COORDINATOR') && !roles.includes('CENTER_ADMIN')) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-text">{t('assistant.title')}</h1>
        </header>
        <EmptyState title={t('assistant.restricted')} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('assistant.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('assistant.subtitle')}</p>
        </div>

        {/*
          Closing the panel used to be a one-way door: nothing on the screen
          opened it again, and the only way back was to leave and return.
        */}
        {open ? null : (
          <Button onClick={() => setOpen(true)}>
            <Sparkles className="size-4" aria-hidden="true" />
            {t('assistant.reopen')}
          </Button>
        )}
      </header>

      {status.data && !status.data.available ? (
        <Card>
          <CardBody>
            <p className="text-sm text-text-muted">
              {status.data.configured
                ? t('assistant.errors.disabled')
                : t('assistant.errors.unavailable')}
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t('assistant.history')} />
        <CardBody>
          {(conversations.data?.items ?? []).length === 0 ? (
            <EmptyState
              title={t('assistant.emptyTitle')}
              description={t('assistant.emptyHint')}
              icon={<MessagesSquare className="size-8" aria-hidden="true" />}
            />
          ) : (
            <ul className="divide-y divide-border">
              {(conversations.data?.items ?? []).map((conversation) => (
                <li key={conversation.id} className="py-2">
                  <p className="truncate text-sm text-text">{conversation.title}</p>
                  <p className="tabular text-xs text-text-muted">
                    {[
                      conversation.subjectCode,
                      formatDate(locale, new Date(conversation.lastMessageAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <AssistantPanel open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
