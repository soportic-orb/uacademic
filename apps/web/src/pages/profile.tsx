import { formatDate, formatPersonName } from '@uacademic/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSession } from '../auth/session'
import { CardSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError, apiJson } from '../lib/api'
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
