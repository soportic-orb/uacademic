/**
 * Everything the capacity screens read, in one place.
 *
 * The numbers are never computed here: the queries load rows, the shared domain
 * package turns them into capacity, workload and a traffic light (R7), and the
 * thresholds always come from `centers.settings_json` (R9). The table, the
 * personal panel and the Excel export therefore agree by construction.
 */
import {
  type AssignmentConcept,
  type AssignmentDetail,
  type AvailabilityEntry,
  type CenterLoadRow,
  type CenterSettings,
  type LoadThresholds,
  type Role,
  type TeacherProfileDto,
  type TeacherWorkloadDto,
  type Weekday,
  computeWorkload,
  hasRole,
  parseCenterSettings,
  weeklyAvailableHours,
} from '@uacademic/shared'
import type { Prisma } from '@uacademic/db'
import type { FastifyRequest } from 'fastify'

import { AppError } from '../../lib/errors.js'
import { type ScopedPrismaClient, prisma } from '../../lib/prisma.js'
import { type RequestUser, requireCenterScope, requireUser } from '../../plugins/context.js'

export interface TeacherContext {
  centerId: string
  db: ScopedPrismaClient
  user: RequestUser
  settings: CenterSettings
  thresholds: LoadThresholds
  academicYearId: string
}

/** The active academic year plus the center's own parameters. */
/**
 * The same, for the screens where having no academic year yet is an answer
 * rather than a fault.
 *
 * A center on its first day has no year, therefore no teaching, therefore no
 * load — and a summary of nothing is a legitimate thing to show. Returning 404
 * instead put "something went wrong" on the dashboard of every coordinator at
 * a center whose year had not been created, which is exactly the moment they
 * are most likely to be looking.
 */
export async function optionalTeacherContext(
  request: FastifyRequest,
): Promise<TeacherContext | null> {
  const user = requireUser(request)
  const { centerId, db } = requireCenterScope(request)

  const academicYear = await db.academicYear.findFirst({
    where: { status: 'active' },
    orderBy: { startDate: 'desc' },
  })
  if (!academicYear) return null

  const center = await prisma().center.findUnique({ where: { id: centerId } })
  const settings = parseCenterSettings(center?.settingsJson)

  return {
    centerId,
    db,
    user,
    settings,
    thresholds: settings.load.thresholds,
    academicYearId: academicYear.id,
  }
}

/**
 * For everything addressed at something inside a year — one teacher's card,
 * one reduction, one availability slot. With no year there is no such thing to
 * address, and 404 is the honest answer.
 */
export async function teacherContext(request: FastifyRequest): Promise<TeacherContext> {
  const context = await optionalTeacherContext(request)
  if (!context) throw AppError.notFound()
  return context
}

const MANAGER_ROLES: readonly Role[] = ['CENTER_ADMIN', 'COORDINATOR']

/**
 * Resolves `me` or a profile id, and decides who may look. A teacher sees their
 * own card; coordinators and center admins see everyone in their center.
 */
export async function resolveTeacherProfileId(
  context: TeacherContext,
  idOrMe: string,
): Promise<string> {
  if (idOrMe === 'me') {
    const own = await context.db.teacherProfile.findFirst({
      where: { userId: context.user.userId, academicYearId: context.academicYearId },
      select: { id: true },
    })
    if (!own) throw AppError.notFound()
    return own.id
  }

  const profile = await context.db.teacherProfile.findFirst({
    where: { id: idOrMe, academicYearId: context.academicYearId },
    select: { id: true, userId: true },
  })
  if (!profile) throw AppError.notFound()

  const isSelf = profile.userId === context.user.userId
  if (!isSelf && !hasRole(context.user, context.centerId, MANAGER_ROLES)) {
    throw AppError.forbidden()
  }

  return profile.id
}

/**
 * Who may repaint a week or record an absence: the teacher themselves, and the
 * people who plan the center's teaching. Coordination adjusts availability
 * because it is the side of the product that has to make the timetable fit —
 * reductions stay with the center admin, since those change the contract.
 */
export async function canEditAvailability(
  context: TeacherContext,
  teacherProfileId: string,
): Promise<boolean> {
  if (hasRole(context.user, context.centerId, ['CENTER_ADMIN', 'COORDINATOR'])) return true

  const profile = await context.db.teacherProfile.findFirst({
    where: { id: teacherProfileId },
    select: { userId: true },
  })
  return profile?.userId === context.user.userId
}

