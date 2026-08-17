import { createBrowserRouter } from 'react-router'

import { AppShell } from '../components/layout/app-shell'
import { RequireSession } from '../auth/require-session'
import { AdminIndexPage } from '../pages/admin-index'
import { AdminResourcePage } from '../pages/admin-resource'
import { DashboardPage } from '../pages/dashboard'
import { LoginPage } from '../pages/login'
import { ProfilePage } from '../pages/profile'
import { UsersPage } from '../features/admin/users-page'
import { ImportWizard } from '../features/imports/import-wizard'
import { MyLoadPage } from '../pages/my-load'
import {
  AssistantPage,
  DocumentsPage,
  MessagesPage,
  NotFoundPage,
  PlanningPage,
  PlatformPage,
} from '../pages/placeholders'
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
      { path: 'teachers', element: <TeachersPage /> },
      { path: 'teachers/:id', element: <TeacherDetailPage /> },
      { path: 'subjects', element: <SubjectsPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'messages', element: <MessagesPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'platform', element: <PlatformPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'admin', element: <AdminIndexPage /> },
      { path: 'admin/users', element: <UsersPage /> },
      { path: 'admin/:resourceKey', element: <AdminResourcePage /> },
      { path: 'imports', element: <ImportWizard /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
