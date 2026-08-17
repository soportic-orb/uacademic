/**
 * Role resolution. Roles always come from our database (R3) — never from a
 * token — so everything here operates on memberships the API has already
 * loaded from `user_center_roles`.
 */
import type { Role } from '../schemas/common.js'

export const ROLES: readonly Role[] = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER']

export interface Membership {
  centerId: string
  role: Role
}

export interface Principal {
  userId: string
  memberships: readonly Membership[]
}

export function isSuperadmin(principal: Principal): boolean {
  return principal.memberships.some((membership) => membership.role === 'SUPERADMIN')
}

export function rolesInCenter(principal: Principal, centerId: string): Role[] {
  return principal.memberships
    .filter((membership) => membership.centerId === centerId)
    .map((membership) => membership.role)
}

/** SUPERADMIN passes everywhere: it is the only role that crosses centers. */
export function hasRole(principal: Principal, centerId: string, allowed: readonly Role[]): boolean {
  if (isSuperadmin(principal)) return true
  return rolesInCenter(principal, centerId).some((role) => allowed.includes(role))
}

export function canAccessCenter(principal: Principal, centerId: string): boolean {
  return isSuperadmin(principal) || rolesInCenter(principal, centerId).length > 0
}

/** Only coordinators use the assistant — the one role that can act on it. */
export function canUseAiAssistant(principal: Principal, centerId: string): boolean {
  return rolesInCenter(principal, centerId).includes('COORDINATOR')
}

export function canManageCenter(principal: Principal, centerId: string): boolean {
  return hasRole(principal, centerId, ['CENTER_ADMIN'])
}

export function canPlanSchedule(principal: Principal, centerId: string): boolean {
  return hasRole(principal, centerId, ['CENTER_ADMIN', 'COORDINATOR'])
}

/** Centers the principal can act in, deduplicated and stable in order. */
export function accessibleCenterIds(principal: Principal): string[] {
  return [...new Set(principal.memberships.map((membership) => membership.centerId))]
}
