import type { Role } from '@uacademic/shared'
import { sortRolesByRank } from '@uacademic/shared'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'

import { useSession } from '../../auth/session'
import { useRealtime } from '../../features/realtime/use-realtime'
import { SupportLauncher } from '../../features/support/support-launcher'
import { useSessionStore } from '../../stores/session'
import { CardSkeleton } from '../feedback/states'
import { BottomNav } from './bottom-nav'
import { CommandPalette } from './command-palette'
import { Header } from './header'
import { Sidebar } from './sidebar'

export function AppShell() {
  const { t } = useTranslation()
  const { user, isLoading: isPending } = useSession()
  const centerId = useSessionStore((state) => state.centerId)
  const activeRole = useSessionStore((state) => state.activeRole)
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // One subscription for the whole session: the bell, the threads and the
  // published timetable all refresh from it (SSE, or polling where a stream
  // cannot be held open).
  useRealtime()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Roles are always the ones the server resolved for the active center (R3).
  const held: Role[] = sortRolesByRank(
    (user?.memberships ?? [])
      .filter((membership) => !centerId || membership.centerId === centerId)
      .map((membership) => membership.role),
  )

  /*
    What the interface shows: one role at a time when this person holds more
    than one here, defaulting to the most privileged. It narrows the menu, it
    never widens it — a role that is not held is not selectable, and the server
    re-checks every request against the database regardless of what is drawn.
  */
  const roles: Role[] = held.includes(activeRole as Role)
    ? [activeRole as Role]
    : held.length > 1
      ? [held[0] as Role]
      : held

  /*
    The viewport is the frame, not the page: the shell is exactly one screen
    tall and hides its own overflow, so the sidebar and the header stay put and
    the only thing that scrolls is the content column.
  */
  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-text"
      >
        {t('layout.skipToContent')}
      </a>

      <Sidebar roles={roles} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          user={user}
          heldRoles={held}
          activeRole={roles[0]}
          onOpenSearch={() => setSearchOpen(true)}
          onToggleSidebar={() => setCollapsed((v) => !v)}
        />

        <main id="main" className="flex-1 overflow-y-auto px-4 pb-24 pt-6 md:px-8 md:pb-8">
          {isPending ? (
            <div className="grid gap-4 md:grid-cols-3">
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : (
            <Outlet context={{ roles }} />
          )}
        </main>
      </div>

      <BottomNav roles={roles} />

      {/*
        Cady, in the same corner of every screen. In the shell rather than on
        the pages because somebody who is lost is not going to hunt for the
        help, and "bottom right" has to still be true on the screen they got
        lost on.
      */}
      <SupportLauncher />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} roles={roles} />
    </div>
  )
}
