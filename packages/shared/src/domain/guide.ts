/**
 * The step-by-step guide each role gets on arriving.
 *
 * The order is not decoration: it is the order the product actually requires,
 * and most of what looks like a broken screen to somebody new is a step from
 * further up that has not happened yet. A center with no academic year has no
 * teaching load to summarise; a coordinator with no groups has nothing to
 * place; a lecturer with no availability recorded is planned around blindly.
 *
 * Lives here rather than in the web app because it is a statement about how
 * the product works, and phase 2's mobile app will need the same one.
 */
import type { Role } from '../schemas/common.js'

export interface GuideStep {
  /** i18n key under `guide.steps.`, carrying `.title` and `.body`. */
  key: string
  /** Where the step is done, when it is done inside the product. */
  to?: string
  /** Roles that can carry the step out themselves. */
  roles: readonly Role[]
}

const ALL: readonly Role[] = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER']

/**
 * Every step, once. A role's guide is the subset that applies to it, in this
 * order — so two roles reading about the same step read the same words.
 */
export const GUIDE_STEPS: readonly GuideStep[] = [
  // Everybody: the account itself.
  { key: 'profile', to: '/profile', roles: ALL },
  { key: 'language', to: '/settings', roles: ALL },
  { key: 'notifications', to: '/notifications', roles: ALL },

  // The platform administrator, setting the installation up.
  { key: 'universities', to: '/admin/universities', roles: ['SUPERADMIN'] },
  { key: 'centers', to: '/admin/centers', roles: ['SUPERADMIN'] },
  { key: 'tenants', to: '/admin/entra-tenants', roles: ['SUPERADMIN'] },
  { key: 'mail', to: '/platform', roles: ['SUPERADMIN'] },
  { key: 'updates', to: '/platform', roles: ['SUPERADMIN'] },

  // The center administration, opening a year.
  { key: 'academicYear', to: '/admin/academic-years', roles: ['SUPERADMIN', 'CENTER_ADMIN'] },
  { key: 'people', to: '/admin/users', roles: ['SUPERADMIN', 'CENTER_ADMIN'] },
  { key: 'degrees', to: '/admin/degrees', roles: ['CENTER_ADMIN'] },
  { key: 'subjects', to: '/admin/subjects', roles: ['CENTER_ADMIN'] },
  { key: 'groups', to: '/admin/groups', roles: ['CENTER_ADMIN', 'COORDINATOR'] },
  { key: 'spaces', to: '/admin/spaces', roles: ['CENTER_ADMIN'] },
  { key: 'calendar', to: '/admin/calendar-entries', roles: ['CENTER_ADMIN'] },
  { key: 'imports', to: '/imports', roles: ['CENTER_ADMIN'] },
  { key: 'parameters', to: '/settings', roles: ['CENTER_ADMIN'] },
  { key: 'staff', to: '/teachers', roles: ['CENTER_ADMIN', 'COORDINATOR'] },

  // The coordinator, turning that into a timetable.
  { key: 'coordination', to: '/admin/subjects', roles: ['CENTER_ADMIN'] },
  { key: 'assignments', to: '/teachers', roles: ['COORDINATOR'] },
  { key: 'version', to: '/planning', roles: ['COORDINATOR'] },
  { key: 'place', to: '/planning', roles: ['COORDINATOR'] },
  { key: 'generate', to: '/planning', roles: ['COORDINATOR'] },
  { key: 'publish', to: '/planning', roles: ['COORDINATOR'] },
  { key: 'assistant', to: '/assistant', roles: ['COORDINATOR'] },
  { key: 'changes', to: '/changes', roles: ['COORDINATOR', 'CENTER_ADMIN'] },

  // The lecturer, and what the platform asks of them.
  { key: 'availability', to: '/availability', roles: ['TEACHER', 'COORDINATOR'] },
  { key: 'ownLoad', to: '/my-load', roles: ['TEACHER', 'COORDINATOR'] },
  { key: 'calendarFeed', to: '/connections', roles: ALL },
  { key: 'askChange', to: '/changes', roles: ['TEACHER', 'COORDINATOR'] },
  { key: 'absences', to: '/absences', roles: ['TEACHER', 'COORDINATOR'] },
  { key: 'messages', to: '/messages', roles: ALL },
]

export function guideFor(role: Role): GuideStep[] {
  return GUIDE_STEPS.filter((step) => step.roles.includes(role))
}
