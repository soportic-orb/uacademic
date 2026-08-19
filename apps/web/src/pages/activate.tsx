import type { InvitationSummary, SessionUser } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router'

import { Logo } from '../components/brand/logo'
import { CardSkeleton } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError, apiFetch, apiJson } from '../lib/api'

/**
 * Where an invitation lands: the one screen somebody sees before they have an
 * account they can use.
 *
 * The link is the proof — it went to their mailbox and it is good once — so
 * nothing is asked for except the password, and the account is theirs from the
 * moment they choose it. They are signed in here rather than sent to the
 * sign-in screen to type, four seconds later, the password they just set.
 */
export function ActivatePage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [form, setForm] = useState({ password: '', confirmPassword: '' })
  const [done, setDone] = useState(false)

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiFetch<InvitationSummary>(`/api/v1/auth/invitation/${token}`),
    enabled: token !== '',
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () =>
      apiJson<SessionUser>(`/api/v1/auth/invitation/${token}`, 'POST', {
        password: form.password,
        confirmPassword: form.confirmPassword,
      }),
    onSuccess: (session) => {
      // The session query is keyed on the identity; seeding it here means the
      // redirect below lands on a dashboard that already knows who arrived.
      queryClient.setQueryData(['session', 'session'], session)
      toast.success('auth.activated')
      setDone(true)
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  if (done) return <Navigate to="/" replace />

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center">
          <Logo className="text-2xl" title={t('common.appName')} />
          <h1 className="mt-6 text-xl font-semibold text-text">{t('auth.activateTitle')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('auth.activateSubtitle')}</p>
        </header>

        {token === '' || invitation.isError ? (
          <Card>
            <CardBody className="space-y-4 text-center">
              <p className="text-sm text-text">
                {invitation.error instanceof ApiRequestError
                  ? invitation.error.localizedMessage
                  : t('auth.errors.invitationInvalid')}
              </p>
              <Button variant="link" onClick={() => window.location.assign('/login')}>
                {t('auth.backToSignIn')}
              </Button>
            </CardBody>
          </Card>
        ) : invitation.isPending ? (
          <CardSkeleton />
        ) : (
          <Card>
            <CardHeader
              title={`${invitation.data.firstName} ${invitation.data.lastName}`.trim()}
              description={
                invitation.data.centerName
                  ? `${invitation.data.email} · ${invitation.data.centerName}`
                  : invitation.data.email
              }
            />
            <CardBody>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  accept.mutate()
                }}
              >
                <Field label={t('auth.newPassword')} hint={t('auth.passwordRule')}>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
                  />
                </Field>

                <Field label={t('auth.confirmPassword')}>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                    className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
                  />
                </Field>

                <Button type="submit" className="w-full" disabled={accept.isPending}>
                  {accept.isPending ? t('auth.signingIn') : t('auth.activateSubmit')}
                </Button>
              </form>

              {invitation.data.hasMicrosoftAccount ? (
                <p className="mt-4 text-xs text-text-muted">{t('auth.activateHasMicrosoft')}</p>
              ) : null}
            </CardBody>
          </Card>
        )}
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
  // The hint sits outside the <label> so it does not become part of the
  // field's accessible name — see the same shape on the sign-in screen.
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-text">{label}</span>
        {children}
      </label>
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  )
}
