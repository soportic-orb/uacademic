import type { ListResult } from '@uacademic/shared'
import { useQueries } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { useImageData } from '../../hooks/use-image'
import { ApiRequestError, apiFetch } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { FieldConfig, ResourceConfig } from './resource-config'

type Values = Record<string, unknown>

/** What a submitted form asks the page to do with pictures, per field. */
export interface ImageIntent {
  files: Record<string, File>
  removals: string[]
}

/**
 * Form dialog built from the resource description. Field errors come back from
 * the API as i18n keys per path, so the same Zod schema that guards the
 * endpoint also labels the inputs (R6).
 */
export function ResourceForm({
  resource,
  row,
  onClose,
  onSubmit,
}: {
  resource: ResourceConfig
  row: Values | null
  onClose: () => void
  onSubmit: (values: Values, images: ImageIntent) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<Values>(() => initialValues(resource.fields, row))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Pictures are not part of the JSON body: they are posted to their own
  // endpoint once the row exists and has an id.
  const [files, setFiles] = useState<Record<string, File>>({})
  const [removals, setRemovals] = useState<string[]>([])

  // Options for relation fields (degrees, academic years, subjects…).
  const relationFields = resource.fields.filter((field) => field.optionsFrom)
  const relationQueries = useQueries({
    queries: relationFields.map((field) => ({
      queryKey: ['admin-options', field.optionsFrom?.path],
      queryFn: () =>
        apiFetch<ListResult<Record<string, unknown>>>(
          `/api/v1/${field.optionsFrom?.path}?pageSize=100`,
        ),
      staleTime: 60_000,
    })),
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    dialogRef.current?.querySelector<HTMLElement>('input, select')?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const optionsFor = (field: FieldConfig) => {
    if (field.options)
      return field.options.map((option) => ({ value: option.value, label: t(option.labelKey) }))

    const index = relationFields.findIndex((candidate) => candidate.name === field.name)
    const rows = relationQueries[index]?.data?.items ?? []
    return rows.map((item) => ({
      value: String(item.id),
      label: String(item[field.optionsFrom?.labelField ?? 'name'] ?? item.id),
    }))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})

    try {
      await onSubmit(cleanValues(resource.fields, values), { files, removals })
    } catch (error) {
      if (error instanceof ApiRequestError && error.details.length > 0) {
        const byPath = Object.fromEntries(
          error.details.map((detail) => [detail.path, detail.messageKey]),
        )
        // An upload is a request of its own and answers about `file`; on this
        // form that complaint belongs to the picture field it came from.
        if (byPath.file) {
          for (const field of resource.fields) {
            if (field.type === 'image') byPath[field.name] = byPath.file
          }
        }
        setErrors(byPath)
      } else if (error instanceof ApiRequestError) {
        setErrors({ _form: error.localizedMessage })
      } else {
        setErrors({ _form: t('errors.generic') })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-12">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 size-full cursor-default bg-black/40"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={row ? t('admin.edit') : t('admin.create')}
        className="relative w-full max-w-2xl rounded-card border border-border bg-surface-raised shadow-overlay"
      >
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-semibold text-text">
            {row ? t('admin.edit') : t('admin.create')}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{t(resource.titleKey)}</p>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            {resource.fields.map((field) => {
              const errorKey = errors[field.name]
              const inputId = `field-${field.name}`

              return (
                <div key={field.name} className={cn(field.full && 'sm:col-span-2')}>
                  <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-text">
                    {t(field.labelKey)}
                    {field.required ? <span aria-hidden="true"> *</span> : null}
                  </label>

                  {field.type === 'select' ? (
                    <select
                      id={inputId}
                      required={field.required}
                      value={String(values[field.name] ?? '')}
                      onChange={(event) =>
                        setValues({ ...values, [field.name]: event.target.value })
                      }
                      aria-invalid={Boolean(errorKey)}
                      className="h-10 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
                    >
                      <option value="">{t('common.choose')}</option>
                      {optionsFor(field).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'checkbox' ? (
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={Boolean(values[field.name])}
                      onChange={(event) =>
                        setValues({ ...values, [field.name]: event.target.checked })
                      }
                      className="size-5 rounded border-border"
                    />
                  ) : field.type === 'dateRange' ? (
                    <DateRangeField
                      inputId={inputId}
                      required={field.required}
                      from={String(values[field.name] ?? '')}
                      to={String(values[field.rangeEnd ?? ''] ?? '')}
                      onChange={(from, to) =>
                        setValues({
                          ...values,
                          [field.name]: from,
                          ...(field.rangeEnd ? { [field.rangeEnd]: to } : {}),
                        })
                      }
                    />
                  ) : field.type === 'image' ? (
                    <ImageField
                      inputId={inputId}
                      label={t(field.labelKey)}
                      currentUrl={
                        removals.includes(field.name)
                          ? null
                          : ((row?.[field.name] as string) ?? null)
                      }
                      file={files[field.name] ?? null}
                      onPick={(file) => {
                        setFiles({ ...files, [field.name]: file })
                        setRemovals(removals.filter((name) => name !== field.name))
                      }}
                      onRemove={() => {
                        const { [field.name]: _dropped, ...rest } = files
                        setFiles(rest)
                        setRemovals([...new Set([...removals, field.name])])
                      }}
                    />
                  ) : (
                    <input
                      id={inputId}
                      type={field.type === 'url' ? 'url' : field.type}
                      required={field.required}
                      step={field.step}
                      value={String(values[field.name] ?? '')}
                      onChange={(event) =>
                        setValues({ ...values, [field.name]: event.target.value })
                      }
                      aria-invalid={Boolean(errorKey)}
                      className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text"
                    />
                  )}

                  {errorKey ? (
                    <p className="mt-1 text-xs text-danger">{t(errorKey, errorKey)}</p>
                  ) : null}
                </div>
              )
            })}
          </div>

          {errors._form ? (
            <p role="alert" className="px-6 text-sm text-danger">
              {errors._form}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border p-6">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * The picture as it stands: what is stored, or what has just been chosen and
 * not yet sent. Showing the chosen file matters — a form that looks unchanged
 * after picking one invites picking it again.
 */
function ImageField({
  inputId,
  label,
  currentUrl,
  file,
  onPick,
  onRemove,
}: {
  inputId: string
  label: string
  currentUrl: string | null
  file: File | null
  onPick: (file: File) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const stored = useImageData(file ? null : currentUrl)
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPending(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPending(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const preview = pending ?? stored.data ?? null

  return (
    <div className="flex flex-wrap items-center gap-4">
      {preview ? (
        <img
          src={preview}
          alt={label}
          className="size-16 rounded-control border border-border object-contain"
        />
      ) : (
        <span className="grid size-16 place-items-center rounded-control border border-dashed border-border text-xs text-text-muted">
          {t('images.noImage')}
        </span>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="text-sm text-text-muted file:mr-3 file:rounded-control file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text"
          onChange={(event) => {
            const picked = event.target.files?.[0]
            if (picked) onPick(picked)
          }}
        />
        {preview ? (
          <Button type="button" variant="secondary" onClick={onRemove}>
            {t('common.remove')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function initialValues(fields: FieldConfig[], row: Values | null): Values {
  const values: Values = {}
  for (const field of fields) {
    const current = row?.[field.name]
    values[field.name] = current ?? (field.type === 'checkbox' ? false : '')
  }
  return values
}

/** Empty strings are omitted so a partial update never blanks a column. */
function cleanValues(fields: FieldConfig[], values: Values): Values {
  const cleaned: Values = {}
  for (const field of fields) {
    // A picture is uploaded separately, and the column it lands in is written
    // by the server: sending it here would only fight with that.
    if (field.type === 'image') continue

    const value = values[field.name]
    if (value === '' || value === undefined || value === null) continue
    cleaned[field.name] = field.type === 'number' ? Number(value) : value
  }
  return cleaned
}

/**
 * A date, or a stretch of them.
 *
 * Most of what goes in an academic calendar is a single day — a public
 * holiday, the first day of term — and asking for the same date twice is
 * asking somebody to do the computer's work. The tick decides which it is, and
 * a single day is simply a range whose ends agree, so nothing downstream has
 * to know the difference.
 */
function DateRangeField({
  inputId,
  required,
  from,
  to,
  onChange,
}: {
  inputId: string
  required?: boolean
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const { t } = useTranslation()
  // A row being edited says what it is by whether its ends agree; a new one
  // starts as a single day, which is the commoner case.
  const [singleDay, setSingleDay] = useState(from === '' || from === to)

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={singleDay}
          onChange={(event) => {
            setSingleDay(event.target.checked)
            if (event.target.checked) onChange(from, from)
          }}
          className="size-4 rounded border-border"
        />
        {t('admin.fields.singleDay')}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="date"
          required={required}
          value={from}
          onChange={(event) => onChange(event.target.value, singleDay ? event.target.value : to)}
          className="h-10 rounded-control border border-border bg-surface px-3 text-sm text-text"
        />

        {singleDay ? null : (
          <>
            <span className="text-sm text-text-muted">{t('common.to')}</span>
            <label>
              <span className="sr-only">{t('admin.fields.dateTo')}</span>
              <input
                type="date"
                required={required}
                value={to}
                onChange={(event) => onChange(from, event.target.value)}
                className="h-10 rounded-control border border-border bg-surface px-3 text-sm text-text"
              />
            </label>
          </>
        )}
      </div>
    </div>
  )
}
