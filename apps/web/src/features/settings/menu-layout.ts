/**
 * Reading and writing somebody's own menu order.
 *
 * Kept on the account rather than in the browser: arranging a menu is work,
 * and having to redo it on the office machine because it was first done at
 * home is losing that work rather than expressing a per-device preference.
 */
import type { MenuEntry } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, apiJson } from '../../lib/api'
import { useSessionStore } from '../../stores/session'

export interface MenuLayout {
  entries: MenuEntry[]
}

export function useMenuLayout() {
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)

  return useQuery({
    queryKey: ['menu-layout', mockUserEmail],
    queryFn: () => apiFetch<MenuLayout>('/api/v1/me/menu'),
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
