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
  setMockUserEmail: (email: string) => void
  setCenterId: (centerId: string | undefined) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      mockUserEmail: DEMO_IDENTITIES[2]!.email,
      centerId: undefined,
      setMockUserEmail: (mockUserEmail) => set({ mockUserEmail, centerId: undefined }),
      setCenterId: (centerId) => set({ centerId }),
    }),
    { name: 'uacademic.session' },
  ),
)
