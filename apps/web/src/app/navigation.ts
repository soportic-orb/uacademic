import type { Role } from '@uacademic/shared'
import {
  BellRing,
  BookMarked,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarSync,
  FileText,
  Repeat,
  ScrollText,
  LayoutDashboard,
  MessageCircleQuestion,
  MessageSquare,
  Settings,
  Sliders,
  Sparkles,
  Upload,
  User,
  Users,
  ShieldCheck,
} from 'lucide-react'
import type { ComponentType } from 'react'

export interface NavItem {
  /** i18n key under `nav.` */
  key: string
  path: string
  icon: ComponentType<{ className?: string }>
  /** Roles that see this entry. Empty means everyone signed in. */
  roles: Role[]
  /** Whether it belongs to the 5-item mobile bar. */
  mobile?: boolean
}

/**
 * One declaration drives the desktop sidebar and the mobile bottom bar, so a
 * role can never see an entry in one and not the other.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    path: '/',
    icon: LayoutDashboard,
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
    mobile: true,
  },
  {
    key: 'myLoad',
    path: '/my-load',
    icon: User,
    roles: ['TEACHER', 'COORDINATOR'],
    mobile: true,
  },
  {
    key: 'availability',
    path: '/teachers/me',
    icon: CalendarClock,
    roles: ['TEACHER', 'COORDINATOR'],
  },
  {
    key: 'planning',
    path: '/planning',
    icon: CalendarDays,
    roles: ['CENTER_ADMIN', 'COORDINATOR'],
    mobile: true,
  },
  {
    key: 'teachers',
    path: '/teachers',
    icon: Users,
    roles: ['CENTER_ADMIN', 'COORDINATOR'],
    mobile: true,
  },
  {
    key: 'calendar',
    path: '/calendar',
    icon: CalendarDays,
    roles: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'subjects',
    path: '/subjects',
    icon: BookOpen,
    roles: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
    mobile: true,
  },
  {
    key: 'assistant',
    path: '/assistant',
    icon: Sparkles,
    // R5/product: the assistant is a coordination tool.
    roles: ['COORDINATOR'],
  },
  {
    key: 'changes',
    path: '/changes',
    icon: Repeat,
    roles: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'absences',
    path: '/absences',
    icon: CalendarOff,
    roles: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'messages',
    path: '/messages',
    icon: MessageSquare,
    roles: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
    mobile: true,
  },
  {
    key: 'connections',
    path: '/connections',
    icon: CalendarSync,
    roles: ['CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'notifications',
    path: '/notifications',
    icon: BellRing,
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'audit',
    path: '/audit',
    icon: ScrollText,
    // R4: the log is for whoever answers for the center, not for everybody.
    roles: ['SUPERADMIN', 'CENTER_ADMIN'],
  },
  {
    key: 'documents',
    path: '/documents',
    icon: FileText,
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'admin',
    path: '/admin',
    icon: Sliders,
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR'],
  },
  {
    key: 'imports',
    path: '/imports',
    icon: Upload,
    roles: ['CENTER_ADMIN'],
  },
  {
    key: 'platform',
    path: '/platform',
    icon: Settings,
    roles: ['SUPERADMIN'],
  },
  {
    key: 'support',
    path: '/support',
    icon: MessageCircleQuestion,
    roles: ['SUPERADMIN'],
  },
  {
    key: 'guide',
    path: '/guide',
    icon: BookMarked,
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'settings',
    path: '/settings',
    icon: Settings,
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
  {
    key: 'privacy',
    path: '/privacy',
    icon: ShieldCheck,
    // Everybody's: it is their data the page is about.
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
  },
]

export function navItemsForRoles(roles: readonly Role[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.some((role) => roles.includes(role)))
}

/** The mobile bar holds exactly five entries, settings always last. */
export function mobileNavItems(roles: readonly Role[]): NavItem[] {
  const available = navItemsForRoles(roles)
  const primary = available.filter((item) => item.mobile).slice(0, 4)
  const settings = available.find((item) => item.key === 'settings')
  return settings ? [...primary, settings] : primary
}
