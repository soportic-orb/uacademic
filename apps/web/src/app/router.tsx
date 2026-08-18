import { createBrowserRouter } from 'react-router'

import { AppShell } from '../components/layout/app-shell'
import { RequireSession } from '../auth/require-session'
import { AbsencesPage } from '../pages/absences'
import { AssistantPage } from '../pages/assistant'
import { AdminIndexPage } from '../pages/admin-index'
import { AuditPage } from '../pages/audit'
import { CalendarPage } from '../pages/calendar'
import { ChangesPage } from '../pages/changes'
import { ConnectionsPage } from '../pages/connections'
import { AdminResourcePage } from '../pages/admin-resource'
import { DashboardPage } from '../pages/dashboard'
import { DocumentsPage } from '../pages/documents'
import { LoginPage } from '../pages/login'
import { PrivacyPage } from '../pages/privacy'
import { ProfilePage } from '../pages/profile'
import { UsersPage } from '../features/admin/users-page'
import { ImportWizard } from '../features/imports/import-wizard'
import { InstallPage } from '../pages/install'
import { MyLoadPage } from '../pages/my-load'
import { MessagesPage } from '../pages/messages'
import { NotificationsPage } from '../pages/notifications'
import { NotFoundPage } from '../pages/placeholders'
import { PlatformPage } from '../pages/platform'
import { PlanningPage } from '../pages/planning'
import { SettingsPage } from '../pages/settings'
import { SubjectsPage } from '../pages/subjects'
import { TeacherDetailPage } from '../pages/teacher-detail'
import { TeachersPage } from '../pages/teachers'

/**
 * Navigation visibility is role-driven (see `app/navigation.ts`), but routes
 * stay reachable by URL: the API is the authority and answers 403 when the
 * caller has no business there (R2/R3).
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Outside the shell and outside the session: at this point there is no
  // database to have an identity in.
  { path: '/install', element: <InstallPage /> },
  {
    path: '/',
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'my-load', element: <MyLoadPage /> },
      { path: 'planning', element: <PlanningPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'teachers', element: <TeachersPage /> },
      { path: 'teachers/:id', element: <TeacherDetailPage /> },
      { path: 'subjects', element: <SubjectsPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'changes', element: <ChangesPage /> },
      { path: 'changes/:id', element: <ChangesPage /> },
      { path: 'absences', element: <AbsencesPage /> },
      { path: 'absences/:id', element: <AbsencesPage /> },
      { path: 'messages', element: <MessagesPage /> },
      { path: 'messages/:id', element: <MessagesPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'connections', element: <ConnectionsPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'platform', element: <PlatformPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'admin', element: <AdminIndexPage /> },
      { path: 'admin/users', element: <UsersPage /> },
      { path: 'admin/:resourceKey', element: <AdminResourcePage /> },
      { path: 'imports', element: <ImportWizard /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
