import type { Role, SessionUser } from '@uacademic/shared'
import { formatPersonName } from '@uacademic/shared'
import { LogOut, Menu, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useSession } from '../../auth/session'
import { Logo } from '../brand/logo'
import { NotificationBell } from '../../features/notifications/notification-bell'
import { useToast } from '../../hooks/use-toast'
import { clearApiCache } from '../../app/service-worker'
import { DEMO_IDENTITIES, useSessionStore } from '../../stores/session'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'

export interface HeaderProps {
  user: SessionUser | undefined
  /** Every role this person holds in the active center, most privileged first. */
  heldRoles: Role[]
  /** The one the interface is currently drawn for. */
  activeRole: Role | undefined
  onOpenSearch: () => void
  onToggleSidebar: () => void
}

/** Development and e2e only; the API refuses this mode in production. */
const MOCK_AUTH = import.meta.env.VITE_UACADEMIC_AUTH_MODE === 'mock'

export function Header({
  user,
  heldRoles,
  activeRole,
  onOpenSearch,
  onToggleSidebar,
}: HeaderProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const { signOut } = useSession()
  const centerId = useSessionStore((state) => state.centerId)
  const setCenterId = useSessionStore((state) => state.setCenterId)
  const setActiveRole = useSessionStore((state) => state.setActiveRole)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const setMockUserEmail = useSessionStore((state) => state.setMockUserEmail)

  /*
    One row per center, grouped under its university. Somebody who works at two
    of them has to be able to tell which "Facultat d'Educació" is which, and
    the university name is the only thing that does it.
  */
  const memberships = user?.memberships ?? []
  const universities = new Map<string, { name: string; centers: { id: string; name: string }[] }>()
  for (const membership of memberships) {
    const entry = universities.get(membership.universityId) ?? {
      name: membership.universityName,
      centers: [],
    }
    if (!entry.centers.some((center) => center.id === membership.centerId)) {
      entry.centers.push({ id: membership.centerId, name: membership.centerName })
    }
    universities.set(membership.universityId, entry)
  }
  const centerCount = [...universities.values()].reduce(
    (total, university) => total + university.centers.length,
    0,
  )

  return (
    <header className="z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={t('layout.toggleSidebar')}
        onClick={onToggleSidebar}
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>

      <Logo className="text-base md:hidden" title={t('common.appName')} />

      {/* Only shown when there is a choice to make. */}
      {centerCount > 1 ? (
        <label className="hidden items-center gap-2 md:flex">
          <span className="sr-only">{t('layout.centerSelector')}</span>
          <select
            value={centerId ?? ''}
            onChange={(event) => {
              // The cached timetable belongs to the center it was read from.
              clearApiCache()
              setCenterId(event.target.value)
            }}
            className="h-9 max-w-56 rounded-control border border-border bg-surface px-2 text-sm text-text"
          >
            {[...universities.entries()].map(([universityId, university]) => (
              // Grouped even when there is only one university: the group
              // label is what tells somebody which institution this is.
              <optgroup key={universityId} label={university.name}>
                {university.centers.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}

      {/* Same again for the role, when this person holds more than one here. */}
      {heldRoles.length > 1 ? (
        <label className="hidden items-center gap-2 md:flex">
          <span className="sr-only">{t('layout.roleSelector')}</span>
          <select
            value={activeRole ?? heldRoles[0]}
            onChange={(event) => setActiveRole(event.target.value)}
            className="h-9 rounded-control border border-border bg-surface px-2 text-sm text-text"
          >
            {heldRoles.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-auto flex h-9 items-center gap-2 rounded-control border border-border bg-surface-muted px-3 text-sm text-text-muted transition-colors hover:text-text md:w-96 md:justify-start xl:w-[28rem]"
        aria-label={t('layout.globalSearch')}
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        {/*
          Nowrap and not just wide: the placeholder is a full sentence and it is
          longest in Catalan, so on a narrow desktop it used to break onto a
          second line inside a 36px-high control.
        */}
        <span className="hidden truncate whitespace-nowrap md:inline">
          {t('layout.searchPlaceholder')}
        </span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-xs md:inline">
          {'⌘K'}
        </kbd>
      </button>

      <NotificationBell />

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
          <Avatar
            name={user ? formatPersonName(user.firstName, user.lastName) : ''}
            url={user?.avatarUrl}
            size="sm"
          />
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
