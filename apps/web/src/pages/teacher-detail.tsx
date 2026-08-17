import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'

import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { AvailabilityEditor } from '../features/capacity/availability-editor'
import { ExceptionsPanel } from '../features/capacity/exceptions-panel'
import { ProfileCard } from '../features/capacity/profile-card'
import { useAvailability, useTeacherProfile } from '../features/capacity/queries'
import { useRoles } from '../app/use-roles'

/**
 * Screens (a), (b) and (c) of the capacity model for one person: the profile
 * card, the weekly availability editor and the dated exceptions.
 *
 * `me` is a valid id, so a teacher reaches their own card by URL without the
 * app having to know their profile id.
 */
export function TeacherDetailPage() {
  const { t } = useTranslation()
  const params = useParams<{ id: string }>()
  const teacherId = params.id ?? 'me'
  const roles = useRoles()

  const profile = useTeacherProfile(teacherId)
  const availability = useAvailability(teacherId)

  const canManage = roles.includes('CENTER_ADMIN') || roles.includes('SUPERADMIN')
  const isManager = canManage || roles.includes('COORDINATOR')

  return (
    <div className="space-y-6">
      {isManager ? (
        <Link
          to="/teachers"
          className="inline-flex items-center gap-2 text-sm text-primary underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('teachers.profile.back')}
        </Link>
      ) : null}

      {profile.isPending ? (
        <CardSkeleton />
      ) : profile.isError ? (
        <ErrorState
          onRetry={() => void profile.refetch()}
          description={t('teachers.profile.notFound')}
        />
      ) : (
        <ProfileCard
          teacherId={teacherId}
          profile={profile.data}
          canManage={canManage}
          canManageSkills={isManager}
        />
      )}

      {availability.isPending ? (
        <CardSkeleton />
      ) : availability.isError ? (
        <ErrorState onRetry={() => void availability.refetch()} />
      ) : (
        <>
          <AvailabilityEditor teacherId={teacherId} data={availability.data} />
          <ExceptionsPanel teacherId={teacherId} data={availability.data} />
        </>
      )}
    </div>
  )
}
