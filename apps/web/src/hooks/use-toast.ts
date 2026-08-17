import { useMemo } from 'react'

import { type ToastInput, useToastStore } from '../stores/toast'

export interface ToastApi {
  success: (messageKey: string, options?: Omit<ToastInput, 'variant' | 'messageKey'>) => string
  error: (messageKey: string, options?: Omit<ToastInput, 'variant' | 'messageKey'>) => string
  warning: (messageKey: string, options?: Omit<ToastInput, 'variant' | 'messageKey'>) => string
  info: (messageKey: string, options?: Omit<ToastInput, 'variant' | 'messageKey'>) => string
  /** For text already localised elsewhere, typically an API error message. */
  raw: (input: ToastInput) => string
  dismiss: (id: string) => void
}

/**
 * The only notification mechanism in the app (CLAUDE.md §4). No `alert`, no
 * inline banners, no snackbars anywhere else: everything a user must be told
 * goes through here and lands in the top-center region.
 */
export function useToast(): ToastApi {
  const push = useToastStore((state) => state.push)
  const dismiss = useToastStore((state) => state.dismiss)

  return useMemo<ToastApi>(
    () => ({
      success: (messageKey, options) => push({ ...options, variant: 'success', messageKey }),
      error: (messageKey, options) => push({ ...options, variant: 'error', messageKey }),
      warning: (messageKey, options) => push({ ...options, variant: 'warning', messageKey }),
      info: (messageKey, options) => push({ ...options, variant: 'info', messageKey }),
      raw: (input) => push(input),
      dismiss,
    }),
    [push, dismiss],
  )
}
