import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { Avatar } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

interface Recipient {
  id: string
  firstName: string
  lastName: string
  email: string
  avatarUrl: string | null
  centerName: string
  roles: string[]
}

/**
 * Starting a conversation.
 *
 * There was no way to: the screen listed the threads somebody was already in
 * and offered no door into a new one, so the only conversations that existed
 * were the ones the platform itself opened.
 *
 * Two scopes, because both are real — the people in this center, and the
 * people anywhere in the same university. The API decides who is in each;
 * this only asks.
 */
export function ComposeMessage({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const centerId = useSessionStore((state) => state.centerId)

  const [scope, setScope] = useState<'center' | 'university'>('center')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Recipient[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const params = new URLSearchParams({ scope })
  if (search.trim()) params.set('q', search.trim())

  const recipients = useQuery({
    queryKey: ['recipients', centerId, params.toString()],
    queryFn: () =>
      apiFetch<{ items: Recipient[] }>(`/api/v1/conversations/recipients?${params.toString()}`),
  })

  const send = useMutation({
    mutationFn: async () => {
      const ids = picked.map((person) => person.id)

      // One recipient is a direct conversation, which the server dedupes
      // against an existing one — writing to the same colleague twice should
      // continue the thread, not start a second one beside it.
      const conversation = await apiJson<{ id: string }>('/api/v1/conversations', 'POST', {
        type: ids.length === 1 ? 'direct' : 'group',
        ...(ids.length === 1 ? { userId: ids[0] } : { memberIds: ids }),
        ...(title.trim() ? { title: title.trim() } : {}),
      })

      await apiJson(`/api/v1/conversations/${conversation.id}/messages`, 'POST', { body })
      return conversation.id
    },
    onSuccess: async (conversationId) => {
      toast.success('messages.sent')
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      onClose()
      void navigate(`/messages/${conversationId}`)
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  const toggle = (person: Recipient) =>
    setPicked((current) =>
      current.some((entry) => entry.id === person.id)
        ? current.filter((entry) => entry.id !== person.id)
        : [...current, person],
    )

  return (
    <Card>
      <CardHeader title={t('messages.newTitle')} description={t('messages.newHint')} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-xs text-text-muted">{t('messages.scope')}</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as 'center' | 'university')}
              className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
            >
              <option value="center">{t('messages.scopeCenter')}</option>
              <option value="university">{t('messages.scopeUniversity')}</option>
            </select>
          </label>

          <label className="flex-1">
            <span className="sr-only">{t('common.search')}</span>
            <span className="relative flex items-center">
              <Search
                className="pointer-events-none absolute left-3 size-4 text-text-muted"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('messages.searchPeople')}
                className="h-10 w-full min-w-48 rounded-control border border-border bg-surface pl-9 pr-3 text-sm text-text"
              />
            </span>
          </label>
        </div>

        {picked.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {picked.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => toggle(person)}
                  className="flex items-center gap-2 rounded-control border border-border bg-surface px-2 py-1 text-xs text-text hover:border-danger"
                  aria-label={t('messages.removeRecipient', {
                    name: `${person.firstName} ${person.lastName}`,
                  })}
                >
                  <Avatar
                    name={`${person.firstName} ${person.lastName}`}
                    url={person.avatarUrl}
                    size="xs"
                  />
                  {person.firstName} {person.lastName}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-control border border-border">
          {(recipients.data?.items ?? []).map((person) => {
            const on = picked.some((entry) => entry.id === person.id)
            return (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => toggle(person)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted"
                >
                  <Avatar
                    name={`${person.firstName} ${person.lastName}`}
                    url={person.avatarUrl}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">
                      {person.firstName} {person.lastName}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {person.centerName}
                    </span>
                  </span>
                  {on ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                </button>
              </li>
            )
          })}
          {recipients.isSuccess && recipients.data.items.length === 0 ? (
            <li className="px-3 py-4 text-sm text-text-muted">{t('messages.noPeople')}</li>
          ) : null}
        </ul>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            send.mutate()
          }}
        >
          {picked.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-text">
                {t('messages.subject')}
              </span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-text">
              {t('messages.message')}
            </span>
            <textarea
              required
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="w-full rounded-control border border-border bg-surface p-3 text-sm text-text"
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" disabled={send.isPending || picked.length === 0 || !body.trim()}>
              {send.isPending ? t('common.saving') : t('common.send')}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
