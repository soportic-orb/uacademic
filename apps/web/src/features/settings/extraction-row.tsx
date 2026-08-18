/**
 * One parameter, as a person reviews it.
 *
 * The name is in plain language, the value is editable, the confidence is
 * stated as what it actually means ("literal quote, found once" rather than a
 * number the model made up about itself), and the citation folds open into the
 * quote with a link that opens the document at that page.
 *
 * Three things are said out loud when they are true: this contradicts another
 * article, somebody edited this by hand, and this only confirms what the
 * center already had.
 */
import { citationHref, paramHelpKey, paramLabelKey, settingParam } from '@uacademic/shared'
import { AlertTriangle, BookOpen, Check, ChevronDown, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { Button } from '../../components/ui/button'
import type { ExtractionRow as Row } from './queries'

const CONFIDENCE_STYLE: Record<Row['confidence'], string> = {
  high: 'border-success/30 bg-success/10 text-success',
  medium: 'border-warning/30 bg-warning/10 text-warning',
  low: 'border-border bg-surface-muted text-text-muted',
}

export interface ExtractionRowProps {
  row: Row
  conflicted: boolean
  onResolve: (input: {
    id: string
    status: 'accepted' | 'edited' | 'rejected'
    value?: unknown
  }) => void
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function ExtractionRow({ row, conflicted, onResolve }: ExtractionRowProps) {
  const { t } = useTranslation()
  const [showCitation, setShowCitation] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => display(row.proposedValue))

  const param = settingParam(row.paramKey)
  const notFound = row.status === 'not_found'
  const decided = row.status === 'accepted' || row.status === 'edited' || row.status === 'rejected'

  const commit = () => {
    const parsed = parseDraft(draft, param?.kind ?? 'number', row.proposedValue)
    onResolve({ id: row.id, status: 'edited', value: parsed })
    setEditing(false)
  }

  return (
    <li className="border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text">{t(paramLabelKey(row.paramKey))}</p>
          <p className="mt-0.5 text-xs text-text-muted">{t(paramHelpKey(row.paramKey))}</p>

          {notFound ? (
            <p className="mt-2 text-sm text-text-muted">
              {row.reasoning ? t(row.reasoning) : t('settings.extraction.notFound.absent')}
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {editing ? (
                <input
                  aria-label={t('settings.extraction.proposed')}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="h-9 w-48 rounded-control border border-border bg-surface px-2 tabular-nums text-text"
                />
              ) : (
                <span className="tabular-nums font-semibold text-text">
                  {display(row.resolvedValue ?? row.proposedValue)}
                  {row.unit ? (
                    <span className="ml-1 text-xs text-text-muted">{row.unit}</span>
                  ) : null}
                </span>
              )}

              <span className="text-xs text-text-muted">
                {t('settings.extraction.current')}: {display(row.currentValue)}
              </span>

              <span
                className={`rounded-control border px-2 py-0.5 text-xs ${CONFIDENCE_STYLE[row.confidence]}`}
              >
                {t(`settings.extraction.confidence.${row.confidence}`)}
              </span>
            </div>
          )}

          {conflicted ? (
            <p className="mt-2 flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3" aria-hidden="true" />
              {t('settings.extraction.conflict')}
            </p>
          ) : null}

          {row.manualOverride ? (
            <p className="mt-1 text-xs text-warning">{t('settings.extraction.manualOverride')}</p>
          ) : null}

          {row.exceptionNote ? (
            <p className="mt-2 rounded-control border border-border bg-surface-muted p-2 text-xs text-text">
              <span className="font-medium">{t('settings.extraction.exception')}: </span>
              {row.exceptionNote}
            </p>
          ) : null}
        </div>

        {!notFound ? (
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <>
                <Button size="sm" onClick={commit}>
                  {t('common.save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant={row.status === 'accepted' ? 'primary' : 'secondary'}
                  aria-pressed={row.status === 'accepted'}
                  onClick={() => onResolve({ id: row.id, status: 'accepted' })}
                >
                  <Check className="size-4" aria-hidden="true" />
                  {t('settings.extraction.accept')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings.extraction.edit')}
                  title={t('settings.extraction.edit')}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={row.status === 'rejected'}
                  aria-label={t('settings.extraction.reject')}
                  title={t('settings.extraction.reject')}
                  onClick={() => onResolve({ id: row.id, status: 'rejected' })}
                >
                  <X className="size-4 text-danger" aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {row.citation ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowCitation(!showCitation)}
            aria-expanded={showCitation}
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            <ChevronDown
              className={`size-3 transition-transform ${showCitation ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            {showCitation
              ? t('settings.extraction.hideCitation')
              : t('settings.extraction.showCitation')}
          </button>

          {showCitation ? (
            <div className="mt-2 rounded-control border border-border bg-surface-muted p-3 text-xs">
              <blockquote className="border-l-2 border-primary pl-2 italic text-text">
                {row.citation.quote}
              </blockquote>
              <p className="mt-1 text-text-muted">
                {[row.citation.section, row.citation.page ? `p. ${row.citation.page}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {row.reasoning && !row.reasoning.startsWith('settings.') ? (
                <p className="mt-1 text-text-muted">{row.reasoning}</p>
              ) : null}
              <Link
                to={citationHref({
                  documentId: row.citation.documentId,
                  title: '',
                  page: row.citation.page,
                  section: row.citation.section,
                  chunkId: null,
                })}
                className="mt-2 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <BookOpen className="size-3" aria-hidden="true" />
                {t('settings.extraction.openViewer')}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {decided ? (
        <p className="mt-2 text-xs text-text-muted">{t(`settings.extraction.${row.status}`)}</p>
      ) : null}
    </li>
  )
}

/** The edited text, back into the type the parameter actually holds. */
function parseDraft(draft: string, kind: string, fallback: unknown): unknown {
  const text = draft.trim()

  if (kind === 'boolean') return text === '✓' || text.toLowerCase() === 'true'
  if (kind === 'time' || kind === 'date') return text
  if (kind === 'collection' || kind === 'weekdays') {
    try {
      return JSON.parse(text)
    } catch {
      return fallback
    }
  }

  const numeric = Number(text.replace(',', '.'))
  return Number.isFinite(numeric) ? numeric : fallback
}
