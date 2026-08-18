import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { AppProviders } from './app/providers'
import { router } from './app/router'
import { applyPendingUpdate, registerServiceWorker } from './app/service-worker'
import { initI18n } from './i18n'
import { applyTheme, useThemeStore } from './stores/theme'
import './styles/index.css'

// Applied before the first paint so the app never flashes the wrong theme.
applyTheme(useThemeStore.getState().preference)

await initI18n()

// A version that arrived while somebody was working takes over here, at the
// start of a session, and nowhere else. If it does, the page reloads and there
// is nothing left to render.
if (await applyPendingUpdate()) {
  throw new Error('Reloading into the new version')
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)

registerServiceWorker()
