/**
 * Arranging a menu: your own, and — for the platform administrator — the one
 * each role starts with.
 *
 * Up and down buttons rather than drag and drop: this is a list of eleven
 * things, the whole interaction is "one step that way", and a keyboard
 * alternative is not an afterthought here (R8) — it is simply the thing.
 *
 * Every press saves. There is no draft to lose and no button to forget, and
 * the sidebar beside the card moves as the presses land, which is the fastest
 * way to see whether the arrangement is the one you wanted.
 */
import type { DefaultedRole, MenuEntry, Role } from '@uacademic/shared'
import {
  insertSeparator,
  moveEntry,
  orderMenuEntries,
  removeSeparator,
  renameSeparator,
} from '@uacademic/shared'
import { ArrowDown, ArrowUp, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { navItemsForRoles } from '../../app/navigation'
import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import {
  DEFAULT_ROLE_ORDER,
  newSeparatorId,
  useMenuDefaults,
  useMenuLayout,
  useSaveMenuDefaults,
  useSaveMenuLayout,
} from './menu-layout'

const CONTROL = 'h-9 w-full rounded-control border border-border bg-surface px-2 text-sm text-text'

/** Your own menu. */
export function MenuCard({ roles }: { roles: readonly Role[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useMenuLayout()
  const save = useSaveMenuLayout()

  const items = navItemsForRoles(roles)

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const persist = (next: MenuEntry[]) =>
    save.mutate(next, {
      onSuccess: () => toast.success('settings.menu.savedToast'),
      onError: (error) => {
        if (error instanceof ApiRequestError)
          toast.raw({ variant: 'error', message: error.localizedMessage })
        else toast.error('errors.generic')
      },
    })

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title={t('settings.menu.title')}
        description={t('settings.menu.hint')}
        action={
          // Only when there is something to put back. Restoring means dropping
          // this person's own arrangement and following the role's default
          // again, which is not the same as the order the product declares.
          query.data.personalised ? (
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
          ) : null
        }
      />
      <CardBody>
        <Arranger
          items={items}
          entries={query.data.entries}
          onSave={persist}
          saving={save.isPending}
          idPrefix="own"
        />
      </CardBody>
    </Card>
  )
}

/**
 * The menu each role starts with.
 *
 * A starting point, not a rule: anybody may arrange their own afterwards, and
 * somebody who has keeps theirs when this changes. A menu somebody sat down
 * and arranged must not be rewritten under them by an administrator tidying
 * up, which is the whole reason this is a default rather than a layout.
 */
export function MenuDefaultsCard() {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useMenuDefaults(true)
  const save = useSaveMenuDefaults()
  const [role, setRole] = useState<DefaultedRole>('TEACHER')

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const defaults = query.data.defaults
  const entries = defaults[role] ?? []
  // The menu of somebody who holds exactly this role: what is being arranged
  // is their starting point, not the administrator's own.
  const items = navItemsForRoles([role])

  const persist = (next: MenuEntry[]) =>
    save.mutate(
      { ...defaults, [role]: next },
      {
        onSuccess: () => toast.success('settings.menu.defaults.saved'),
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title={t('settings.menu.defaults.title')}
        description={t('settings.menu.defaults.hint')}
        action={
          entries.length > 0 ? (
            <Button variant="secondary" onClick={() => persist([])}>
              <RotateCcw className="size-4" aria-hidden="true" />
              {t('settings.menu.defaults.clear')}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('settings.menu.defaults.role')}
        >
          {DEFAULT_ROLE_ORDER.map((option) => (
            <Button
              key={option}
              variant={role === option ? 'primary' : 'secondary'}
              aria-pressed={role === option}
              onClick={() => setRole(option as DefaultedRole)}
            >
              {t(`roles.${option}`)}
            </Button>
          ))}
        </div>

        <p className="text-xs text-text-muted">
          {entries.length > 0
            ? t('settings.menu.defaults.set')
            : t('settings.menu.defaults.notSet')}
        </p>

        <Arranger
          items={items}
          entries={entries}
          onSave={persist}
          saving={save.isPending}
          idPrefix={`default-${role}`}
        />
      </CardBody>
    </Card>
  )
}

/* ───────────────────────────── the editor itself ───────────────────────── */

function Arranger({
  items,
  entries: stored,
  onSave,
  saving,
  idPrefix,
}: {
  items: readonly { key: string }[]
  entries: readonly MenuEntry[]
  onSave: (next: MenuEntry[]) => void
  saving: boolean
  /** Distinguishes the two editors when both are on screen. */
  idPrefix: string
}) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')

  /*
    A draft, saved on request.

    Every press used to write to the server, which meant typing a separator's
    label sent one request per keystroke — and those race: the answer to "Doc"
    could land after the answer to "Docènc" and put the shorter one back. What
    looked like "the label did not save" was two requests finishing out of
    order.
  */
  const settled = useMemo(() => orderMenuEntries(items, stored), [items, stored])
  const [entries, setEntries] = useState<MenuEntry[]>(settled)

  /*
    Re-seed when the stored value really changes — a save landing, or the
    administrator switching to another role's default.

    Keyed on the content rather than on the array, because `settled` is a new
    array on every render: depending on it directly would throw the draft away
    between one keystroke and the next.
  */
  const settledKey = JSON.stringify(settled)
  useEffect(() => {
    setEntries(orderMenuEntries(items, stored))
  }, [settledKey, items, stored])

  const dirty = JSON.stringify(entries) !== settledKey
  const onChange = setEntries

  const nameOf = (entry: MenuEntry) =>
    entry.kind === 'item' ? t(`nav.${entry.key}`) : entry.label || t('settings.menu.separator')

  return (
    <div className="space-y-4">
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
                  <span className="sr-only">{`${t('settings.menu.separatorLabel')} · ${index + 1}`}</span>
                  <input
                    value={entry.label}
                    placeholder={t('settings.menu.separatorPlaceholder')}
                    maxLength={40}
                    onChange={(event) =>
                      onChange(renameSeparator(entries, entry.id, event.target.value))
                    }
                    className={CONTROL}
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
                onClick={() => onChange(moveEntry(entries, index, -1))}
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === entries.length - 1}
                aria-label={t('settings.menu.moveDown', { name: nameOf(entry) })}
                onClick={() => onChange(moveEntry(entries, index, 1))}
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </Button>

              {entry.kind === 'separator' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('settings.menu.removeSeparator', { name: nameOf(entry) })}
                  onClick={() => onChange(removeSeparator(entries, entry.id))}
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
        A new separator goes at the top, where it is visible and one press from
        anywhere. Appending it to the bottom would put it where it is
        immediately tidied away for having nothing under it.
      */}
      <form
        className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          onChange(
            insertSeparator(entries, 1, {
              kind: 'separator',
              id: newSeparatorId(entries),
              label: label.trim(),
            }),
          )
          setLabel('')
        }}
      >
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-text-muted" htmlFor={`${idPrefix}-separator`}>
            {t('settings.menu.separatorLabel')}
          </label>
          <input
            id={`${idPrefix}-separator`}
            value={label}
            maxLength={40}
            placeholder={t('settings.menu.separatorPlaceholder')}
            onChange={(event) => setLabel(event.target.value)}
            className={CONTROL}
          />
        </div>

        <Button type="submit" variant="secondary">
          <Plus className="size-4" aria-hidden="true" />
          {t('settings.menu.addSeparator')}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <p aria-live="polite" className="text-xs text-text-muted">
          {dirty ? t('settings.menu.unsaved') : t('settings.menu.saved')}
        </p>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!dirty || saving}
            onClick={() => setEntries(settled)}
          >
            {t('common.discard')}
          </Button>
          <Button disabled={!dirty || saving} onClick={() => onSave(entries)}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
