/**
 * The control that puts a listing's columns away.
 *
 * What it hides is kept on the account rather than in the browser — see
 * `hooks/use-columns.ts`, which holds the arrangement itself.
 */
import { Columns3 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ColumnVisibility } from '../../hooks/use-columns'
import { cn } from '../../lib/cn'

export function ColumnPicker({ columns }: { columns: ColumnVisibility }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-10 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-text hover:bg-surface-raised"
      >
        <Columns3 className="size-4" aria-hidden="true" />
        {t('common.columns')}
      </button>

      {open ? (
        <>
          {/*
            A click anywhere else closes it. It is a button rather than a bare
            overlay so that the keyboard can reach it too, and it carries the
            same name the toggle does.
          */}
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="group"
            aria-label={t('common.columns')}
            className={cn(
              'absolute right-0 z-50 mt-1 max-h-72 w-60 overflow-y-auto rounded-control',
              'border border-border bg-surface p-2 shadow-lg',
            )}
          >
            {columns.choices.map((choice) => (
              <label key={choice.key} className="flex items-center gap-2 p-1 text-sm text-text">
                <input
                  type="checkbox"
                  checked={columns.shows(choice.key)}
                  onChange={() => columns.toggle(choice.key)}
                  className="size-4 rounded border-border"
                />
                {choice.label}
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
