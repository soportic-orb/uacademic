import { type SubjectDto, sumHours } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { requireCenterScope } from '../../plugins/context.js'

export function registerSubjectRoutes(app: FastifyInstance): void {
  app.get('/api/v1/subjects', async (request): Promise<{ items: SubjectDto[] }> => {
    const { db } = requireCenterScope(request)

    const academicYear = await db.academicYear.findFirst({
      where: { status: 'active' },
      orderBy: { startDate: 'desc' },
    })
    // A center whose academic calendar has not been set up yet has no
    // subjects. That is an empty list — the state every installation starts
    // in — and answering 404 put "we could not find the resource" on the
    // screen of everybody who opened the product on its first day.
    if (!academicYear) return { items: [] }

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
