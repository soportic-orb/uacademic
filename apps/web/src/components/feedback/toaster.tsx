import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '../../lib/cn'
import { type Toast, type ToastVariant, useToastStore } from '../../stores/toast'

const VARIANT_ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const satisfies Record<ToastVariant, unknown>

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-success/40 text-success',
  error: 'border-danger/40 text-danger',
  warning: 'border-warning/40 text-warning',
  info: 'border-primary/40 text-primary',
}

/**
 * Top-center toast region (CLAUDE.md §4). `aria-live="polite"` so a screen
 * reader announces it without interrupting, and every toast is dismissible by
 * keyboard (R8).
 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  const { t } = useTranslation()

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-4"
      role="status"
      aria-live="polite"
      aria-label={t('toast.region')}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { t } = useTranslation()
  const Icon = VARIANT_ICON[toast.variant]

  const message = toast.messageKey ? t(toast.messageKey, toast.params ?? {}) : (toast.message ?? '')

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card border bg-surface-raised p-4 shadow-overlay',
        'motion-safe:animate-[toast-in_150ms_ease-out]',
        VARIANT_STYLES[toast.variant],
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{message}</p>
        {toast.descriptionKey ? (
          <p className="mt-1 text-sm text-text-muted">
            {t(toast.descriptionKey, toast.params ?? {})}
          </p>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick()
              onDismiss()
            }}
            className="mt-2 rounded-control text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {t(toast.action.labelKey)}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('toast.dismiss')}
        className="rounded-control p-1 text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
