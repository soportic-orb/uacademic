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
  blockLabelKey,
  citationHref,
  paramHelpKey,
  paramLabelKey,
  paramsOfBlock,
  readSettingValue,
} from '@uacademic/shared'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useCenterSettings } from '../../hooks/use-api'

function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (Array.isArray(value)) return value.length === 0 ? '—' : JSON.stringify(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function ParametersCard() {
  const { t } = useTranslation()
  const query = useCenterSettings()

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const provenance = new Map(query.data.provenance.map((record) => [record.paramKey, record]))

  return (
    <div className="space-y-6">
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
                      <span className="font-medium text-text">{t(paramLabelKey(param.key))}</span>
                      <span className="tabular-nums text-text">
                        {display(readSettingValue(query.data.settings, param.key))}
                        {param.unit ? (
                          <span className="ml-1 text-xs text-text-muted">{param.unit}</span>
                        ) : null}
                      </span>
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
