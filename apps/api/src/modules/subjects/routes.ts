import { type SubjectDto, sumHours } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { AppError } from '../../lib/errors.js'
import { requireCenterScope } from '../../plugins/context.js'

export function registerSubjectRoutes(app: FastifyInstance): void {
  app.get('/api/v1/subjects', async (request): Promise<{ items: SubjectDto[] }> => {
    const { db } = requireCenterScope(request)

    const academicYear = await db.academicYear.findFirst({
      where: { status: 'active' },
      orderBy: { startDate: 'desc' },
    })
    if (!academicYear) throw AppError.notFound()

    const subjects = await db.subject.findMany({
      where: { academicYearId: academicYear.id },
      include: {
        degree: { select: { code: true } },
        groups: {
          select: {
            plannedHours: true,
            assignments: { select: { assignedHours: true } },
          },
        },
      },
      orderBy: [{ year: 'asc' }, { code: 'asc' }],
    })

    return {
      items: subjects.map((subject) => ({
        id: subject.id,
        code: subject.code,
        nameCa: subject.nameCa,
        nameEs: subject.nameEs,
        nameEn: subject.nameEn,
        ects: Number(subject.ects),
        year: subject.year,
        term: subject.term,
        type: subject.type,
        teachingLanguage: subject.teachingLanguage,
        degreeCode: subject.degree.code,
        groupCount: subject.groups.length,
        plannedHours: sumHours(subject.groups.map((group) => Number(group.plannedHours))),
        assignedHours: sumHours(
          subject.groups.flatMap((group) =>
            group.assignments.map((assignment) => Number(assignment.assignedHours)),
          ),
        ),
      })),
    }
  })
}
