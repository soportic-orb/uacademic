import type { MenuSection, Role } from '@uacademic/shared'
import { applyMenuLayout, menuSections } from '@uacademic/shared'
import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

import { navItemsForRoles } from '../../app/navigation'
import { pendingFor, usePendingCounts } from '../../features/navigation/pending'
import { useMenuLayout } from '../../features/settings/menu-layout'
import { Logo } from '../brand/logo'
import { cn } from '../../lib/cn'
import { useMenuSectionsStore } from '../../stores/menu-sections'
import { PendingBadge } from './pending-badge'

export interface SidebarProps {
  roles: readonly Role[]
  collapsed: boolean
  onToggle: () => void
}

/** Desktop navigation. Collapsible, keyboard reachable, labelled for AT (R8). */
export function Sidebar({ roles, collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation()
  const items = navItemsForRoles(roles)
  const layout = useMenuLayout()
  const pending = usePendingCounts()

  /*
    The order this person put their menu in, over the entries their roles
    actually reach. The layout never adds anything: an item it does not
    mention is still drawn, at the end, so an update that adds a screen
    cannot hide it from everybody who has ever arranged their menu.
  */
  const entries = useMemo(
    () => applyMenuLayout(items, layout.data?.entries ?? []),
    [items, layout.data],
  )
  const byKey = new Map(items.map((item) => [item.key, item]))
  const sections = useMemo(() => menuSections(entries), [entries])

  const foldedSections = useMenuSectionsStore((state) => state.collapsed)
  const toggleSection = useMenuSectionsStore((state) => state.toggle)

  return (
    <nav
      aria-label={t('layout.mainNavigation')}
      className={cn(
        'hidden shrink-0 border-r border-border bg-surface transition-[width] md:flex md:flex-col',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center border-b border-border px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        {collapsed ? (
          <Logo variant="mark" className="text-2xl" title={t('common.appName')} />
        ) : (
          <Logo className="text-lg" title={t('common.appName')} />
        )}
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {sections.map((section, index) => {
          /*
            Folded away, or not. Never when the sidebar itself is down to
            icons: there is no header to fold into, and hiding entries with no
            visible reason is worse than a long list.
          */
          const id = section.separator?.id
          const folded = Boolean(id && foldedSections[id] && !collapsed)

          return (
            <li key={id ?? 'lead'}>
              {section.separator ? (
                <SectionHeader
                  section={section}
                  index={index}
                  folded={folded}
                  narrow={collapsed}
                  waiting={section.items.reduce(
                    (total, entry) => total + pendingFor(pending, entry.key),
                    0,
                  )}
                  onToggle={() => id && toggleSection(id)}
                />
              ) : null}

              {folded ? null : (
                <ul className="space-y-1">
                  {section.items.map((entry) => {
                    const item = byKey.get(entry.key)
                    if (!item) return null

                    const count = pendingFor(pending, item.key)

                    return (
                      <li key={item.key} className="relative">
                        <NavLink
                          to={item.path}
                          end={item.path === '/'}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors',
                              isActive
                                ? 'bg-primary-surface text-primary-strong'
                                : 'text-text-muted hover:bg-surface-muted hover:text-text',
                              collapsed && 'justify-center px-0',
                            )
                          }
                          title={collapsed ? t(`nav.${item.key}`) : undefined}
                        >
                          <item.icon className="size-5 shrink-0" aria-hidden="true" />
                          {collapsed ? (
                            <span className="sr-only">{t(`nav.${item.key}`)}</span>
                          ) : (
                            <span className="truncate">{t(`nav.${item.key}`)}</span>
                          )}
                          {/*
                            The number alone says nothing aloud — "3" beside
                            "Class changes" is not a sentence — so the badge is
                            hidden from assistive technology and the words
                            follow the name instead.
                          */}
                          {count > 0 ? (
                            <span className="sr-only">{t('nav.pendingSuffix', { count })}</span>
                          ) : null}
                          <PendingBadge
                            count={count}
                            className={collapsed ? 'absolute right-1 top-1' : 'ml-auto'}
                          />
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t('layout.expandSidebar') : t('layout.collapseSidebar')}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-5" aria-hidden="true" />
          ) : (
            <>
              <PanelLeftClose className="size-5" aria-hidden="true" />
              <span>{t('layout.collapseSidebar')}</span>
            </>
          )}
        </button>
      </div>
    </nav>
  )
}

/**
 * The line that opens a section, and folds it.
 *
 * The whole row is the control rather than a chevron beside a label: a 16-pixel
 * target next to a name that is already the obvious thing to press is a target
 * people miss. `aria-expanded` carries the state, so the name does not have to
 * change between "show" and "hide".
 *
 * A folded section that hides something waiting to be answered would hide the
 * badge with it, so the count comes up to the header.
 */
function SectionHeader({
  section,
  index,
  folded,
  narrow,
  waiting,
  onToggle,
}: {
  section: MenuSection
  index: number
  folded: boolean
  narrow: boolean
  waiting: number
  onToggle: () => void
}) {
  const { t } = useTranslation()

  // Down to icons there is no room for a name, and nothing to fold into.
  if (narrow) return <hr className="my-3 border-border" />

  const name = section.separator?.label || t('layout.section', { position: index })

  return (
    <>
      <hr className="mb-1 mt-3 border-border first:mt-0" />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!folded}
        className="flex w-full items-center gap-2 rounded-control px-3 py-1 text-left text-xs font-medium uppercase tracking-wide text-text-muted transition-colors hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="truncate">{name}</span>

        {/* Only when it is folded: unfolded, the badges are on the entries. */}
        {folded && waiting > 0 ? (
          <>
            <PendingBadge count={waiting} className="ml-auto" />
            <span className="sr-only">{t('nav.pendingSuffix', { count: waiting })}</span>
          </>
        ) : null}

        {folded ? (
          <ChevronDown
            className={cn('size-4 shrink-0', waiting > 0 ? '' : 'ml-auto')}
            aria-hidden="true"
          />
        ) : (
          <ChevronUp className="ml-auto size-4 shrink-0" aria-hidden="true" />
        )}
      </button>
    </>
  )
}
