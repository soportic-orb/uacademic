import type { ImportKind, ListResult } from '@uacademic/shared'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError, apiDownload, apiFetch, apiJson, apiUpload } from '../../lib/api'
import { cn } from '../../lib/cn'

interface UploadResult {
  id: string
  kind: ImportKind
  fileName: string
  headers: string[]
  mapping: Record<string, number | null>
  rowCount: number
  fields: { key: string; labelKey: string; required: boolean }[]
}

interface Summary {
  total: number
  valid: number
  invalid: number
  duplicates: number
}

interface RowReport {
  rowNumber: number
  status: string
  errors: { field: string; messageKey: string; value: string }[]
}

type Step = 'upload' | 'mapping' | 'preview' | 'done'

/**
 * Upload → map → dry run → confirm.
 *
 * The dry run is the whole point: the user sees exactly which rows would be
 * written and which would fail, and nothing touches the database until they
 * press apply.
 */
export function ImportWizard() {
  const { t } = useTranslation()
  const toast = useToast()

  const [step, setStep] = useState<Step>('upload')
  const [kind, setKind] = useState<ImportKind>('teachers')
  const [academicYearId, setAcademicYearId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [batch, setBatch] = useState<UploadResult | null>(null)
  const [mapping, setMapping] = useState<Record<string, number | null>>({})
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<RowReport[]>([])
  const [busy, setBusy] = useState(false)

  /** The sample workbook for whichever kind is selected above. */
  const downloadTemplate = async () => {
    try {
      const blob = await apiDownload(`/api/v1/imports/template/${kind}`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `uacademic-${kind}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    }
  }

  const years = useQuery({
    queryKey: ['import-years'],
    queryFn: () =>
      apiFetch<ListResult<{ id: string; name: string }>>(
        '/api/v1/admin/academic-years?pageSize=50',
      ),
  })

  const fail = (error: unknown) => {
    if (error instanceof ApiRequestError) {
      const key = error.details[0]?.messageKey
      if (key) toast.error(key)
      else toast.raw({ variant: 'error', message: error.localizedMessage })
    } else {
      toast.error('errors.generic')
    }
  }

  const upload = async () => {
    if (!file || !academicYearId) return
    setBusy(true)
    try {
      const form = new FormData()
      form.set('kind', kind)
      form.set('academicYearId', academicYearId)
      form.set('file', file)

      const result = await apiUpload<UploadResult>('/api/v1/imports', form)
      setBatch(result)
      setMapping(result.mapping)
      setStep('mapping')
      toast.success('imports.uploaded')
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  const validate = async () => {
    if (!batch) return
    setBusy(true)
    try {
      await apiJson(`/api/v1/imports/${batch.id}/mapping`, 'PATCH', { mapping })
      const result = await apiJson<{ summary: Summary }>(
        `/api/v1/imports/${batch.id}/validate`,
        'POST',
        {},
      )
      setSummary(result.summary)

      const report = await apiFetch<{ rows: RowReport[] }>(
        `/api/v1/imports/${batch.id}?status=invalid&pageSize=50`,
      )
      setRows(report.rows)
      setStep('preview')
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!batch) return
    setBusy(true)
    try {
      const result = await apiJson<{ applied: number }>(
        `/api/v1/imports/${batch.id}/apply`,
        'POST',
        {},
      )
      toast.success('imports.applied', { params: { count: result.applied } })
      setStep('done')
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setStep('upload')
    setBatch(null)
    setFile(null)
    setSummary(null)
    setRows([])
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('imports.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('imports.subtitle')}</p>
      </header>

      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t('imports.title')}>
        {(['upload', 'mapping', 'preview', 'done'] as const).map((name, index) => (
          <li
            key={name}
            aria-current={step === name ? 'step' : undefined}
            className={cn(
              'rounded-control border px-3 py-1',
              step === name
                ? 'border-primary bg-primary-surface text-primary-strong'
                : 'border-border text-text-muted',
            )}
          >
            {`${index + 1}. ${t(`imports.steps.${name === 'done' ? 'confirm' : name}`)}`}
          </li>
        ))}
      </ol>

      {step === 'upload' ? (
        <Card className="max-w-2xl">
          <CardHeader title={t('imports.steps.upload')} />
          <CardBody className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-text">{t('imports.kind')}</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as ImportKind)}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="teachers">{t('imports.kindTeachers')}</option>
                <option value="subjects">{t('imports.kindSubjects')}</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-text">
                {t('admin.academicYears')}
              </span>
              <select
                value={academicYearId}
                onChange={(event) => setAcademicYearId(event.target.value)}
                className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                <option value="">{t('common.choose')}</option>
                {(years.data?.items ?? []).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </select>
            </label>

            {/*
              Offered before the file picker, because this is where somebody
              realises they do not know what the columns are supposed to be.
            */}
            <div className="rounded-control border border-dashed border-border-strong p-3">
              <Button variant="secondary" onClick={() => void downloadTemplate()}>
                <Download className="size-4" aria-hidden="true" />
                {t('imports.template.download')}
              </Button>
              <p className="mt-2 text-xs text-text-muted">{t('imports.template.downloadHint')}</p>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-text">
                {t('imports.selectFile')}
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="w-full text-sm text-text"
              />
            </label>

            <Button onClick={() => void upload()} disabled={busy || !file || !academicYearId}>
              {t('imports.upload')}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {step === 'mapping' && batch ? (
        <Card className="max-w-3xl">
          <CardHeader
            title={t('imports.steps.mapping')}
            description={`${batch.fileName} · ${batch.rowCount}`}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {batch.fields.map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1 block text-sm font-medium text-text">
                    {t(field.labelKey)}
                    {field.required ? <span aria-hidden="true"> *</span> : null}
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(event) =>
                      setMapping({
                        ...mapping,
                        [field.key]: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                    className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
                  >
                    <option value="">{t('imports.unmapped')}</option>
                    {batch.headers.map((header, index) => (
                      <option key={header} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={() => void validate()} disabled={busy}>
                {t('imports.validate')}
              </Button>
              <Button variant="secondary" onClick={reset}>
                {t('imports.cancel')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {step === 'preview' && summary ? (
        <Card className="max-w-3xl">
          <CardHeader title={t('imports.steps.preview')} description={t('imports.dryRun')} />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['total', summary.total],
                  ['valid', summary.valid],
                  ['invalid', summary.invalid],
                  ['duplicates', summary.duplicates],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-control border border-border px-3 py-2">
                  <dt className="text-xs text-text-muted">{t(`imports.summary.${key}`)}</dt>
                  <dd className="tabular text-lg font-semibold text-text">{value}</dd>
                </div>
              ))}
            </dl>

            {rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('imports.steps.preview')}</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('imports.rowNumber')}
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        {t('states.errorTitle')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.rowNumber} className="border-b border-border/60">
                        <td className="tabular py-2 pr-4 text-text">{row.rowNumber}</td>
                        <td className="py-2 text-danger">
                          {row.errors
                            .map((error) => `${error.field}: ${t(error.messageKey)}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className="text-sm text-text-muted">{t('imports.onlyValidApplied')}</p>

            <div className="flex gap-2">
              <Button onClick={() => void apply()} disabled={busy || summary.valid === 0}>
                {t('imports.apply')}
              </Button>
              <Button variant="secondary" onClick={() => setStep('mapping')}>
                {t('common.back')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {step === 'done' ? (
        <Card className="max-w-2xl">
          <CardBody className="space-y-4">
            <p className="text-sm text-text">
              {t('imports.applied', { count: summary?.valid ?? 0 })}
            </p>
            <Button onClick={reset}>{t('imports.title')}</Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}
