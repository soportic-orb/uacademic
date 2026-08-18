/**
 * Proposing a change to one of your own published classes.
 *
 * The form only offers what the type actually needs: a move asks for a day and
 * a time, a room change asks for a room. Everything else the ladder decides.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiFetch } from '../../lib/api'
import { useSessionStore } from '../../stores/session'
import { useCreateChange } from '../collaboration/queries'

const TYPES = ['session_move', 'space_change', 'session_cancel'] as const
type ChangeType = (typeof TYPES)[number]

interface OwnSession {
  id: string
  weekday: number
  startTime: string
  endTime: string
  label: string
  subjectName: string
  spaceId: string | null
  spaceName: string | null
}

interface SpaceRow {
  id: string
  name: string
  building: string | null
}

function useOwnSessions() {
  const centerId = useSessionStore((state) => state.centerId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['changes', 'sessions', centerId, mockUserEmail],
    queryFn: () => apiFetch<{ items: OwnSession[] }>('/api/v1/changes/sessions'),
    enabled: Boolean(centerId),
  })
}

function useSpaces() {
  const centerId = useSessionStore((state) => state.centerId)

  return useQuery({
    queryKey: ['spaces', centerId],
    queryFn: () => apiFetch<{ items: SpaceRow[] }>('/api/v1/admin/spaces?pageSize=100'),
    enabled: Boolean(centerId),
  })
}

export function ChangeForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const sessions = useOwnSessions()
  const spaces = useSpaces()
  const create = useCreateChange()

  const [form, setForm] = useState({
    type: 'session_move' as ChangeType,
    sessionId: '',
    weekday: '1',
    startTime: '',
    endTime: '',
    spaceId: '',
    reason: '',
  })

  const items = sessions.data?.items ?? []
  const selected = items.find((session) => session.id === form.sessionId)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()

    const proposal: Record<string, unknown> = {}
    if (form.type === 'session_move') {
      proposal.weekday = Number(form.weekday)
      if (form.startTime) proposal.startTime = form.startTime
      if (form.endTime) proposal.endTime = form.endTime
    }
    if (form.type === 'space_change') proposal.spaceId = form.spaceId || null

    create.mutate(
      {
        type: form.type,
        sessionId: form.sessionId,
        proposal,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
        submit: true,
      },
      {
        onSuccess: (created) => {
          toast.success('changes.done.submit')
          onCreated(created.id)
          setForm((current) => ({ ...current, reason: '' }))
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
    <Card>
      <CardHeader title={t('changes.create')} description={t('changes.subtitle')} />
      <CardBody>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('changes.form.type')}</span>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as ChangeType })}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`changes.type.${type}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('changes.form.session')}</span>
            <select
              required
              value={form.sessionId}
              onChange={(event) => {
                const session = items.find((item) => item.id === event.target.value)
                setForm({
                  ...form,
                  sessionId: event.target.value,
                  weekday: String(session?.weekday ?? 1),
                  startTime: session?.startTime ?? '',
                  endTime: session?.endTime ?? '',
                })
              }}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              <option value="">{t('common.none')}</option>
              {items.map((session) => (
                <option key={session.id} value={session.id}>
                  {`${session.label} · ${t(`weekday.${session.weekday}`)} ${session.startTime}`}
                </option>
              ))}
            </select>
          </label>

          {form.type === 'session_move' ? (
            <>
              <label className="text-sm">
                <span className="mb-1 block text-text-muted">{t('changes.form.weekday')}</span>
                <select
                  value={form.weekday}
                  onChange={(event) => setForm({ ...form, weekday: event.target.value })}
                  className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
                    <option key={weekday} value={weekday}>
                      {t(`weekday.${weekday}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-text-muted">{t('changes.form.startTime')}</span>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(event) => setForm({ ...form, startTime: event.target.value })}
                    className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-text-muted">{t('changes.form.endTime')}</span>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(event) => setForm({ ...form, endTime: event.target.value })}
                    className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
                  />
                </label>
              </div>
            </>
          ) : null}

          {form.type === 'space_change' ? (
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('changes.form.space')}</span>
              <select
                value={form.spaceId}
                onChange={(event) => setForm({ ...form, spaceId: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
              >
                <option value="">{t('common.none')}</option>
                {(spaces.data?.items ?? []).map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.building ? `${space.building} · ${space.name}` : space.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-text-muted">{t('changes.form.reason')}</span>
            <textarea
              rows={2}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-text"
            />
          </label>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending || !form.sessionId}>
              {t('changes.form.submit')}
            </Button>
            {selected ? (
              <p className="tabular mt-2 text-xs text-text-muted">
                {`${selected.subjectName} · ${selected.spaceName ?? t('common.none')}`}
              </p>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
