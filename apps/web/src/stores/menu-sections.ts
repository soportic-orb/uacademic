/**
 * Which sections of the menu are folded away.
 *
 * A view preference, not work: it says what this person wants to look at on
 * this machine right now, so it lives in the browser rather than on the
 * account. The order of the menu and the separators themselves are the other
 * thing entirely — somebody sat down and arranged those, and they follow the
 * account to any machine.
 *
 * Keyed by separator id. An id that no longer exists is simply never asked
 * about, so nothing has to be cleaned up when a separator is removed.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface MenuSectionsState {
  collapsed: Record<string, boolean>
  toggle: (id: string) => void
}

const STORAGE_KEY = 'uacademic.menu-sections'

export const useMenuSectionsStore = create<MenuSectionsState>()(
  persist(
    (set) => ({
      collapsed: {},
      toggle: (id) =>
        set((state) => ({ collapsed: { ...state.collapsed, [id]: !state.collapsed[id] } })),
    }),
    { name: STORAGE_KEY },
  ),
)
