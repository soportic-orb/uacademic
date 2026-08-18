/**
 * What the answer rested on, under the answer.
 *
 * A citation the reader cannot check is a claim, so every chip is a link into
 * the library at the exact fragment — not at page one of a 90-page PDF. A
 * document that was in context but never cited still gets a chip, without a
 * page: it says "I read this", which is a different and also useful statement.
 */
import { type Citation, citationHref, formatCitation } from '@uacademic/shared'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import type { DocumentSource } from './queries'

export interface SourceChipsProps {
  documents: DocumentSource[]
  citations: Citation[]
}

export function SourceChips({ documents, citations }: SourceChipsProps) {
  const { t } = useTranslation()

  // A document cited more than once earns one chip per place it was cited;
  // one never cited earns a chip without a page.
  const chips: Citation[] = [
    ...citations,
    ...documents
      .filter((document) => !citations.some((entry) => entry.documentId === document.documentId))
      .map((document) => ({
        documentId: document.documentId,
        title: document.title,
        page: null,
        section: null,
        chunkId: null,
      })),
  ]

  if (chips.length === 0) return null

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-text-muted">{t('documents.sources')}</p>
      <ul className="mt-1 flex flex-wrap gap-1">
        {chips.map((citation, index) => (
          <li key={`${citation.documentId}-${citation.chunkId ?? index}`}>
            <Link
              to={citationHref(citation)}
              className="inline-flex items-center gap-1 rounded-control border border-border bg-surface-muted px-2 py-0.5 text-xs text-text hover:border-primary hover:text-primary"
            >
              <FileText className="size-3" aria-hidden="true" />
              {formatCitation(citation)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
