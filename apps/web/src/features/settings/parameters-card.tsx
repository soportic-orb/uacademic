/**
 * The center's parameters, block by block, each with what put it there.
 *
 * A parameter read from a regulation shows its article and its quote; one
 * nobody cited says so plainly. Every row carries the parameter key as an
 * anchor, so the wizard's "still to configure by hand" list can link straight
 * at the field it is talking about.
 */
import {
  EXTRACTION_BLOCKS,
  type ExtractionBlock,
  type SettingParam,
  blockLabelKey,
  citationHref,
  paramHelpKey,
  paramLabelKey,
  paramsOfBlock,
  readSettingValue,
} from '@uacademic/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { useCenterSettings } from '../../hooks/use-api'
import { ApiRequestError, apiJson } from '../../lib/api'

/**
 * The parameters that can be typed into a box.
 *
 * A list of teacher categories or a set of weekdays is not one value, and a
 * text field that pretends otherwise invites somebody to paste JSON into their
 * own configuration. Those stay read-only until they get a screen of their own.
 */
function isEditable(param: SettingParam): boolean {
  return param.kind !== 'collection' && param.kind !== 'weekdays'
}

function inputTypeFor(param: SettingParam): 'number' | 'time' | 'date' | 'checkbox' {
  if (param.kind === 'boolean') return 'checkbox'
  if (param.kind === 'time') return 'time'
  if (param.kind === 'date') return 'date'
  return 'number'
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (Array.isArray(value)) return value.length === 0 ? '—' : JSON.stringify(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function ParametersCard() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const query = useCenterSettings()
  const [editing, setEditing] = useState(false)
  /** Only what has actually been changed, so nothing else is overwritten. */
  const [draft, setDraft] = useState<Record<string, unknown>>({})

  const save = useMutation({
    mutationFn: () => apiJson('/api/v1/centers/settings', 'PATCH', { values: draft }),
    onSuccess: async () => {
      toast.success('settings.manual.saved')
      setDraft({})
      setEditing(false)
      await queryClient.invalidateQueries({ queryKey: ['center-settings'] })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    },
  })

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const provenance = new Map(query.data.provenance.map((record) => [record.paramKey, record]))
  const settings = query.data.settings
  const valueOf = (key: string) => (key in draft ? draft[key] : readSettingValue(settings, key))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{t('settings.manual.hint')}</p>

        {editing ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDraft({})
                setEditing(false)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={save.isPending || Object.keys(draft).length === 0}
              onClick={() => save.mutate()}
            >
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            {t('settings.manual.edit')}
          </Button>
        )}
      </div>

      {EXTRACTION_BLOCKS.map((block: ExtractionBlock) => (
        <Card key={block}>
          <CardHeader title={`${block} · ${t(blockLabelKey(block))}`} />
          <CardBody>
            <dl className="divide-y divide-border">
              {paramsOfBlock(block).map((param) => {
                const cited = provenance.get(param.key)

                return (
                  <div key={param.key} id={param.key} className="scroll-mt-24 py-3">
                    <dt className="flex flex-wrap items-baseline justify-between gap-2">
                      <label className="font-medium text-text" htmlFor={`param-${param.key}`}>
                        {t(paramLabelKey(param.key))}
                      </label>

                      {editing && isEditable(param) ? (
                        <span className="flex items-center gap-2">
                          <input
                            id={`param-${param.key}`}
                            type={inputTypeFor(param)}
                            step={param.kind === 'integer' ? 1 : 'any'}
                            {...(param.kind === 'boolean'
                              ? { checked: Boolean(valueOf(param.key)) }
                              : { value: String(valueOf(param.key) ?? '') })}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                [param.key]:
                                  param.kind === 'boolean'
                                    ? event.target.checked
                                    : inputTypeFor(param) === 'number'
                                      ? event.target.value === ''
                                        ? null
                                        : Number(event.target.value)
                                      : event.target.value,
                              })
                            }
                            className="h-9 w-40 rounded-control border border-border bg-surface px-2 text-sm text-text tabular-nums"
                          />
                          {param.unit ? (
                            <span className="text-xs text-text-muted">{param.unit}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="tabular-nums text-text">
                          {display(valueOf(param.key))}
                          {param.unit ? (
                            <span className="ml-1 text-xs text-text-muted">{param.unit}</span>
                          ) : null}
                        </span>
                      )}
                    </dt>
                    <dd className="mt-1 text-xs text-text-muted">
                      <p>{t(paramHelpKey(param.key))}</p>

                      {cited?.quote ? (
                        <>
                          <blockquote className="mt-2 border-l-2 border-primary pl-2 italic">
                            {cited.quote}
                          </blockquote>
                          <p className="mt-1">
                            {[
                              cited.documentTitle,
                              cited.section,
                              cited.page ? `p. ${cited.page}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          {cited.documentId ? (
                            <Link
                              to={citationHref({
                                documentId: cited.documentId,
                                title: cited.documentTitle ?? '',
                                page: cited.page,
                                section: cited.section,
                                chunkId: null,
                              })}
                              className="mt-1 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                            >
                              <BookOpen className="size-3" aria-hidden="true" />
                              {t('settings.why.open')}
                            </Link>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-1 italic">{t('settings.why.noSource')}</p>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
