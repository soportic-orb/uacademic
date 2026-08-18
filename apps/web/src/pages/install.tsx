/**
 * The installer, as four screens in a browser.
 *
 * It runs against an API that has no database yet, so it uses `fetch`
 * directly: no session, no center header, no query client — none of that
 * exists at this point, and pretending otherwise would fail in confusing ways.
 *
 * The order is deliberate. The token first, because everything else is refused
 * without it and finding that out at the end would be cruel. Then the
 * database, with a connection test that has to pass before the form moves on —
 * a wrong password discovered during the migration is a wasted five minutes.
 * The center and the administrator last, because they are the only parts a
 * person has to think about.
 *
 * Nothing is written until the final button.
 */
import { CircleCheck, CircleX, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { API_BASE_URL } from '../lib/api-base'

const API = API_BASE_URL

const STEPS = ['token', 'database', 'site', 'admin', 'done'] as const
type Step = (typeof STEPS)[number]

interface Status {
  installed: boolean
  tokenReady: boolean
  envFile?: string
}

interface DatabaseCheck {
  ok: boolean
  errorKey?: string
  detail?: string
  charset?: string
  collation?: string
  hasTables?: boolean
}

interface InstallResult {
  ok: boolean
  envFile?: string
  errorKey?: string
  steps: { key: string; ok: boolean; detail?: string }[]
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { code: string; message: string }
  }

  if (!response.ok && payload.error) {
    throw new Error(payload.error.message)
  }
  return payload
}

