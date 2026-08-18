/**
 * "Why does this rule apply?"
 *
 * This is the end of the chain the whole phase exists for. The planner refuses
 * a class, the tooltip says the assignment exceeds the contracted capacity,
 * and this button turns that into: which parameter says so, what it is set to,
 * which article of which document put it there — and one click into the
 * viewer, open at that page with the paragraph highlighted.
 *
 * When a parameter has no regulation behind it, it says so. Implying that a
 * default is somebody's rule would be worse than admitting it is ours.
 */
import { citationHref, paramLabelKey, paramsForMessageKey } from '@uacademic/shared'
import { BookOpen, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useParamProvenance } from './queries'

export interface WhyThisRuleProps {
  /** The i18n key of the constraint that blocked the action. */
  messageKey: string
}

export function WhyThisRule({ messageKey }: WhyThisRuleProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // A rule with no parameter behind it — two classes in one room — has nothing
  // to explain: it is arithmetic, not regulation.
  const paramKey = paramsForMessageKey(messageKey)[0] ?? null
  const provenance = useParamProvenance(open ? paramKey : null)

  if (!paramKey) return null

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
      >
        <ChevronDown
          className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
        {t('settings.why.label')}
      </button>

      {open ? (
        <div className="mt-2 rounded-control border border-border bg-surface-muted p-3 text-xs text-text">
          <p>{t('settings.why.from', { param: t(paramLabelKey(paramKey)) })}</p>

          {provenance.data ? (
            <>
              <p className="mt-1 tabular-nums text-text-muted">
                {t('settings.why.value', { value: String(provenance.data.value ?? '—') })}
              </p>

              {provenance.data.quote ? (
                <>
                  <blockquote className="mt-2 border-l-2 border-primary pl-2 italic text-text-muted">
                    {provenance.data.quote}
                  </blockquote>
                  <p className="mt-1 text-text-muted">
                    {[
                      provenance.data.documentTitle,
                      provenance.data.section,
                      provenance.data.page ? `p. ${provenance.data.page}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {provenance.data.documentId ? (
                    <Link
                      to={citationHref({
                        documentId: provenance.data.documentId,
                        title: provenance.data.documentTitle ?? '',
                        page: provenance.data.page,
                        section: provenance.data.section,
                        chunkId: provenance.data.chunkId,
                      })}
                      className="mt-2 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                    >
                      <BookOpen className="size-3" aria-hidden="true" />
                      {t('settings.why.open')}
                    </Link>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-text-muted">{t('settings.why.noSource')}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-text-muted">{t('common.loading')}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
