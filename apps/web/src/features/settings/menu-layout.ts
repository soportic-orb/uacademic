/**
 * Reading and writing somebody's own menu order.
 *
 * Kept on the account rather than in the browser: arranging a menu is work,
 * and having to redo it on the office machine because it was first done at
 * home is losing that work rather than expressing a per-device preference.
 */
import type { DefaultedRole, MenuEntry, Role } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

export interface MenuLayout {
  /** What to draw: this person's own arrangement, or their role's default. */
  entries: MenuEntry[]
  /** Whether the first of those is what happened. */
  personalised: boolean
}

export function useMenuLayout() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const centerId = useSessionStore((state) => state.centerId)
  // The role the interface is drawn for decides which default applies when
  // this person has not arranged their own.
  const activeRole = useSessionStore((state) => state.activeRole)

  return useQuery({
    queryKey: ['menu-layout', mockUserEmail, centerId, activeRole],
    queryFn: () =>
      apiFetch<MenuLayout>(
        `/api/v1/me/menu${activeRole ? `?role=${encodeURIComponent(activeRole)}` : ''}`,
      ),
    // The sidebar is drawn on every screen; re-reading it constantly buys
    // nothing, and the mutation invalidates it the moment it changes.
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useSaveMenuLayout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (entries: MenuEntry[]) =>
      apiJson<MenuLayout>('/api/v1/me/menu', 'PUT', { entries }),
    onSuccess: (layout) => {
      // Straight into the cache: the sidebar is on screen while this is being
      // edited, and it should move as the buttons are pressed.
      queryClient.setQueriesData<MenuLayout>({ queryKey: ['menu-layout'] }, layout)
    },
  })
}

/** A separator id that does not collide with the ones already there. */
export function newSeparatorId(entries: readonly MenuEntry[]): string {
  const taken = new Set(entries.filter((entry) => entry.kind === 'separator').map((e) => e.id))
  for (let index = 1; ; index += 1) {
    const candidate = `sep-${index}`
    if (!taken.has(candidate)) return candidate
  }
}

/* ────────────── the starting point the platform gives each role ─────────── */

export interface MenuDefaults {
  defaults: Partial<Record<DefaultedRole, MenuEntry[]>>
}

export function useMenuDefaults(enabled: boolean) {
  return useQuery({
    queryKey: ['menu-defaults'],
    queryFn: () => apiFetch<MenuDefaults>('/api/v1/platform/menu-defaults'),
    enabled,
    retry: false,
  })
}

export function useSaveMenuDefaults() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (defaults: MenuDefaults['defaults']) =>
      apiJson<MenuDefaults>('/api/v1/platform/menu-defaults', 'PUT', { defaults }),
    onSuccess: async (result) => {
      queryClient.setQueryData<MenuDefaults>(['menu-defaults'], result)
      // Anybody who has not arranged their own menu is now looking at a
      // different one, this administrator included.
      await queryClient.invalidateQueries({ queryKey: ['menu-layout'] })
    },
  })
}

/** Roles a default can be set for, in the order they are shown. */
export const DEFAULT_ROLE_ORDER: readonly Role[] = ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER']
