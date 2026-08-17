import {
  type AssignmentConcept,
  type CenterLoadSummaryDto,
  type TeacherLoadDto,
  computeTeacherLoad,
  parseCenterSettings,
  summarizeLoads,
} from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

interface LoadListResponse {
  academicYearId: string
  teachers: TeacherLoadDto[]
  summary: CenterLoadSummaryDto
}

/**
 * The product's core question — contracted versus assigned — answered with the
 * shared domain logic (R7) and the center's own thresholds (R9).
 */
export function registerTeacherRoutes(app: FastifyInstance): void {
  app.get(
    '/api/v1/teachers/load',
    { config: { roles: ['CENTER_ADMIN', 'COORDINATOR'] } },
    async (request): Promise<LoadListResponse> => {
      const { centerId, db } = requireCenterScope(request)
      return buildLoadResponse(db, centerId)
    },
  )

  app.get('/api/v1/teachers/me/load', async (request): Promise<TeacherLoadDto> => {
    const user = requireUser(request)
    const { centerId, db } = requireCenterScope(request)
    const response = await buildLoadResponse(db, centerId, user.userId)

    const own = response.teachers[0]
    if (!own) throw AppError.notFound()
    return own
  })
}

async function buildLoadResponse(
  db: ReturnType<typeof requireCenterScope>['db'],
  centerId: string,
  onlyUserId?: string,
): Promise<LoadListResponse> {
  const academicYear = await db.academicYear.findFirst({
    where: { status: 'active' },
    orderBy: { startDate: 'desc' },
  })
  if (!academicYear) throw AppError.notFound()

  const center = await prisma().center.findUnique({ where: { id: centerId } })
  const thresholds = parseCenterSettings(center?.settingsJson).load.thresholds

  const profiles = await db.teacherProfile.findMany({
    where: {
      academicYearId: academicYear.id,
      ...(onlyUserId ? { userId: onlyUserId } : {}),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      reductions: { select: { hours: true, status: true } },
      assignments: { select: { assignedHours: true, concept: true } },
    },
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  })

  const teachers: TeacherLoadDto[] = profiles.map((profile) => {
    const load = computeTeacherLoad(
      {
        contractedHours: Number(profile.contractedHours),
        reductions: profile.reductions.map((reduction) => ({
          hours: Number(reduction.hours),
          approved: reduction.status === 'approved',
        })),
        assignments: profile.assignments.map((assignment) => ({
          concept: assignment.concept as AssignmentConcept,
          hours: Number(assignment.assignedHours),
        })),
      },
      thresholds,
    )

    return {
      teacherProfileId: profile.id,
      userId: profile.user.id,
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      category: profile.category,
      dedication: profile.dedication,
      contractedHours: load.contractedHours,
      reductionHours: load.reductionHours,
      capacityHours: load.capacityHours,
      assignedHours: load.assignedHours,
      remainingHours: load.remainingHours,
      ratioPercent: load.ratioPercent,
      status: load.status,
    }
  })

  const summary = summarizeLoads(
    teachers.map((teacher) => ({
      contractedHours: teacher.contractedHours,
      reductionHours: teacher.reductionHours,
      capacityHours: teacher.capacityHours,
      assignedHours: teacher.assignedHours,
      remainingHours: teacher.remainingHours,
      ratioPercent: teacher.ratioPercent,
      status: teacher.status,
      byConcept: { lecture: 0, tutoring: 0, coordination: 0, tfg: 0, other: 0 },
    })),
  )

  return { academicYearId: academicYear.id, teachers, summary }
}
