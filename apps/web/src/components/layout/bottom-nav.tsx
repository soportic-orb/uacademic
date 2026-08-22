import type { Role } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

import { mobileNavItems } from '../../app/navigation'
import { useMenuLayout } from '../../features/settings/menu-layout'
import { cn } from '../../lib/cn'

/** Five entries, thumb-sized targets, hidden from desktop (CLAUDE.md §4). */
export function BottomNav({ roles }: { roles: readonly Role[] }) {
  const { t } = useTranslation()
  const layout = useMenuLayout()
  // The bar follows the same arrangement as the sidebar: the four entries this
  // person put highest, rather than the four the product declares first.
  const items = mobileNavItems(
    roles,
    (layout.data?.entries ?? []).filter((entry) => entry.kind === 'item').map((entry) => entry.key),
  )

  return (
    <nav
      aria-label={t('layout.bottomNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => (
          <li key={item.key}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-xs transition-colors',
                  isActive ? 'text-primary' : 'text-text-muted',
                )
              }
            >
              <item.icon className="size-5" aria-hidden="true" />
              <span className="max-w-full truncate">{t(`nav.${item.key}`)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
