import type { Role } from '@uacademic/shared'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

import { navItemsForRoles } from '../../app/navigation'
import { cn } from '../../lib/cn'

export interface SidebarProps {
  roles: readonly Role[]
  collapsed: boolean
  onToggle: () => void
}

/** Desktop navigation. Collapsible, keyboard reachable, labelled for AT (R8). */
export function Sidebar({ roles, collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation()
  const items = navItemsForRoles(roles)

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
        {collapsed ? null : (
          <span className="text-lg font-semibold tracking-tight text-primary">
            {t('common.appName')}
          </span>
        )}
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.key}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-surface text-primary'
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
            </NavLink>
          </li>
        ))}
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
