import type { Role } from '@uacademic/shared'
import { applyMenuLayout } from '@uacademic/shared'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

import { navItemsForRoles } from '../../app/navigation'
import { pendingFor, usePendingCounts } from '../../features/navigation/pending'
import { useMenuLayout } from '../../features/settings/menu-layout'
import { Logo } from '../brand/logo'
import { cn } from '../../lib/cn'
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
        {entries.map((entry) => {
          if (entry.kind === 'separator') {
            // A rule, and the person's own label above it when they wrote one.
            // `role="presentation"` because it groups nothing structurally:
            // the list below it is one list, and pretending otherwise would
            // make a screen reader announce groups that do not exist.
            return (
              <li key={entry.id} role="presentation" className="pt-3 first:pt-0">
                {entry.label && !collapsed ? (
                  <span className="block px-3 pb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
                    {entry.label}
                  </span>
                ) : null}
                <hr className="border-border" />
              </li>
            )
          }

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
                  The number alone says nothing aloud — "3" beside "Class
                  changes" is not a sentence — so the badge is hidden from
                  assistive technology and the words follow the name instead.
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
