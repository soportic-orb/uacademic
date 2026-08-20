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

/**
 * Who may give somebody a role in a center, and take it away.
 *
 * The superadmin anywhere — it is the only role that crosses centers — and a
 * center administrator in the centers they administer, and nowhere else. Being
 * a coordinator of a center does not make you able to staff it.
 */
export function canGrantInCenter(principal: Principal, centerId: string): boolean {
  return isSuperadmin(principal) || rolesInCenter(principal, centerId).includes('CENTER_ADMIN')
}

/**
 * Most privileged first.
 *
 * Somebody who both coordinates and teaches opens the product on the
 * coordinator's screens, because that is the work the other role cannot do —
 * and they can switch to the teacher's view whenever they want to see what
 * their own week looks like.
 */
export function sortRolesByRank(roles: readonly Role[]): Role[] {
  return [...roles].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b))
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
