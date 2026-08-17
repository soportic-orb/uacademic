import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'

import { SessionProvider } from '../auth/session'
import { Toaster } from '../components/feedback/toaster'
import { ApiRequestError } from '../lib/api'
import { useToastStore } from '../stores/toast'
import { applyTheme, useThemeStore } from '../stores/theme'

/**
 * A failed query surfaces as a toast — the only notification mechanism in the
 * app (CLAUDE.md §4). The message comes already localized from the API.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiRequestError && error.status < 500) return false
          return failureCount < 2
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function ThemeSync({ children }: { children: ReactNode }) {
  const preference = useThemeStore((state) => state.preference)

  useEffect(() => {
    applyTheme(preference)

    if (preference !== 'system' || typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  return <>{children}</>
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)
  const push = useToastStore((state) => state.push)

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.status === 'error') {
        const error = event.query.state.error
        if (error instanceof ApiRequestError) {
          push({ variant: 'error', message: error.localizedMessage })
        } else {
          push({ variant: 'error', messageKey: 'errors.generic' })
        }
      }
    })
    return unsubscribe
  }, [queryClient, push])

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeSync>
          {children}
          <Toaster />
        </ThemeSync>
      </SessionProvider>
    </QueryClientProvider>
  )
}
