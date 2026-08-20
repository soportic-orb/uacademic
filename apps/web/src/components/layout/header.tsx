import type { Role, SessionUser } from '@uacademic/shared'
import { formatPersonName } from '@uacademic/shared'
import { ChevronDown, LogOut, Menu, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useSession } from '../../auth/session'
import { Logo } from '../brand/logo'
import { NotificationBell } from '../../features/notifications/notification-bell'
import { useToast } from '../../hooks/use-toast'
import { clearApiCache } from '../../app/service-worker'
import { DEMO_IDENTITIES, useSessionStore } from '../../stores/session'
import { Avatar } from '../ui/avatar'
import { UniversityDialog, UniversityMark, universitiesOf } from './university-switcher'
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
  const [universityOpen, setUniversityOpen] = useState(false)
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const setMockUserEmail = useSessionStore((state) => state.setMockUserEmail)

  /*
    The university whose rules are in force, and the centers of that university
    this person can move between.

    Scoped to one university on purpose: a list mixing the faculties of two
    institutions makes somebody read every line to find theirs, and two
    faculties called "Educació" are not an unusual thing to find on one
    platform. The university is chosen first, in the dialog behind the mark.
  */
  const memberships = user?.memberships ?? []
  const universities = universitiesOf(user)
  const activeMembership = memberships.find((membership) => membership.centerId === centerId)
  const activeUniversity =
    universities.find((university) => university.id === activeMembership?.universityId) ??
    universities[0]

  const centersHere = memberships
    .filter((membership) => membership.universityId === activeUniversity?.id)
    .filter(
      (membership, index, all) =>
        all.findIndex((other) => other.centerId === membership.centerId) === index,
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

      {/*
        Whose platform this is. A button only when there is somewhere else to
        go: with one university it is a label, because a control that cannot
        change anything wastes the click it invites.
      */}
      {activeUniversity ? (
        universities.length > 1 ? (
          <button
            type="button"
            onClick={() => setUniversityOpen(true)}
            className="hidden items-center gap-2 rounded-control px-2 py-1 hover:bg-surface-muted md:flex"
            aria-haspopup="dialog"
            aria-label={t('layout.universitySelector')}
          >
            <UniversityMark name={activeUniversity.name} logoUrl={activeUniversity.logoUrl} />
            <ChevronDown className="size-4 text-text-muted" aria-hidden="true" />
          </button>
        ) : (
          <span className="hidden items-center px-2 md:flex">
            <UniversityMark name={activeUniversity.name} logoUrl={activeUniversity.logoUrl} />
          </span>
        )
      ) : null}

      {/* The centers of that university, when there is more than one. */}
      {centersHere.length > 1 ? (
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
            {centersHere.map((membership) => (
              <option key={membership.centerId} value={membership.centerId}>
                {membership.centerName}
              </option>
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
      {universityOpen ? (
        <UniversityDialog
          universities={universities}
          activeId={activeUniversity?.id}
          onPick={(university) => {
            // Landing on one of that university's centers, because a
            // university is not itself a scope: everything below is a center's.
            clearApiCache()
            setCenterId(university.firstCenterId)
            setUniversityOpen(false)
          }}
          onClose={() => setUniversityOpen(false)}
        />
      ) : null}
    </header>
  )
}
