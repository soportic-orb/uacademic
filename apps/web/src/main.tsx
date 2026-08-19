import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { AppProviders } from './app/providers'
import { router } from './app/router'
import { applyPendingUpdate, registerServiceWorker } from './app/service-worker'
import { isSignInPopup } from './auth/popup'
import { AppErrorBoundary } from './components/feedback/error-boundary'
import { initI18n } from './i18n'
import { applyTheme, useThemeStore } from './stores/theme'
import './styles/index.css'

async function start(): Promise<void> {
  // Applied before the first paint so the app never flashes the wrong theme.
  applyTheme(useThemeStore.getState().preference)

  await initI18n()

  // A version that arrived while somebody was working takes over here, at the
  // start of a session, and nowhere else. If it does, the page reloads and there
  // is nothing left to render.
  if (await applyPendingUpdate()) return

  const container = document.getElementById('root')
  if (!container) throw new Error('Root container not found')

  createRoot(container).render(
    <StrictMode>
      <AppErrorBoundary>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </AppErrorBoundary>
    </StrictMode>,
  )

  registerServiceWorker()
}

if (!isSignInPopup(window)) await start()