const PROFILE_INCLUDE = {
  user: {
    select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
  },
  reductions: {
    include: { approver: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  },
  skills: {
    include: { subject: { select: { id: true, code: true, nameCa: true } } },
    orderBy: { createdAt: 'asc' },
  },
  availability: true,
  assignments: {
    include: {
      group: {
        select: {
          id: true,
          code: true,
          subject: { select: { id: true, code: true, nameCa: true, degreeId: true } },
        },
      },
    },
  },
} as const

type ProfileRow = Prisma.TeacherProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>

function assignmentDetails(profile: ProfileRow): AssignmentDetail[] {
  return profile.assignments.map((assignment) => ({
    subjectId: assignment.group.subject.id,
    subjectCode: assignment.group.subject.code,
    subjectName: assignment.group.subject.nameCa,
    groupId: assignment.group.id,
    groupCode: assignment.group.code,
    concept: assignment.concept as AssignmentConcept,
    hours: Number(assignment.assignedHours),
  }))
}

function workloadInput(profile: ProfileRow) {
  return {
    contractedHours: Number(profile.contractedHours),
    reductions: profile.reductions.map((reduction) => ({
      hours: Number(reduction.hours),
      approved: reduction.status === 'approved',
    })),
    assignments: assignmentDetails(profile),
  }
}

function loadRow(profile: ProfileRow, thresholds: LoadThresholds): CenterLoadRow {
  const workload = computeWorkload(workloadInput(profile), thresholds)

  return {
    teacherProfileId: profile.id,
    userId: profile.user.id,
    firstName: profile.user.firstName,
    lastName: profile.user.lastName,
    avatarUrl: profile.user.avatarUrl,
    category: profile.category,
    dedication: profile.dedication,
    contractedHours: workload.contractedHours,
    reductionHours: workload.reductionHours,
    capacityHours: workload.capacityHours,
    assignedHours: workload.assignedHours,
    remainingHours: workload.remainingHours,
    ratioPercent: workload.ratioPercent,
    status: workload.status,
    degreeIds: [
      ...new Set(profile.assignments.map((assignment) => assignment.group.subject.degreeId)),
    ],
  }
}

/** Every teacher of the active year, as the center panel sees them. */
export async function loadRows(context: TeacherContext): Promise<CenterLoadRow[]> {
  const profiles = (await context.db.teacherProfile.findMany({
    where: { academicYearId: context.academicYearId },
    include: PROFILE_INCLUDE,
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  })) as ProfileRow[]

  return profiles.map((profile) => loadRow(profile, context.thresholds))
}

async function findProfile(context: TeacherContext, teacherProfileId: string): Promise<ProfileRow> {
  const profile = (await context.db.teacherProfile.findFirst({
    where: { id: teacherProfileId, academicYearId: context.academicYearId },
    include: PROFILE_INCLUDE,
  })) as ProfileRow | null

  if (!profile) throw AppError.notFound()
  return profile
}

export async function teacherWorkload(
  context: TeacherContext,
  teacherProfileId: string,
): Promise<TeacherWorkloadDto> {
  const profile = await findProfile(context, teacherProfileId)
  return workloadDto(context, profile)
}

function workloadDto(context: TeacherContext, profile: ProfileRow): TeacherWorkloadDto {
  const workload = computeWorkload(workloadInput(profile), context.thresholds)
  const row = loadRow(profile, context.thresholds)

  return {
    ...row,
    academicYearId: context.academicYearId,
    bySubject: workload.bySubject,
    conceptTotals: workload.conceptTotals,
  }
}

export async function teacherProfile(
  context: TeacherContext,
  teacherProfileId: string,
): Promise<TeacherProfileDto> {
  const profile = await findProfile(context, teacherProfileId)

  const entries: AvailabilityEntry[] = profile.availability.map((entry) => ({
    weekday: entry.weekday as Weekday,
    startTime: entry.startTime,
    endTime: entry.endTime,
    level: entry.level,
  }))

  return {
    ...workloadDto(context, profile),
    email: profile.user.email,
    avatarUrl: profile.user.avatarUrl,
    notes: profile.notes,
    reductions: profile.reductions.map((reduction) => ({
      id: reduction.id,
      reason: reduction.reason,
      hours: Number(reduction.hours),
      status: reduction.status,
      approvedBy: reduction.approvedBy,
      approverName: reduction.approver
        ? `${reduction.approver.firstName} ${reduction.approver.lastName}`
        : null,
      approvedAt: reduction.approvedAt?.toISOString() ?? null,
    })),
    skills: profile.skills.map((skill) => ({
      id: skill.id,
      subjectId: skill.subjectId,
      subjectCode: skill.subject?.code ?? null,
      subjectName: skill.subject?.nameCa ?? null,
      knowledgeArea: skill.knowledgeArea,
    })),
    weeklyAvailableHours: weeklyAvailableHours(entries),
  }
}
