/**
 * Cady, from the platform administrator's side.
 *
 * Three things in one screen because they are one job: the switch that decides
 * whether she exists at all, everything people have asked her, and the
 * articles she answers from. The middle one is what makes the last one worth
 * writing — the questions she could not answer are the list of what the help
 * is missing, and there is a button on each of them that starts the article.
 */
import type { Role } from '@uacademic/shared'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError } from '../lib/api'
import { currentLocale } from '../i18n'
import {
  type AdminConversation,
  type SupportArticleDto,
  useAdminConversations,
  useDeleteSupportArticle,
  useSaveSupportArticle,
  useSaveSupportSettings,
  useSupportArticles,
  useSupportSettings,
} from '../features/support/queries'

const ROLES: Role[] = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER']
const LOCALES = ['ca', 'es', 'en'] as const

const CONTROL = 'h-9 w-full rounded-control border border-border bg-surface px-2 text-sm text-text'

export function SupportAdminPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('support.admin.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('support.admin.subtitle')}</p>
      </header>

      <SettingsCard />
      <ConversationsCard />
      <ArticlesCard />
    </div>
  )
}

function SettingsCard() {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useSupportSettings()
  const save = useSaveSupportSettings()

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const settings = query.data

  const change = (values: Partial<typeof settings>) =>
    save.mutate(values, {
      onSuccess: () => toast.success('support.admin.saved'),
      onError: (error) => {
        if (error instanceof ApiRequestError)
          toast.raw({ variant: 'error', message: error.localizedMessage })
        else toast.error('errors.generic')
      },
    })

  return (
    <Card>
      <CardHeader title={t('support.admin.enabled')} description={t('support.admin.enabledHint')} />
      <CardBody className="space-y-4">
        {!settings.configured ? (
          <p
            role="status"
            className="rounded-control border border-warning/30 bg-warning/10 p-3 text-sm text-text"
          >
            {t('support.admin.notConfigured')}
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => change({ enabled: event.target.checked })}
            className="size-4 rounded-sm border-border"
          />
          {t('support.admin.enabled')}
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">
              {t('support.admin.maxOutputTokens')}
            </span>
            <input
              type="number"
              min={256}
              max={8000}
              step={64}
              defaultValue={settings.maxOutputTokens}
              onBlur={(event) => change({ maxOutputTokens: Number(event.target.value) })}
              className={`${CONTROL} tabular-nums`}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">
              {t('support.admin.historyMessages')}
            </span>
            <input
              type="number"
              min={0}
              max={40}
              defaultValue={settings.historyMessages}
              onBlur={(event) => change({ historyMessages: Number(event.target.value) })}
              className={`${CONTROL} tabular-nums`}
            />
          </label>
        </div>
      </CardBody>
    </Card>
  )
}

function ConversationsCard() {
  const { t } = useTranslation()
  const [uncoveredOnly, setUncoveredOnly] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const query = useAdminConversations(uncoveredOnly)

  return (
    <Card>
      <CardHeader
        title={t('support.admin.conversations')}
        description={t('support.admin.conversationsHint')}
        action={
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={uncoveredOnly}
              onChange={(event) => setUncoveredOnly(event.target.checked)}
              className="size-4 rounded-sm border-border"
            />
            {t('support.admin.uncoveredOnly')}
          </label>
        }
      />
      <CardBody>
        {query.isPending ? (
          <CardSkeleton />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <p className="text-sm italic text-text-muted">{t('support.admin.noConversations')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {query.data.items.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                open={openId === conversation.id}
                onToggle={() =>
                  setOpenId((current) => (current === conversation.id ? null : conversation.id))
                }
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function ConversationRow({
  conversation,
  open,
  onToggle,
}: {
  conversation: AdminConversation
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const when = new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(conversation.lastMessageAt))

  return (
    <li className="py-3">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium text-text">{conversation.title}</span>
          <span className="tabular-nums text-xs text-text-muted">{when}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span>{conversation.userName}</span>
          <span>·</span>
          <span>{t(`roles.${conversation.role}`)}</span>
          {conversation.centerName ? (
            <>
              <span>·</span>
              <span>{conversation.centerName}</span>
            </>
          ) : null}
          {conversation.uncovered ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
              {t('support.admin.uncovered')}
            </span>
          ) : null}
          {conversation.unhelpful ? (
            <span className="rounded-full bg-danger/15 px-2 py-0.5 text-danger">
              {t('support.admin.unhelpful')}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-2 border-l-2 border-border pl-3">
          {conversation.messages.map((message) => (
            <div key={message.id}>
              <p className="text-xs font-medium text-text-muted">
                {message.role === 'user' ? conversation.userName : 'Cady'}
              </p>
              <p className="whitespace-pre-wrap text-sm text-text">{message.content}</p>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  )
}

function ArticlesCard() {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useSupportArticles()
  const remove = useDeleteSupportArticle()
  const [editing, setEditing] = useState<SupportArticleDto | 'new' | null>(null)

  return (
    <Card>
      <CardHeader
        title={t('support.admin.articles')}
        description={t('support.admin.articlesHint')}
        action={
          <Button variant="secondary" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden="true" />
            {t('support.admin.newArticle')}
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {editing ? (
          <ArticleForm
            article={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}

        {query.isPending ? (
          <CardSkeleton />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <p className="text-sm italic text-text-muted">{t('support.admin.noArticles')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {query.data.items.map((article) => (
              <li key={article.id} className="flex items-baseline justify-between gap-2 py-2">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => setEditing(article)}
                >
                  <span className="block truncate font-medium text-text">
                    {article.content[currentLocale() as 'ca' | 'es' | 'en']?.title ?? article.slug}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {article.slug} · {article.roles.map((role) => t(`roles.${role}`)).join(', ')}
                    {article.enabled ? '' : ` · ${t('common.no')}`}
                  </span>
                </button>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('support.admin.deleteArticle', { slug: article.slug })}
                  onClick={() =>
                    remove.mutate(article.id, {
                      onSuccess: () => toast.success('support.admin.articleDeleted'),
                    })
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

const EMPTY_CONTENT = {
  ca: { title: '', body: '' },
  es: { title: '', body: '' },
  en: { title: '', body: '' },
}

function ArticleForm({
  article,
  onDone,
}: {
  article: SupportArticleDto | null
  onDone: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveSupportArticle()

  const [slug, setSlug] = useState(article?.slug ?? '')
  const [roles, setRoles] = useState<Role[]>(article?.roles ?? ['TEACHER'])
  const [enabled, setEnabled] = useState(article?.enabled ?? true)
  const [content, setContent] = useState(article?.content ?? EMPTY_CONTENT)

  const submit = () => {
    save.mutate(
      { ...(article ? { id: article.id } : {}), values: { slug, roles, enabled, content } },
      {
        onSuccess: () => {
          toast.success('support.admin.articleSaved')
          onDone()
        },
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )
  }

  return (
    <form
      className="space-y-4 rounded-card border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-muted">{t('support.admin.slug')}</span>
          <input
            required
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className={CONTROL}
          />
        </label>

        <fieldset className="text-sm">
          <legend className="mb-1 text-xs text-text-muted">{t('support.admin.roles')}</legend>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((role) => (
              <label key={role} className="flex items-center gap-1 text-xs text-text">
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={(event) =>
                    setRoles((current) =>
                      event.target.checked
                        ? [...current, role]
                        : current.filter((entry) => entry !== role),
                    )
                  }
                  className="size-4 rounded-sm border-border"
                />
                {t(`roles.${role}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* All three languages in one form: an article missing one is a question
          Cady cannot answer for a third of the platform (R1). */}
      {LOCALES.map((locale) => (
        <div key={locale} className="space-y-2">
          <p className="text-xs font-medium uppercase text-text-muted">{locale}</p>
          <label className="block text-sm">
            <span className="sr-only">{`${t('support.admin.articleTitle')} · ${locale}`}</span>
            <input
              required
              value={content[locale].title}
              placeholder={t('support.admin.articleTitle')}
              onChange={(event) =>
                setContent({
                  ...content,
                  [locale]: { ...content[locale], title: event.target.value },
                })
              }
              className={CONTROL}
            />
          </label>
          <label className="block text-sm">
            <span className="sr-only">{`${t('support.admin.articleBody')} · ${locale}`}</span>
            <textarea
              required
              rows={3}
              value={content[locale].body}
              placeholder={t('support.admin.articleBody')}
              onChange={(event) =>
                setContent({
                  ...content,
                  [locale]: { ...content[locale], body: event.target.value },
                })
              }
              className="w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text"
            />
          </label>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 rounded-sm border-border"
          />
          {t('support.admin.articleEnabled')}
        </label>

        <div className="flex gap-2">
          <Button variant="secondary" type="button" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </form>
  )
}
