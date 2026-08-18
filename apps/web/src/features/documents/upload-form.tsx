/**
 * Uploading a document.
 *
 * The warning about student data is not fine print: it is the first thing on
 * the form, because the one mistake that matters here — a class list, an
 * academic record — cannot be undone by deleting the file afterwards.
 *
 * The scope decides who may upload at all, so the selector only offers what
 * this person is actually allowed to file.
 */
import { AlertTriangle, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRoles } from '../../app/use-roles'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { useUploadDocument } from './queries'

const TYPES = ['regulation', 'teaching_plan', 'agreement', 'guide', 'minutes', 'other'] as const

export interface UploadFormProps {
  subjects: { id: string; code: string; name: string }[]
  degrees: { id: string; code: string; name: string }[]
  academicYears: { id: string; name: string }[]
  onUploaded: () => void
}

export function UploadForm({ subjects, degrees, academicYears, onUploaded }: UploadFormProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const roles = useRoles()
  const upload = useUploadDocument()

  const scopes = (
    [
      ['university', roles.includes('SUPERADMIN')],
      ['center', roles.includes('CENTER_ADMIN') || roles.includes('SUPERADMIN')],
      ['degree', roles.includes('CENTER_ADMIN') || roles.includes('SUPERADMIN')],
      ['subject', true],
    ] as const
  )
    .filter(([, allowed]) => allowed)
    .map(([scope]) => scope)

  const [form, setForm] = useState({
    title: '',
    type: 'regulation' as (typeof TYPES)[number],
    scope: scopes.includes('center') ? 'center' : 'subject',
    scopeId: '',
    academicYearId: academicYears[0]?.id ?? '',
    language: 'ca',
    validFrom: '',
    validTo: '',
    visibility: 'ai_only',
  })
  const [file, setFile] = useState<File | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) return

    const body = new FormData()
    for (const [key, value] of Object.entries(form)) {
      if (value) body.append(key, String(value))
    }
    body.append('file', file)

    upload.mutate(body, {
      onSuccess: () => {
        toast.success('documents.uploaded')
        setForm({ ...form, title: '', validFrom: '', validTo: '' })
        setFile(null)
        onUploaded()
      },
      onError: (error) => {
        if (error instanceof ApiRequestError) {
          const key = error.details[0]?.messageKey
          if (key) toast.error(key)
          else toast.raw({ variant: 'error', message: error.localizedMessage })
        } else toast.error('errors.generic')
      },
    })
  }

  return (
    <Card>
      <CardHeader title={t('documents.upload')} description={t('documents.subtitle')} />
      <CardBody className="space-y-4">
        <p className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/10 p-3 text-xs text-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {t('documents.noStudentData')}
        </p>

        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-text-muted">{t('documents.fields.title')}</span>
            <input
              required
              minLength={3}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('documents.fields.type')}</span>
            <select
              value={form.type}
              onChange={(event) =>
                setForm({ ...form, type: event.target.value as (typeof TYPES)[number] })
              }
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`documents.type.${type}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('documents.fields.scope')}</span>
            <select
              value={form.scope}
              onChange={(event) => setForm({ ...form, scope: event.target.value, scopeId: '' })}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              {scopes.map((scope) => (
                <option key={scope} value={scope}>
                  {t(`documents.scope.${scope}`)}
                </option>
              ))}
            </select>
          </label>

          {form.scope === 'subject' || form.scope === 'degree' ? (
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t('documents.fields.scopeId')}</span>
              <select
                required
                value={form.scopeId}
                onChange={(event) => setForm({ ...form, scopeId: event.target.value })}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
              >
                <option value="">{t('common.none')}</option>
                {(form.scope === 'subject' ? subjects : degrees).map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${option.code} · ${option.name}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('documents.fields.academicYear')}</span>
            <select
              value={form.academicYearId}
              onChange={(event) => setForm({ ...form, academicYearId: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              <option value="">{t('common.all')}</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('documents.fields.validFrom')}</span>
            <input
              type="date"
              required
              value={form.validFrom}
              onChange={(event) => setForm({ ...form, validFrom: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('documents.fields.validTo')}</span>
            <input
              type="date"
              required
              min={form.validFrom}
              value={form.validTo}
              onChange={(event) => setForm({ ...form, validTo: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t('documents.fields.visibility')}</span>
            <select
              value={form.visibility}
              onChange={(event) => setForm({ ...form, visibility: event.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-2 text-text"
            >
              <option value="ai_only">{t('documents.visibility.ai_only')}</option>
              <option value="center">{t('documents.visibility.center')}</option>
            </select>
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-text-muted">{t('documents.fields.file')}</span>
            <input
              type="file"
              required
              accept=".pdf,.docx,.xlsx,.md,.txt"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-control border border-border bg-surface p-2 text-sm text-text"
            />
          </label>

          <div className="sm:col-span-3">
            <Button type="submit" disabled={upload.isPending || !file}>
              <Upload className="size-4" aria-hidden="true" />
              {t('documents.upload')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
