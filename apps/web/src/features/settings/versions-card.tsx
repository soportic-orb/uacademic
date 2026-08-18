/**
 * The history of the configuration.
 *
 * "Under which rules was last year's timetable generated?" is a question with
 * an answer here: every version, what it came from, who approved it, and what
 * it changes against the one in force — which is also how a new edition of a
 * regulation is reviewed, as a short list rather than a whole form.
 */
import { formatDate, paramLabelKey } from '@uacademic/shared'
import { History } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { currentLocale } from '../../i18n'
import { useSettingsVersion, useSettingsVersions } from './queries'

function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function VersionsCard() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const versions = useSettingsVersions()
  const [selected, setSelected] = useState<string | null>(null)
  const detail = useSettingsVersion(selected)

  return (
    <Card>
      <CardHeader title={t('settings.versions.title')} description={t('settings.versions.hint')} />

      <CardBody>
        {versions.isPending ? (
          <CardSkeleton />
        ) : versions.isError ? (
          <ErrorState onRetry={() => void versions.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {versions.data.items.map((version) => (
              <li key={version.id} className="py-3">
                <button
                  type="button"
                  onClick={() => setSelected(selected === version.id ? null : version.id)}
                  aria-expanded={selected === version.id}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="flex items-center gap-2 text-sm text-text">
                    <History className="size-4 text-text-muted" aria-hidden="true" />
                    {formatDate(locale, new Date(version.createdAt), { dateStyle: 'long' })}
                    <span className="text-xs text-text-muted">
                      {t(`settings.versions.source.${version.source}`)}
                    </span>
                  </span>

                  {version.current ? (
                    <span className="rounded-control border border-primary/30 bg-primary-50 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/30">
                      {t('settings.versions.current')}
                    </span>
                  ) : null}
                </button>

                <p className="mt-1 text-xs text-text-muted">
                  {[
                    version.documentTitle,
                    version.approver
                      ? t('settings.versions.approvedBy', { name: version.approver })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                {selected === version.id && detail.data ? (
                  <div className="mt-3 rounded-control border border-border bg-surface-muted p-3">
                    <p className="text-xs font-medium text-text">
                      {t('settings.versions.changes')}
                    </p>

                    {detail.data.changes.length === 0 ? (
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.versions.noChanges')}
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs">
                        {detail.data.changes.map((change) => (
                          <li key={change.key} className="flex flex-wrap gap-2">
                            <span className="text-text">{t(paramLabelKey(change.key))}</span>
                            <span className="tabular-nums text-text-muted">
                              {display(change.before)} → {display(change.after)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
