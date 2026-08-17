import { createBrowserRouter } from 'react-router'

import { AppShell } from '../components/layout/app-shell'
import { DashboardPage } from '../pages/dashboard'
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
import { TeachersPage } from '../pages/teachers'

/**
 * Navigation visibility is role-driven (see `app/navigation.ts`), but routes
 * stay reachable by URL: the API is the authority and answers 403 when the
 * caller has no business there (R2/R3).
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'my-load', element: <MyLoadPage /> },
      { path: 'planning', element: <PlanningPage /> },
      { path: 'teachers', element: <TeachersPage /> },
      { path: 'subjects', element: <SubjectsPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'messages', element: <MessagesPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'platform', element: <PlatformPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
