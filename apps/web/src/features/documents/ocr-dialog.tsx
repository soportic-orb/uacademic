/**
 * Reading a scanned PDF with the model's vision costs money per page, so the
 * question is put with the bill attached: how many pages, roughly how many
 * tokens. Nobody should discover the cost afterwards.
 */
import { ScanText } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/feedback/states'
import { useOcrEstimate } from './queries'

export interface OcrDialogProps {
  documentId: string
  title: string
  onClose: () => void
  onConfirm: () => void
}

export function OcrDialog({ documentId, title, onClose, onConfirm }: OcrDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const estimate = useOcrEstimate(documentId)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Two ways this is a no: the center switched vision reading off, or the
  // document is longer than the center is willing to pay for.
  const blocked = estimate.data ? !estimate.data.allowed || estimate.data.tooLong : false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        aria-label={t('documents.ocr.title')}
        className="relative w-full max-w-lg rounded-card border border-border bg-surface-raised p-6 shadow-overlay"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text">
          <ScanText className="size-5 text-primary" aria-hidden="true" />
          {t('documents.ocr.title')}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{title}</p>

        <div className="mt-4 text-sm text-text">
          {estimate.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : estimate.isError ? (
            <p className="text-danger">{t('states.errorDescription')}</p>
          ) : !estimate.data.allowed ? (
            <p>{t('documents.ocr.disabled')}</p>
          ) : estimate.data.tooLong ? (
            <p>{t('documents.ocr.tooLong', { max: estimate.data.maxPages })}</p>
          ) : (
            <p>
              {t('documents.ocr.description', {
                pages: estimate.data.pages,
                tokens: estimate.data.estimatedTokens,
              })}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={estimate.isPending || estimate.isError || blocked} onClick={onConfirm}>
            {t('documents.ocr.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
