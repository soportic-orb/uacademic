import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'

import { CardSkeleton, EmptyState, ErrorState } from '../components/feedback/states'
import { AvailabilityEditor } from '../features/capacity/availability-editor'
import { ExceptionsPanel } from '../features/capacity/exceptions-panel'
import { AssignmentsPanel } from '../features/capacity/assignments-panel'
import { ProfileCard } from '../features/capacity/profile-card'
import { ScheduleExport } from '../features/capacity/schedule-export'
import { useAvailability, useTeacherProfile } from '../features/capacity/queries'
import { useRoles } from '../app/use-roles'
import { ApiRequestError } from '../lib/api'

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
      ) : profile.error instanceof ApiRequestError && profile.error.status === 404 ? (
        // Their own card, before the center has written their contract: the
        // role is granted and the hours are not, which is an ordinary state
        // and not a fault.
        <EmptyState
          title={t(teacherId === 'me' ? 'load.noContract.title' : 'teachers.profile.notFound')}
          description={teacherId === 'me' ? t('load.noContract.hint') : undefined}
        />
      ) : profile.isError ? (
        <ErrorState
          onRetry={() => void profile.refetch()}
          description={t('teachers.profile.notFound')}
        />
      ) : (
        <>
          <ProfileCard
            teacherId={teacherId}
            profile={profile.data}
            canManage={canManage}
            canManageSkills={isManager}
          />
          <AssignmentsPanel teacherId={teacherId} profile={profile.data} canManage={isManager} />
          <ScheduleExport teacherId={teacherId} />
        </>
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
