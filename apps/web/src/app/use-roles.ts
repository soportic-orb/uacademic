import type { Role } from '@uacademic/shared'
import { useOutletContext } from 'react-router'

export interface ShellContext {
  roles: Role[]
}

/**
 * Roles for the active center, as resolved by the server (R3). Pages use this
 * to decide what to render; the API re-checks on every request regardless.
 */
export function useRoles(): Role[] {
  const context = useOutletContext<ShellContext | null>()
  return context?.roles ?? []
}
