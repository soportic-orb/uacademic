/**
 * Arranging your own menu.
 *
 * Up and down buttons rather than drag and drop: this is a list of eleven
 * things, the whole interaction is "one step that way", and a keyboard
 * alternative is not an afterthought here (R8) — it is simply the thing.
 *
 * Every press saves. There is no draft to lose and no button to forget, and
 * the sidebar beside the card moves as the presses land, which is the fastest
 * way to see whether the arrangement is the one you wanted.
 */
import type { MenuEntry, Role } from '@uacademic/shared'
import {
  applyMenuLayout,
  insertSeparator,
  isDefaultLayout,
  moveEntry,
  removeSeparator,
  renameSeparator,
} from '@uacademic/shared'
import { ArrowDown, ArrowUp, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { navItemsForRoles } from '../../app/navigation'
import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { newSeparatorId, useMenuLayout, useSaveMenuLayout } from './menu-layout'

export function MenuCard({ roles }: { roles: readonly Role[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useMenuLayout()
  const save = useSaveMenuLayout()
  const [label, setLabel] = useState('')

  const items = navItemsForRoles(roles)

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  // What is on screen is what the sidebar draws, not the raw stored list: the
  // two must not be able to disagree about where a separator ended up.
  const entries = applyMenuLayout(items, query.data.entries)

  const persist = (next: MenuEntry[]) =>
    save.mutate(next, {
      onError: (error) => {
        if (error instanceof ApiRequestError)
          toast.raw({ variant: 'error', message: error.localizedMessage })
        else toast.error('errors.generic')
      },
    })

  const nameOf = (entry: MenuEntry) =>
    entry.kind === 'item' ? t(`nav.${entry.key}`) : entry.label || t('settings.menu.separator')

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title={t('settings.menu.title')}
        description={t('settings.menu.hint')}
        action={
          isDefaultLayout(items, query.data.entries) ? null : (
            <Button
              variant="secondary"
              onClick={() => {
                persist([])
                toast.success('settings.menu.restored')
              }}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {t('settings.menu.restore')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        <ul className="divide-y divide-border">
          {entries.map((entry, index) => (
            <li
              key={entry.kind === 'item' ? entry.key : entry.id}
              className="flex items-center gap-2 py-2"
            >
              {entry.kind === 'separator' ? (
                <>
                  <Minus className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t('settings.menu.separatorLabel')}</span>
                    <input
                      value={entry.label}
                      placeholder={t('settings.menu.separatorPlaceholder')}
                      maxLength={40}
                      onChange={(event) =>
                        persist(renameSeparator(entries, entry.id, event.target.value))
                      }
                      className="h-9 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
                    />
                  </label>
                </>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {t(`nav.${entry.key}`)}
                </span>
              )}

              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  aria-label={t('settings.menu.moveUp', { name: nameOf(entry) })}
                  onClick={() => persist(moveEntry(entries, index, -1))}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === entries.length - 1}
                  aria-label={t('settings.menu.moveDown', { name: nameOf(entry) })}
                  onClick={() => persist(moveEntry(entries, index, 1))}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>

                {entry.kind === 'separator' ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('settings.menu.removeSeparator', { name: nameOf(entry) })}
                    onClick={() => persist(removeSeparator(entries, entry.id))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  // Keeps the columns aligned: an item cannot be removed, the
                  // menu is what it is made of.
                  <span className="size-9" aria-hidden="true" />
                )}
              </div>
            </li>
          ))}
        </ul>

        {/*
          A new separator goes at the top, where it is visible and one press
          from anywhere. Appending it to the bottom would put it where it is
          immediately tidied away for having nothing under it.
        */}
        <form
          className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            persist(
              insertSeparator(entries, 1, {
                kind: 'separator',
                id: newSeparatorId(entries),
                label: label.trim(),
              }),
            )
            setLabel('')
          }}
        >
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs text-text-muted">
              {t('settings.menu.separatorLabel')}
            </span>
            <input
              value={label}
              maxLength={40}
              placeholder={t('settings.menu.separatorPlaceholder')}
              onChange={(event) => setLabel(event.target.value)}
              className="h-9 w-full rounded-control border border-border bg-surface px-2 text-sm text-text"
            />
          </label>

          <Button type="submit" variant="secondary">
            <Plus className="size-4" aria-hidden="true" />
            {t('settings.menu.addSeparator')}
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
