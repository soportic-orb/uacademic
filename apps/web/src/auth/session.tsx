import type { SessionUser } from '@uacademic/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect } from 'react'

import { ApiRequestError, apiFetch } from '../lib/api'
import { useSessionStore } from '../stores/session'
import { acquireTokenSilently, signInWithMicrosoft, signOutFromMicrosoft } from './msal'

interface SessionContextValue {
  user: SessionUser | undefined
  isLoading: boolean
  isAuthenticated: boolean
  signInWithEntra: () => Promise<void>
  signInLocally: (credentials: { email: string; password: string; totp?: string }) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

/**
 * The session lives in an httpOnly cookie, so the client cannot read it: it
 * asks the server who it is. That is the point — a token in JavaScript is a
 * token an XSS can steal.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const setCenterId = useSessionStore((state) => state.setCenterId)
  const centerId = useSessionStore((state) => state.centerId)

  // In mock mode the identity comes from a header, so switching demo user has
  // to refetch the session; in every other build this key is constant.
  const mockUserEmail = useSessionStore((state) => state.mockUserEmail)
  const identityKey =
    import.meta.env.VITE_UACADEMIC_AUTH_MODE === 'mock' ? mockUserEmail : 'session'

  const query = useQuery({
    queryKey: ['session', identityKey],
    queryFn: async () => {
      try {
        return await apiFetch<SessionUser>('/api/v1/auth/session')
      } catch (error) {
        // Not signed in is a normal state, not an error to shout about.
        if (error instanceof ApiRequestError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
    staleTime: 60_000,
  })

  const user = query.data ?? undefined

  // A user with a single center should never have to choose one.
  const firstCenterId = user?.memberships[0]?.centerId
  useEffect(() => {
    if (!centerId && firstCenterId) setCenterId(firstCenterId)
  }, [centerId, firstCenterId, setCenterId])

  const openSession = useMutation({
    mutationFn: async (accessToken: string) =>
      apiFetch<SessionUser>('/api/v1/auth/entra/session', {
        method: 'POST',
        body: JSON.stringify({ accessToken }),
        headers: { 'content-type': 'application/json' },
      }),
    onSuccess: (session) => queryClient.setQueryData(['session', identityKey], session),
  })

  const localSession = useMutation({
    mutationFn: async (credentials: { email: string; password: string; totp?: string }) =>
      apiFetch<SessionUser>('/api/v1/auth/local/session', {
        method: 'POST',
        body: JSON.stringify(credentials),
        headers: { 'content-type': 'application/json' },
      }),
    onSuccess: (session) => queryClient.setQueryData(['session', identityKey], session),
  })

  const signInWithEntra = useCallback(async () => {
    const token = await signInWithMicrosoft()
    await openSession.mutateAsync(token)
  }, [openSession])

  const signInLocally = useCallback(
    async (credentials: { email: string; password: string; totp?: string }) => {
      await localSession.mutateAsync(credentials)
    },
    [localSession],
  )

  const signOut = useCallback(async () => {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined)
    await signOutFromMicrosoft().catch(() => undefined)
    setCenterId(undefined)
    queryClient.clear()
    queryClient.setQueryData(['session', identityKey], null)
  }, [queryClient, setCenterId, identityKey])

  /**
   * Silent renewal: when our cookie is close to expiring, ask MSAL for a fresh
   * token and open a new session without interrupting anyone.
   */
  useEffect(() => {
    if (!user || user.authMethod !== 'entra') return

    const expiresIn = new Date(user.expiresAt).getTime() - Date.now()
    const renewIn = Math.max(expiresIn - 5 * 60_000, 30_000)

    const timer = setTimeout(() => {
      void acquireTokenSilently().then((token) => {
        if (token) void openSession.mutateAsync(token)
      })
    }, renewIn)

    return () => clearTimeout(timer)
  }, [user, openSession])

  return (
    <SessionContext.Provider
      value={{
        user,
        isLoading: query.isPending,
        isAuthenticated: Boolean(user),
        signInWithEntra,
        signInLocally,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

// The hook lives beside its provider because they share the context object;
// splitting them would only move the same coupling to another file.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}
