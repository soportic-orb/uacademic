import type { Role } from '@uacademic/shared'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { navItemsForRoles } from '../../app/navigation'
import { cn } from '../../lib/cn'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  roles: readonly Role[]
}

/**
 * ⌘K palette. Phase 0 searches the navigation; phase 1 adds subjects, teachers
 * and spaces.
 *
 * Keyboard-only usable (R8): arrows move, Enter navigates, Escape closes from
 * anywhere inside the dialog, the backdrop is a real button rather than a div
 * with a click handler, and focus returns to wherever it came from on close.
 */
export function CommandPalette({ open, onClose, roles }: CommandPaletteProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const items = navItemsForRoles(roles).filter((item) =>
    t(`nav.${item.key}`).toLowerCase().includes(query.trim().toLowerCase()),
  )

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()

    // Escape is handled on the window rather than on the dialog node: it must
    // close the palette even if focus has wandered outside it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const go = (index: number) => {
    const item = items[index]
    if (!item) return
    void navigate(item.path)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 size-full cursor-default bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('layout.globalSearch')}
        className="relative w-full max-w-lg overflow-hidden rounded-card border border-border bg-surface-raised shadow-overlay"
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((index) => Math.min(index + 1, items.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => Math.max(index - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              go(activeIndex)
            }
          }}
          placeholder={t('layout.searchPlaceholder')}
          aria-label={t('layout.searchPlaceholder')}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-base text-text outline-none"
        />

        <ul className="max-h-80 overflow-y-auto p-2">
          {items.map((item, index) => (
            <li key={item.key}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => go(index)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm',
                  index === activeIndex ? 'bg-primary-surface text-primary-strong' : 'text-text',
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {t(`nav.${item.key}`)}
              </button>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-text-muted">
              {t('states.emptyDefaultTitle')}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}
