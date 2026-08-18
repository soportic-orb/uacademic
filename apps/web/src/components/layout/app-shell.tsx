import type { Role } from '@uacademic/shared'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'

import { useSession } from '../../auth/session'
import { useRealtime } from '../../features/realtime/use-realtime'
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
  const roles: Role[] = (user?.memberships ?? [])
    .filter((membership) => !centerId || membership.centerId === centerId)
    .map((membership) => membership.role)

  return (
    <div className="flex min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-text"
      >
        {t('layout.skipToContent')}
      </a>

      <Sidebar roles={roles} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          onOpenSearch={() => setSearchOpen(true)}
          onToggleSidebar={() => setCollapsed((v) => !v)}
        />

        <main id="main" className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-8">
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
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} roles={roles} />
    </div>
  )
}