export function InstallPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status | null>(null)
  const [step, setStep] = useState<Step>('token')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [token, setToken] = useState('')
  const [database, setDatabase] = useState({
    host: '127.0.0.1',
    port: 3306,
    database: '',
    user: '',
    password: '',
  })
  const [check, setCheck] = useState<DatabaseCheck | null>(null)

  const [site, setSite] = useState({
    url: typeof window === 'undefined' ? '' : window.location.origin,
    locale: 'ca' as 'ca' | 'es' | 'en',
    timezone: 'Europe/Madrid',
  })
  const [organisation, setOrganisation] = useState({
    university: '',
    center: '',
    centerCode: '',
    entraTenantId: '',
    entraClientId: '',
  })
  const [admin, setAdmin] = useState({ email: '', firstName: '', lastName: '', password: '' })
  const [repeat, setRepeat] = useState('')
  const [result, setResult] = useState<InstallResult | null>(null)

  useEffect(() => {
    void fetch(`${API}/api/v1/install/status`)
      .then((response) => response.json())
      .then((body: Status) => setStatus(body))
      .catch(() => setStatus({ installed: false, tokenReady: false }))
  }, [])

  if (!status) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          {t('installer.checking')}
        </p>
      </Shell>
    )
  }

  if (status.installed) {
    return (
      <Shell>
        <Card>
          <CardHeader
            title={t('installer.already.title')}
            description={t('installer.already.body')}
          />
          <CardBody>
            <a href="/login" className="text-sm text-primary underline-offset-2 hover:underline">
              {t('installer.already.signIn')}
            </a>
          </CardBody>
        </Card>
      </Shell>
    )
  }

  const testDatabase = async () => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await post<DatabaseCheck>('/api/v1/install/database', { token, database })
      setCheck(outcome)
      if (!outcome.ok && outcome.errorKey) setError(t(outcome.errorKey))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('installer.errors.databaseFailed'))
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (admin.password !== repeat) {
      setError(t('installer.admin.mismatch'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      const outcome = await post<InstallResult>('/api/v1/install/run', {
        token,
        database,
        site,
        organisation: {
          university: organisation.university,
          center: organisation.center,
          centerCode: organisation.centerCode,
          entraTenantId: organisation.entraTenantId || null,
          entraClientId: organisation.entraClientId || null,
        },
        admin,
      })

      setResult(outcome)
      if (outcome.ok) setStep('done')
      else if (outcome.errorKey) setError(t(outcome.errorKey))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('installer.errors.databaseFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <ol className="flex flex-wrap gap-2" aria-label={t('installer.title')}>
        {STEPS.map((entry, index) => (
          <li key={entry}>
            <span
              aria-current={entry === step ? 'step' : undefined}
              className={`inline-flex items-center gap-2 rounded-control border px-3 py-1 text-xs ${
                entry === step
                  ? 'border-primary bg-primary-surface text-primary-strong'
                  : STEPS.indexOf(step) > index
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-border bg-surface text-text-muted'
              }`}
            >
              {index + 1}. {t(`installer.steps.${entry}`)}
            </span>
          </li>
        ))}
      </ol>

      {error ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      {step === 'token' ? (
        <Card>
          <CardHeader title={t('installer.token.title')} description={t('installer.token.hint')} />
          <CardBody className="space-y-4">
            <Field label={t('installer.token.label')}>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-10 w-full rounded-control border border-border bg-surface px-3 font-mono text-sm text-text"
              />
            </Field>
            <p className="font-mono text-xs text-text-muted">{t('installer.token.where')}</p>
            <Button disabled={token.trim().length < 16} onClick={() => setStep('database')}>
              {t('common.next')}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {step === 'database' ? (
        <Card>
          <CardHeader
            title={t('installer.database.title')}
            description={t('installer.database.hint')}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('installer.database.host')}>
                <Input
                  value={database.host}
                  onChange={(value) => setDatabase({ ...database, host: value })}
                />
              </Field>
              <Field label={t('installer.database.port')}>
                <Input
                  value={String(database.port)}
                  onChange={(value) => setDatabase({ ...database, port: Number(value) || 3306 })}
                />
              </Field>
              <Field label={t('installer.database.name')}>
                <Input
                  value={database.database}
                  onChange={(value) => setDatabase({ ...database, database: value })}
                />
              </Field>
              <Field label={t('installer.database.user')}>
                <Input
                  value={database.user}
                  onChange={(value) => setDatabase({ ...database, user: value })}
                />
              </Field>
              <Field label={t('installer.database.password')}>
                <Input
                  type="password"
                  value={database.password}
                  onChange={(value) => setDatabase({ ...database, password: value })}
                />
              </Field>
            </div>

            {check?.ok ? (
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 text-success">
                  <CircleCheck className="size-4" aria-hidden="true" />
                  {t('installer.database.ok', {
                    charset: check.charset,
                    collation: check.collation,
                  })}
                </p>
                {check.charset && !check.charset.startsWith('utf8mb4') ? (
                  <p className="text-warning">{t('installer.database.charsetWarning')}</p>
                ) : null}
                {check.hasTables ? (
                  <p className="text-warning">{t('installer.database.hasTables')}</p>
                ) : null}
              </div>
            ) : check ? (
              <p className="flex items-start gap-2 text-sm text-danger">
                <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {t(check.errorKey ?? 'installer.errors.databaseFailed')}
                  {check.detail ? (
                    <span className="mt-1 block font-mono text-xs opacity-80">{check.detail}</span>
                  ) : null}
                </span>
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep('token')}>
                {t('common.back')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void testDatabase()}>
                {busy ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                ) : null}
                {t('installer.database.test')}
              </Button>
              <Button disabled={!check?.ok} onClick={() => setStep('site')}>
                {t('common.next')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {step === 'site' ? (
        <Card>
          <CardHeader title={t('installer.site.title')} />
          <CardBody className="space-y-4">
            <Field label={t('installer.site.url')} hint={t('installer.site.urlHint')}>
              <Input value={site.url} onChange={(value) => setSite({ ...site, url: value })} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('installer.site.university')}>
                <Input
                  value={organisation.university}
                  onChange={(value) => setOrganisation({ ...organisation, university: value })}
                />
              </Field>
              <Field label={t('installer.site.center')}>
                <Input
                  value={organisation.center}
                  onChange={(value) => setOrganisation({ ...organisation, center: value })}
                />
              </Field>
              <Field label={t('installer.site.centerCode')}>
                <Input
                  value={organisation.centerCode}
                  onChange={(value) => setOrganisation({ ...organisation, centerCode: value })}
                />
              </Field>
              <Field label={t('installer.site.timezone')}>
                <Input
                  value={site.timezone}
                  onChange={(value) => setSite({ ...site, timezone: value })}
                />
              </Field>
              <Field label={t('installer.site.locale')}>
                <select
                  value={site.locale}
                  onChange={(event) =>
                    setSite({ ...site, locale: event.target.value as 'ca' | 'es' | 'en' })
                  }
                  className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
                >
                  {/* Endonyms: each language names itself, in itself. */}
                  <option value="ca">{t('language.ca')}</option>
                  <option value="es">{t('language.es')}</option>
                  <option value="en">{t('language.en')}</option>
                </select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('installer.site.entraTenant')}>
                <Input
                  value={organisation.entraTenantId}
                  onChange={(value) => setOrganisation({ ...organisation, entraTenantId: value })}
                />
              </Field>
              <Field label={t('installer.site.entraClient')}>
                <Input
                  value={organisation.entraClientId}
                  onChange={(value) => setOrganisation({ ...organisation, entraClientId: value })}
                />
              </Field>
            </div>
            <p className="text-xs text-text-muted">{t('installer.site.entraHint')}</p>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep('database')}>
                {t('common.back')}
              </Button>
              <Button
                disabled={
                  !site.url ||
                  !organisation.university ||
                  !organisation.center ||
                  !organisation.centerCode
                }
                onClick={() => setStep('admin')}
              >
                {t('common.next')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {step === 'admin' ? (
        <Card>
          <CardHeader title={t('installer.admin.title')} description={t('installer.admin.hint')} />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('installer.admin.firstName')}>
                <Input
                  value={admin.firstName}
                  onChange={(value) => setAdmin({ ...admin, firstName: value })}
                />
              </Field>
              <Field label={t('installer.admin.lastName')}>
                <Input
                  value={admin.lastName}
                  onChange={(value) => setAdmin({ ...admin, lastName: value })}
                />
              </Field>
              <Field label={t('installer.admin.email')}>
                <Input
                  type="email"
                  value={admin.email}
                  onChange={(value) => setAdmin({ ...admin, email: value })}
                />
              </Field>
              <Field label={t('installer.admin.password')} hint={t('installer.admin.passwordHint')}>
                <Input
                  type="password"
                  value={admin.password}
                  onChange={(value) => setAdmin({ ...admin, password: value })}
                />
              </Field>
              <Field label={t('installer.admin.repeat')}>
                <Input type="password" value={repeat} onChange={setRepeat} />
              </Field>
            </div>

            {result && !result.ok ? <Steps steps={result.steps} /> : null}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep('site')}>
                {t('common.back')}
              </Button>
              <Button
                disabled={
                  busy ||
                  admin.password.length < 12 ||
                  !admin.email ||
                  !admin.firstName ||
                  !admin.lastName
                }
                onClick={() => void run()}
              >
                {busy ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                ) : null}
                {busy ? t('installer.run.working') : t('installer.run.action')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {step === 'done' && result?.ok ? (
        <Card>
          <CardHeader title={t('installer.done.title')} description={t('installer.done.body')} />
          <CardBody className="space-y-4">
            <Steps steps={result.steps} />

            <pre className="rounded-control border border-border bg-surface-muted p-3 font-mono text-xs text-text">
              {t('installer.done.restart')}
            </pre>

            {result.envFile ? (
              <p className="text-xs text-text-muted">
                {t('installer.done.envFile', { path: result.envFile })}
              </p>
            ) : null}

            <p className="text-sm text-text-muted">{t('installer.done.next')}</p>
            <a href="/login" className="text-sm text-primary underline-offset-2 hover:underline">
              {t('installer.done.signIn')}
            </a>
          </CardBody>
        </Card>
      ) : null}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-text">
          <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
          {t('installer.title')}
        </h1>
        <p className="mt-1 text-sm text-text-muted">{t('installer.subtitle')}</p>
      </header>
      {children}
    </div>
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
  // The hint sits outside the <label> on purpose: inside, it becomes part of
  // the field's accessible name, and "Password" turns into "Password at least
  // 12 characters keep it in a password manager".
  return (
    <div className="text-sm">
      <label className="block">
        <span className="mb-1 block text-text-muted">{label}</span>
        {children}
      </label>
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  )
}

function Input({
  value,
  onChange,
  type = 'text',
}: {
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
    />
  )
}

/** What the server actually did, step by step — including where it stopped. */
function Steps({ steps }: { steps: { key: string; ok: boolean; detail?: string }[] }) {
  const { t } = useTranslation()

  return (
    <ul className="space-y-1 text-sm">
      {steps.map((entry) => (
        <li key={entry.key} className="flex items-start gap-2">
          {entry.ok ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <CircleX className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          )}
          <span>
            {t(`installer.run.steps.${entry.key}`)}
            {entry.detail ? (
              <span className="mt-1 block font-mono text-xs text-text-muted">{entry.detail}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
