import type { SessionUser } from '@uacademic/shared'
import { formatPersonName } from '@uacademic/shared'
import { Bell, LogOut, Menu, Search, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useSession } from '../../auth/session'
import { useToast } from '../../hooks/use-toast'
import { DEMO_IDENTITIES, useSessionStore } from '../../stores/session'
import { Button } from '../ui/button'

export interface HeaderProps {
  user: SessionUser | undefined
  onOpenSearch: () => void
  onToggleSidebar: () => void
}

/** Development and e2e only; the API refuses this mode in production. */
const MOCK_AUTH = import.meta.env.VITE_AUTH_MODE === 'mock'

export function Header({ user, onOpenSearch, onToggleSidebar }: HeaderProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const { signOut } = useSession()
  const centerId = useSessionStore((state) => state.centerId)
  const setCenterId = useSessionStore((state) => state.setCenterId)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const setMockUserEmail = useSessionStore((state) => state.setMockUserEmail)

  const centers = user?.memberships ?? []
  const uniqueCenters = centers.filter(
    (membership, index) =>
      centers.findIndex((other) => other.centerId === membership.centerId) === index,
  )

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={t('layout.toggleSidebar')}
        onClick={onToggleSidebar}
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>

      <span className="text-base font-semibold text-primary md:hidden">{t('common.appName')}</span>

      {/* Center selector: only shown when the user actually has more than one */}
      {uniqueCenters.length > 1 ? (
        <label className="hidden items-center gap-2 md:flex">
          <span className="sr-only">{t('layout.centerSelector')}</span>
          <select
            value={centerId ?? ''}
            onChange={(event) => setCenterId(event.target.value)}
            className="h-9 rounded-control border border-border bg-surface px-2 text-sm text-text"
          >
            {uniqueCenters.map((membership) => (
              <option key={membership.centerId} value={membership.centerId}>
                {membership.centerName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-auto flex h-9 items-center gap-2 rounded-control border border-border bg-surface-muted px-3 text-sm text-text-muted transition-colors hover:text-text md:w-80 md:justify-start"
        aria-label={t('layout.globalSearch')}
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden md:inline">{t('layout.searchPlaceholder')}</span>
        <kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 text-xs md:inline">
          {'⌘K'}
        </kbd>
      </button>

      <Button
        variant="ghost"
        size="icon"
        aria-label={t('layout.notifications')}
        onClick={() => toast.info('layout.notificationsEmpty')}
      >
        <Bell className="size-5" aria-hidden="true" />
      </Button>

      {/*
        Phase 0 identity switcher, kept only for local development and the e2e
        suite. In every other build the real signed-in user is shown.
      */}
      {MOCK_AUTH ? (
        <label className="flex items-center gap-2">
          <span className="sr-only">{t('layout.demoUser')}</span>
          <select
            value={mockUserEmail}
            onChange={(event) => setMockUserEmail(event.target.value)}
            className="h-9 max-w-40 rounded-control border border-border bg-surface px-2 text-sm text-text md:max-w-56"
          >
            {DEMO_IDENTITIES.map((identity) => (
              <option key={identity.email} value={identity.email}>
                {t(identity.labelKey)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex items-center gap-1">
        <Link
          to="/profile"
          className="flex h-9 items-center gap-2 rounded-control px-2 text-sm text-text hover:bg-surface-muted"
          aria-label={t('layout.userMenu')}
        >
          <UserRound className="size-5" aria-hidden="true" />
          <span className="hidden max-w-40 truncate md:inline">
            {user ? formatPersonName(user.firstName, user.lastName) : ''}
          </span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          aria-label={t('auth.signOut')}
          onClick={() => {
            void signOut().then(() => toast.success('auth.signedOut'))
          }}
        >
          <LogOut className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </header>
  )
}
