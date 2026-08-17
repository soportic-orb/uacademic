import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  /** i18n key for the action label. */
  labelKey: string
  onClick: () => void
}

export interface ToastInput {
  variant?: ToastVariant
  /** i18n key. Preferred: keeps the toast trilingual (R1). */
  messageKey?: string
  /** Already-localised text, e.g. an API error message. */
  message?: string
  params?: Record<string, string | number>
  descriptionKey?: string
  /** A toast that needs a decision stays until it is acted on or dismissed. */
  persistent?: boolean
  action?: ToastAction
  durationMs?: number
}

export interface Toast extends ToastInput {
  id: string
  variant: ToastVariant
  createdAt: number
}

interface ToastState {
  toasts: Toast[]
  push: (input: ToastInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

/** CLAUDE.md §4: success 4 s, error 6 s, at most three stacked. */
export const TOAST_DURATIONS: Record<ToastVariant, number> = {
  success: 4_000,
  error: 6_000,
  warning: 6_000,
  info: 4_000,
}

export const MAX_TOASTS = 3

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (input) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const variant = input.variant ?? 'info'
    const toast: Toast = { ...input, id, variant, createdAt: Date.now() }

    set((state) => {
      // Oldest toast makes room for the newest one.
      const next = [...state.toasts, toast]
      const dropped = next.slice(0, Math.max(0, next.length - MAX_TOASTS))
      for (const stale of dropped) clearTimer(stale.id)
      return { toasts: next.slice(-MAX_TOASTS) }
    })

    if (!input.persistent) {
      const duration = input.durationMs ?? TOAST_DURATIONS[variant]
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), duration),
      )
    }

    return id
  },

  dismiss: (id) => {
    clearTimer(id)
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  clear: () => {
    for (const id of timers.keys()) clearTimer(id)
    set({ toasts: [] })
  },
}))
