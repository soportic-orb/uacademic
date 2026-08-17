import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '../src/components/feedback/toaster'
import { MAX_TOASTS, type ToastInput, useToastStore } from '../src/stores/toast'

function push(input: ToastInput) {
  act(() => {
    useToastStore.getState().push(input)
  })
}

describe('toasts', () => {
  beforeEach(() => {
    act(() => useToastStore.getState().clear())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders in a polite live region, which is how the app announces anything', () => {
    render(<Toaster />)
    const region = screen.getByRole('status')

    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveClass('top-0')
  })

  it('translates the message key into the active language', () => {
    render(<Toaster />)
    push({ variant: 'success', messageKey: 'toast.themeChanged' })

    expect(screen.getByText('Aparença actualitzada')).toBeInTheDocument()
  })

  it('shows an already-localised message untouched', () => {
    render(<Toaster />)
    push({ variant: 'error', message: 'El recurs pertany a un altre centre.' })

    expect(screen.getByText('El recurs pertany a un altre centre.')).toBeInTheDocument()
  })

  it('stacks at most three, dropping the oldest', () => {
    render(<Toaster />)
    for (const key of ['common.save', 'common.cancel', 'common.close', 'common.retry']) {
      push({ variant: 'info', messageKey: key })
    }

    expect(useToastStore.getState().toasts).toHaveLength(MAX_TOASTS)
    expect(screen.queryByText('Desa')).not.toBeInTheDocument()
    expect(screen.getByText('Torna-ho a provar')).toBeInTheDocument()
  })

  it('auto-dismisses success after 4 s and error after 6 s', () => {
    vi.useFakeTimers()
    render(<Toaster />)

    act(() => {
      useToastStore.getState().push({ variant: 'success', messageKey: 'common.save' })
      useToastStore.getState().push({ variant: 'error', messageKey: 'errors.generic' })
    })
    expect(useToastStore.getState().toasts).toHaveLength(2)

    act(() => vi.advanceTimersByTime(4_000))
    expect(useToastStore.getState().toasts.map((toast) => toast.variant)).toEqual(['error'])

    act(() => vi.advanceTimersByTime(2_000))
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps a persistent toast until it is dismissed', async () => {
    const user = userEvent.setup()
    render(<Toaster />)
    push({ variant: 'warning', messageKey: 'errors.conflict', persistent: true })

    await user.click(screen.getByRole('button', { name: "Descarta l'avís" }))

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(0))
  })
})
