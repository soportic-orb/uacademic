import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'

import { isEntraConfigured } from '../auth/msal'
import { useSession } from '../auth/session'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError } from '../lib/api'

/**
 * Two doors: Microsoft for everyone, and a local one for the platform
 * superadmin so the product stays reachable when Entra ID is not.
 */
export function LoginPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { signInWithEntra, signInLocally, isAuthenticated } = useSession()
  const location = useLocation()
  const [showLocal, setShowLocal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', totp: '' })

  // Signing in lands wherever the guard bounced from, or on the dashboard.
  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }

  const handleError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const onMicrosoft = async () => {
    setBusy(true)
    try {
      await signInWithEntra()
    } catch (error) {
      handleError(error)
    } finally {
      setBusy(false)
    }
  }

  const onLocal = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await signInLocally({
        email: form.email,
        password: form.password,
        ...(form.totp ? { totp: form.totp } : {}),
      })
    } catch (error) {
      handleError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center">
          <p className="text-2xl font-semibold text-primary">{t('common.appName')}</p>
          <h1 className="mt-6 text-xl font-semibold text-text">{t('auth.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('auth.subtitle')}</p>
        </header>

        <Card>
          <CardBody className="space-y-4">
            <Button
              className="w-full"
              size="lg"
              onClick={() => void onMicrosoft()}
              disabled={busy || !isEntraConfigured()}
            >
              {busy ? t('auth.signingIn') : t('auth.signInWithMicrosoft')}
            </Button>

            <Button
              variant="link"
              className="w-full"
              onClick={() => setShowLocal((open) => !open)}
              aria-expanded={showLocal}
            >
              {t('auth.localAccess')}
            </Button>
          </CardBody>
        </Card>

        {showLocal ? (
          <Card>
            <CardHeader title={t('auth.localAccess')} description={t('auth.localAccessHint')} />
            <CardBody>
              <form className="space-y-4" onSubmit={(event) => void onLocal(event)}>
                <Field label={t('auth.email')}>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
                  />
                </Field>

                <Field label={t('auth.password')}>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
                  />
                </Field>

                <Field label={t('auth.totp')} hint={t('auth.totpHint')}>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={form.totp}
                    onChange={(event) => setForm({ ...form, totp: event.target.value })}
                    className="tabular h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
                  />
                </Field>

                <Button type="submit" className="w-full" disabled={busy}>
                  {t('auth.submit')}
                </Button>
              </form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </main>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-text">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-text-muted">{hint}</span> : null}
    </label>
  )
}
