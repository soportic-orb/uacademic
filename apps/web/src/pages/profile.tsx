import { formatDate, formatPersonName } from '@uacademic/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSession } from '../auth/session'
import { CardSkeleton } from '../components/feedback/states'
import { Avatar } from '../components/ui/avatar'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError, apiFetch, apiJson, apiUpload } from '../lib/api'
import { currentLocale } from '../i18n'

/**
 * Sign-in is SSO, so there is no "change password" for ordinary users: the
 * profile shows the linked Microsoft account instead. The password section
 * exists only for the local superadmin account.
 */
export function ProfilePage() {
  const { t } = useTranslation()
  const { user, isLoading } = useSession()
  const locale = currentLocale()

  if (isLoading) return <CardSkeleton />
  if (!user) return null

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('nav.profile')}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {formatPersonName(user.firstName, user.lastName)}
        </p>
      </header>

      <PhotoCard
        name={formatPersonName(user.firstName, user.lastName)}
        avatarUrl={user.avatarUrl}
      />

      {user.microsoftAccount ? (
        <Card className="max-w-2xl">
          <CardHeader title={t('auth.linkedAccount')} description={t('auth.linkedAccountHint')} />
          <CardBody>
            <dl className="divide-y divide-border">
              <Row label={t('auth.email')} value={user.microsoftAccount.username ?? user.email} />
              <Row label={t('auth.tenant')} value={user.microsoftAccount.tenantId} mono />
              <Row label={t('auth.objectId')} value={user.microsoftAccount.objectId} mono />
              <Row
                label={t('auth.sessionExpires')}
                value={formatDate(locale, new Date(user.expiresAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              />
            </dl>
          </CardBody>
        </Card>
      ) : (
        <LocalPasswordCard />
      )}

      <Card className="max-w-2xl">
        <CardHeader title={t('admin.roles')} />
        <CardBody>
          <ul className="space-y-2">
            {user.memberships.map((membership) => (
              <li
                key={`${membership.centerId}-${membership.role}`}
                className="flex items-center justify-between rounded-control border border-border px-3 py-2 text-sm"
              >
                <span className="text-text">{membership.centerName}</span>
                <span className="text-text-muted">{t(`roles.${membership.role}`)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  )
}

/**
 * The photograph, which is the one piece of the profile the person owns
 * outright: they put it there and they can take it away.
 */
function PhotoCard({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  // The session carries the URL, so refreshing it is what puts the new face in
  // the header and everywhere else this person is drawn.
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['session'] })
  }

  const fail = (error: unknown) => {
    if (error instanceof ApiRequestError) {
      const key = error.details[0]?.messageKey
      if (key) toast.error(key)
      else toast.raw({ variant: 'error', message: error.localizedMessage })
    } else {
      toast.error('errors.generic')
    }
  }

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await apiUpload('/api/v1/me/avatar', form)
      await refresh()
      toast.success('images.photoUpdated')
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await apiFetch('/api/v1/me/avatar', { method: 'DELETE' })
      await refresh()
      toast.success('images.photoRemoved')
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title={t('images.photo')} description={t('images.photoHint')} />
      <CardBody>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={name} url={avatarUrl} size="lg" />

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
              {avatarUrl ? t('images.changePhoto') : t('images.uploadPhoto')}
            </Button>
            {avatarUrl ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t('images.removePhoto')}
              </Button>
            ) : null}
          </div>

          {/*
            The visible control is the button: a bare file input cannot be
            styled and reads badly, and the label here is what assistive
            technology announces for the input itself.
          */}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label={t('images.uploadPhoto')}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
            }}
          />
        </div>
      </CardBody>
    </Card>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-xs text-text' : 'text-sm text-text'}>{value}</dd>
    </div>
  )
}

/** Only reachable for the local superadmin: everyone else signs in with SSO. */
function LocalPasswordCard() {
  const { t } = useTranslation()
  const toast = useToast()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await apiJson('/api/v1/auth/local/password', 'POST', form)
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      toast.success('auth.passwordChanged')
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const key = error.details[0]?.messageKey
        if (key) toast.error(key)
        else toast.raw({ variant: 'error', message: error.localizedMessage })
      } else {
        toast.error('errors.generic')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title={t('auth.changePassword')} />
      <CardBody>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          {(
            [
              ['currentPassword', t('auth.currentPassword'), 'current-password'],
              ['newPassword', t('auth.newPassword'), 'new-password'],
              ['confirmPassword', t('auth.confirmPassword'), 'new-password'],
            ] as const
          ).map(([field, label, autoComplete]) => (
            <label key={field} className="block">
              <span className="mb-1 block text-sm font-medium text-text">{label}</span>
              <input
                type="password"
                required
                autoComplete={autoComplete}
                value={form[field]}
                onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
              />
            </label>
          ))}

          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
