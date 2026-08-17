import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'

import { CardSkeleton } from '../components/feedback/states'
import { useSession } from './session'

/**
 * Route guard. It is a convenience, not a security boundary: the API answers
 * 401/403 on its own, and the session it checks lives in an httpOnly cookie
 * this code cannot read or forge.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useSession()
  const location = useLocation()
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-bg p-8" role="status" aria-label={t('states.loadingLabel')}>
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
