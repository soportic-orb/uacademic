import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Simulated session for phase 0. Phase 1 replaces the email with an Entra ID
 * token, but the active center keeps living here: it is UI state, and the
 * server re-checks membership on every request anyway (R2/R3).
 */
export interface DemoIdentity {
  email: string
  labelKey: string
}

export const DEMO_IDENTITIES: DemoIdentity[] = [
  { email: 'ona.bertran@demo.uacademic.test', labelKey: 'roles.SUPERADMIN' },
  { email: 'ferran.aymerich@demo.uacademic.test', labelKey: 'roles.CENTER_ADMIN' },
  { email: 'marta.puig@demo.uacademic.test', labelKey: 'roles.COORDINATOR' },
  { email: 'sergi.vila@demo.uacademic.test', labelKey: 'roles.TEACHER' },
]

interface SessionState {
  mockUserEmail: string
  centerId: string | undefined
  /**
   * Which of this person's roles the interface is showing.
   *
   * A view, never a permission. Somebody who coordinates and teaches sees one
   * set of screens at a time instead of the union of both, and switches when
   * they want the other — but the server decides what they may actually do, on
   * every request, from the roles in the database (R3). Setting this to
   * `SUPERADMIN` in devtools changes what is drawn and nothing else.
   */
  activeRole: string | undefined
  setMockUserEmail: (email: string) => void
  setCenterId: (centerId: string | undefined) => void
  setActiveRole: (role: string | undefined) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      mockUserEmail: DEMO_IDENTITIES[2]!.email,
      centerId: undefined,
      activeRole: undefined,
      setMockUserEmail: (mockUserEmail) =>
        set({ mockUserEmail, centerId: undefined, activeRole: undefined }),
      // Changing center drops the chosen role: the roles held here are not the
      // roles held there, and carrying one over would show somebody a menu
      // their membership does not support.
      setCenterId: (centerId) => set({ centerId, activeRole: undefined }),
      setActiveRole: (activeRole) => set({ activeRole }),
    }),
    { name: 'uacademic.session' },
  ),
)
