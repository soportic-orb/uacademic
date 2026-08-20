import {
  type AvailabilityEntryDto,
  type AvailabilityExceptionDto,
  type AvailabilityResponseDto,
  type CenterLoadSummaryDto,
  type TeacherLoadDto,
  type TeacherProfileDto,
  type TeacherWorkloadDto,
  type Weekday,
  availabilityExceptionInputSchema,
  availabilityHoursByLevel,
  defaultCenterSettings,
  filterLoadRows,
  loadQuerySchema,
  reductionInputSchema,
  saveAvailabilitySchema,
  sortLoadRows,
  teacherAssignmentSchema,
  teacherProfileInputSchema,
  teacherProfileUpdateSchema,
  summarizeLoads,
  teacherSkillsInputSchema,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireUser } from '../../plugins/context.js'
import {
  type TeacherContext,
  canEditAvailability,
  loadRows,
  resolveTeacherProfileId,
  optionalTeacherContext,
  teacherContext,
  teacherProfile,
  teacherWorkload,
} from './service.js'
import { loadWorkbook } from './export.js'

/** A group of a subject in the year in force, and what this teacher holds on it. */
interface AssignableGroupDto {
  id: string
  code: string
  type: string
  plannedHours: number
  subjectCode: string
  subjectName: string
  heldConcepts: string[]
}

/** Somebody the center could contract for this year, and has not. */
interface TeacherCandidateDto {
  userId: string
  email: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  status: string
}

/** Who may staff a year: the same people who may look at the whole center. */
const MANAGER_ROLES = ['CENTER_ADMIN', 'COORDINATOR'] as const

interface LoadListResponse {
  /** Null when the center has no active year, and so nothing to summarise. */
  academicYearId: string | null
  teachers: TeacherLoadDto[]
  summary: CenterLoadSummaryDto
  /** Distinct values the filters can offer, computed over the unfiltered set. */
  facets: { categories: string[]; degrees: { id: string; code: string; name: string }[] }
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
      const context = await optionalTeacherContext(request)
      // No year yet: nothing is taught, so nothing is over- or under-loaded.
      // The screen says that far better than an error does.
      if (!context) {
        return {
          academicYearId: null,
          teachers: [],
          summary: summarizeLoads([]),
          facets: { categories: [], degrees: [] },
        }
      }

      const query = parseWith(loadQuerySchema, request.query)
      const rows = await loadRows(context)

      const filtered = sortLoadRows(
        filterLoadRows(rows, {
          degreeId: query.degreeId,
          category: query.category,
          status: query.status,
          search: query.q,
        }),
        query.sort,
        query.order,
      )

      return {
        academicYearId: context.academicYearId,
        teachers: filtered,
        summary: summarizeLoads(
          filtered.map((row) => ({
            ...row,
            byConcept: { lecture: 0, tutoring: 0, coordination: 0, tfg: 0, other: 0 },
          })),
        ),
        facets: {
          categories: [...new Set(rows.map((row) => row.category))].sort(),
          degrees: await degreeFacet(context),
        },
      }
    },
  )

  /**
   * The same table as a spreadsheet. It takes the same filters, so what is
   * downloaded is what was on screen — not the whole center.
   */
  app.get(
    '/api/v1/teachers/load/export',
    { config: { roles: ['CENTER_ADMIN', 'COORDINATOR'] } },
    async (request, reply): Promise<FastifyReply> => {
      const context = await optionalTeacherContext(request)
      // An empty workbook rather than an error: what is downloaded is what was
      // on screen, and what is on screen is an empty table.
      if (!context) {
        const empty = await loadWorkbook([], {
          locale: request.locale,
          thresholds: defaultCenterSettings.load.thresholds,
        })
        return reply
          .header(
            'content-type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          )
          .header('content-disposition', `attachment; filename="uacademic-load.xlsx"`)
          .send(empty)
      }

      const query = parseWith(loadQuerySchema, request.query)
      const rows = sortLoadRows(
        filterLoadRows(await loadRows(context), {
          degreeId: query.degreeId,
          category: query.category,
          status: query.status,
          search: query.q,
        }),
        query.sort,
        query.order,
      )

      const buffer = await loadWorkbook(rows, {
        locale: request.locale,
        thresholds: context.thresholds,
      })

      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="uacademic-load.xlsx"`)
        .send(buffer)
    },
  )

  app.get('/api/v1/teachers/me/load', async (request): Promise<TeacherLoadDto> => {
    const context = await teacherContext(request)
    const profileId = await resolveTeacherProfileId(context, 'me')
    const rows = await loadRows(context)

    const own = rows.find((row) => row.teacherProfileId === profileId)
    if (!own) throw AppError.notFound()
    return own
  })

  /** The personal panel: hours broken down by subject and by concept. */
  app.get(
    '/api/v1/teachers/:id/workload',
    async (request: FastifyRequest<{ Params: { id: string } }>): Promise<TeacherWorkloadDto> => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      return teacherWorkload(context, profileId)
    },
  )

  /** The profile card: contract, reductions, knowledge areas and subjects. */
  app.get(
    '/api/v1/teachers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>): Promise<TeacherProfileDto> => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      return teacherProfile(context, profileId)
    },
  )

  /**
   * People this center could give a contract to, and has not yet.
   *
   * Everybody holding the lecturer role here without a profile for the year in
   * force. The two halves are created at different moments — invited when they
   * join, contracted when the year is planned — and until now the second half
   * could only be written by importing a spreadsheet, so a center could not
   * add one teacher by hand at all.
   */
  app.get(
    '/api/v1/teachers/candidates',
    { config: { roles: MANAGER_ROLES } },
    async (request): Promise<{ items: TeacherCandidateDto[] }> => {
      const context = await optionalTeacherContext(request)
      if (!context) return { items: [] }

      const held = await prisma().userCenterRole.findMany({
        where: { centerId: context.centerId, role: 'TEACHER' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
              status: true,
            },
          },
        },
        orderBy: { user: { lastName: 'asc' } },
      })

      const contracted = new Set(
        (
          await context.db.teacherProfile.findMany({
            where: { academicYearId: context.academicYearId },
            select: { userId: true },
          })
        ).map((profile) => profile.userId),
      )

      return {
        items: held
          .filter((membership) => !contracted.has(membership.userId))
          .map((membership) => ({
            userId: membership.user.id,
            email: membership.user.email,
            firstName: membership.user.firstName,
            lastName: membership.user.lastName,
            avatarUrl: membership.user.avatarUrl,
            status: membership.user.status,
          })),
      }
    },
  )

  /** Giving somebody a contract for the year in force. */
  app.post(
    '/api/v1/teachers',
    { config: { roles: MANAGER_ROLES } },
    async (request, reply): Promise<TeacherProfileDto> => {
      const context = await teacherContext(request)
      const actor = requireUser(request)
      const input = parseWith(teacherProfileInputSchema, request.body)
      const client = prisma()

      // A contract only means something for somebody this center has made a
      // lecturer; the role is granted on the users screen, deliberately not
      // here, so that access and workload stay separate decisions (R2).
      const membership = await client.userCenterRole.findFirst({
        where: { userId: input.userId, centerId: context.centerId, role: 'TEACHER' },
      })
      if (!membership) throw AppError.badRequest('teachers.errors.notALecturer')

      const existing = await context.db.teacherProfile.findFirst({
        where: { userId: input.userId, academicYearId: context.academicYearId },
      })
      if (existing) throw new AppError(409, 'CONFLICT', 'teachers.errors.alreadyContracted')

      const profile = await client.teacherProfile.create({
        data: {
          userId: input.userId,
          centerId: context.centerId,
          academicYearId: context.academicYearId,
          category: input.category,
          dedication: input.dedication,
          contractedHours: input.contractedHours,
          notes: input.notes ?? null,
        },
      })

      await writeAuditLog(client, {
        centerId: context.centerId,
        userId: actor.userId,
        entity: 'teacher_profile',
        entityId: profile.id,
        action: 'create',
        after: {
          userId: input.userId,
          category: input.category,
          dedication: input.dedication,
          contractedHours: input.contractedHours,
        },
        source: 'user',
        ip: request.ip,
      })

      void reply.status(201)
      return teacherProfile(context, profile.id)
    },
  )

  /** Changing a contract: hours, category, dedication. */
  app.patch(
    '/api/v1/teachers/:id',
    { config: { roles: MANAGER_ROLES } },
    async (request: FastifyRequest<{ Params: { id: string } }>): Promise<TeacherProfileDto> => {
      const context = await teacherContext(request)
      const actor = requireUser(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      const input = parseWith(teacherProfileUpdateSchema, request.body)
      const client = prisma()

      const before = await context.db.teacherProfile.findFirstOrThrow({ where: { id: profileId } })

      await client.teacherProfile.update({
        where: { id: profileId },
        data: {
          ...(input.category ? { category: input.category } : {}),
          ...(input.dedication ? { dedication: input.dedication } : {}),
          ...(input.contractedHours !== undefined
            ? { contractedHours: input.contractedHours }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        },
      })

      await writeAuditLog(client, {
        centerId: context.centerId,
        userId: actor.userId,
        entity: 'teacher_profile',
        entityId: profileId,
        action: 'update',
        before: {
          category: before.category,
          dedication: before.dedication,
          contractedHours: Number(before.contractedHours),
        },
        after: input,
        source: 'user',
        ip: request.ip,
      })

      return teacherProfile(context, profileId)
    },
  )

  /**
   * The groups this teacher could be given, and is not teaching yet.
   *
   * Assigning somebody to a group had no route at all: the only thing that
   * could write one was the assistant's execute step, so a coordinator without
   * the assistant — or with it switched off — could not staff a subject.
   */
  app.get(
    '/api/v1/teachers/:id/assignable-groups',
    { config: { roles: MANAGER_ROLES } },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
    ): Promise<{ items: AssignableGroupDto[] }> => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)

      const groups = await context.db.group.findMany({
        where: { subject: { academicYearId: context.academicYearId } },
        include: {
          subject: { select: { code: true, nameCa: true } },
          assignments: { where: { teacherProfileId: profileId }, select: { concept: true } },
        },
        orderBy: [{ subject: { code: 'asc' } }, { code: 'asc' }],
      })

      return {
        items: groups.map((group) => ({
          id: group.id,
          code: group.code,
          type: group.type,
          plannedHours: Number(group.plannedHours),
          subjectCode: group.subject.code,
          subjectName: group.subject.nameCa,
          // Which concepts this teacher already holds on the group, so the
          // screen does not offer a duplicate the database would refuse.
          heldConcepts: group.assignments.map((assignment) => assignment.concept),
        })),
      }
    },
  )

  /** Giving this teacher a group. */
  app.post(
    '/api/v1/teachers/:id/assignments',
    { config: { roles: MANAGER_ROLES } },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply,
    ): Promise<TeacherProfileDto> => {
      const context = await teacherContext(request)
      const actor = requireUser(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      const input = parseWith(teacherAssignmentSchema, request.body)

      // The group has to belong to this center's year; the scoped client
      // settles the center, and this settles the year (R2).
      const group = await context.db.group.findFirst({
        where: { id: input.groupId, subject: { academicYearId: context.academicYearId } },
      })
      if (!group) throw AppError.notFound()

      const existing = await context.db.assignment.findFirst({
        where: { groupId: input.groupId, teacherProfileId: profileId, concept: input.concept },
      })
      if (existing) throw new AppError(409, 'CONFLICT', 'teachers.errors.alreadyAssigned')

      const created = await context.db.assignment.create({
        data: {
          centerId: context.centerId,
          academicYearId: context.academicYearId,
          groupId: input.groupId,
          teacherProfileId: profileId,
          assignedHours: input.assignedHours,
          concept: input.concept,
        },
      })

      await writeAuditLog(prisma(), {
        centerId: context.centerId,
        userId: actor.userId,
        entity: 'assignment',
        entityId: created.id,
        action: 'create',
        after: { ...input, teacherProfileId: profileId },
        source: 'user',
        ip: request.ip,
      })

      void reply.status(201)
      return teacherProfile(context, profileId)
    },
  )

  /** Taking one away. */
  app.delete(
    '/api/v1/teachers/:id/assignments/:assignmentId',
    { config: { roles: MANAGER_ROLES } },
    async (
      request: FastifyRequest<{ Params: { id: string; assignmentId: string } }>,
    ): Promise<TeacherProfileDto> => {
      const context = await teacherContext(request)
      const actor = requireUser(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)

      const assignment = await context.db.assignment.findFirst({
        where: { id: request.params.assignmentId, teacherProfileId: profileId },
      })
      if (!assignment) throw AppError.notFound()

      await context.db.assignment.delete({ where: { id: assignment.id } })

      await writeAuditLog(prisma(), {
        centerId: context.centerId,
        userId: actor.userId,
        entity: 'assignment',
        entityId: assignment.id,
        action: 'delete',
        before: {
          groupId: assignment.groupId,
          teacherProfileId: profileId,
          concept: assignment.concept,
        },
        source: 'user',
        ip: request.ip,
      })

      return teacherProfile(context, profileId)
    },
  )

  registerReductionRoutes(app)
  registerSkillRoutes(app)
  registerAvailabilityRoutes(app)
}

async function degreeFacet(
  context: TeacherContext,
): Promise<{ id: string; code: string; name: string }[]> {
  const degrees = await context.db.degree.findMany({
    select: { id: true, code: true, nameCa: true },
    orderBy: { code: 'asc' },
  })
  return degrees.map((degree) => ({ id: degree.id, code: degree.code, name: degree.nameCa }))
}

/**
 * Reductions change the capacity a teacher must cover, so only a center admin
 * writes them and every change is audited with its approver (R4).
 */
function registerReductionRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/teachers/:id/reductions',
    { config: { roles: ['CENTER_ADMIN'] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      const input = parseWith(reductionInputSchema, request.body)

      const created = await context.db.teacherReduction.create({
        data: {
          centerId: context.centerId,
          teacherProfileId: profileId,
          reason: input.reason,
          hours: input.hours,
          status: input.status,
          ...approval(input.status, context.user.userId),
        },
      })

      await audit(request, context, 'teacher_reduction', created.id, 'create', null, input)
      return reply.code(201).send(await teacherProfile(context, profileId))
    },
  )

  app.patch(
    '/api/v1/teachers/:id/reductions/:reductionId',
    { config: { roles: ['CENTER_ADMIN'] } },
    async (request: FastifyRequest<{ Params: { id: string; reductionId: string } }>) => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      const input = parseWith(reductionInputSchema, request.body)

      const before = await context.db.teacherReduction.findFirst({
        where: { id: request.params.reductionId, teacherProfileId: profileId },
      })
      if (!before) throw AppError.notFound()

      await context.db.teacherReduction.update({
        where: { id: before.id },
        data: {
          reason: input.reason,
          hours: input.hours,
          status: input.status,
          ...approval(input.status, context.user.userId),
        },
      })

      await audit(
        request,
        context,
        'teacher_reduction',
        before.id,
        'update',
        { reason: before.reason, hours: Number(before.hours), status: before.status },
        input,
      )
      return teacherProfile(context, profileId)
    },
  )

  app.delete(
    '/api/v1/teachers/:id/reductions/:reductionId',
    { config: { roles: ['CENTER_ADMIN'] } },
    async (request: FastifyRequest<{ Params: { id: string; reductionId: string } }>) => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)

      const before = await context.db.teacherReduction.findFirst({
        where: { id: request.params.reductionId, teacherProfileId: profileId },
      })
      if (!before) throw AppError.notFound()

      await context.db.teacherReduction.delete({ where: { id: before.id } })
      await audit(
        request,
        context,
        'teacher_reduction',
        before.id,
        'delete',
        { reason: before.reason, hours: Number(before.hours), status: before.status },
        null,
      )
      return teacherProfile(context, profileId)
    },
  )
}

/** An approved reduction always carries who approved it and when (R4). */
function approval(
  status: 'pending' | 'approved' | 'rejected',
  userId: string,
): { approvedBy: string | null; approvedAt: Date | null } {
  return status === 'approved'
    ? { approvedBy: userId, approvedAt: new Date() }
    : { approvedBy: null, approvedAt: null }
}

/** Knowledge areas and teachable subjects, replaced as a set. */
function registerSkillRoutes(app: FastifyInstance): void {
  app.put(
    '/api/v1/teachers/:id/skills',
    { config: { roles: ['CENTER_ADMIN', 'COORDINATOR'] } },
    async (request: FastifyRequest<{ Params: { id: string } }>): Promise<TeacherProfileDto> => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      const input = parseWith(teacherSkillsInputSchema, request.body)

      const subjectIds = [...new Set(input.subjectIds)]
      if (subjectIds.length > 0) {
        // Scoped client: a subject of another center simply is not found.
        const found = await context.db.subject.count({ where: { id: { in: subjectIds } } })
        if (found !== subjectIds.length) {
          throw AppError.validation([{ path: 'subjectIds', messageKey: 'errors.notFound' }])
        }
      }

      await context.db.teacherSkill.deleteMany({ where: { teacherProfileId: profileId } })
      await context.db.teacherSkill.createMany({
        data: [
          ...subjectIds.map((subjectId) => ({
            centerId: context.centerId,
            teacherProfileId: profileId,
            subjectId,
            knowledgeArea: null,
          })),
          ...[...new Set(input.knowledgeAreas)].map((knowledgeArea) => ({
            centerId: context.centerId,
            teacherProfileId: profileId,
            subjectId: null,
            knowledgeArea,
          })),
        ],
      })

      await audit(request, context, 'teacher_skill', profileId, 'replace', null, input)
      return teacherProfile(context, profileId)
    },
  )
}

function registerAvailabilityRoutes(app: FastifyInstance): void {
  app.get(
    '/api/v1/teachers/:id/availability',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
    ): Promise<AvailabilityResponseDto> => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      return availabilityResponse(context, profileId)
    },
  )

  /**
   * The editor saves the whole week: the grid is the truth, and a partial save
   * would leave stored intervals describing a week nobody painted.
   */
  app.put(
    '/api/v1/teachers/:id/availability',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
    ): Promise<AvailabilityResponseDto> => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      if (!(await canEditAvailability(context, profileId))) throw AppError.forbidden()

      const input = parseWith(saveAvailabilitySchema, request.body)
      const before = await context.db.availability.findMany({
        where: { teacherProfileId: profileId },
        select: { weekday: true, startTime: true, endTime: true, level: true },
      })

      await context.db.availability.deleteMany({ where: { teacherProfileId: profileId } })
      if (input.entries.length > 0) {
        await context.db.availability.createMany({
          data: input.entries.map((entry) => ({
            centerId: context.centerId,
            teacherProfileId: profileId,
            weekday: entry.weekday,
            startTime: entry.startTime,
            endTime: entry.endTime,
            level: entry.level,
          })),
        })
      }

      await audit(request, context, 'availability', profileId, 'replace', before, input.entries)
      return availabilityResponse(context, profileId)
    },
  )

  app.post(
    '/api/v1/teachers/:id/availability/exceptions',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      if (!(await canEditAvailability(context, profileId))) throw AppError.forbidden()

      const input = parseWith(availabilityExceptionInputSchema, request.body)
      const created = await context.db.availabilityException.create({
        data: {
          centerId: context.centerId,
          teacherProfileId: profileId,
          dateFrom: new Date(`${input.dateFrom}T00:00:00Z`),
          dateTo: new Date(`${input.dateTo}T00:00:00Z`),
          reason: input.reason ?? null,
          level: input.level,
        },
      })

      await audit(request, context, 'availability_exception', created.id, 'create', null, input)
      return reply.code(201).send(await availabilityResponse(context, profileId))
    },
  )

  app.delete(
    '/api/v1/teachers/:id/availability/exceptions/:exceptionId',
    async (request: FastifyRequest<{ Params: { id: string; exceptionId: string } }>) => {
      const context = await teacherContext(request)
      const profileId = await resolveTeacherProfileId(context, request.params.id)
      if (!(await canEditAvailability(context, profileId))) throw AppError.forbidden()

      const before = await context.db.availabilityException.findFirst({
        where: { id: request.params.exceptionId, teacherProfileId: profileId },
      })
      if (!before) throw AppError.notFound()

      await context.db.availabilityException.delete({ where: { id: before.id } })
      await audit(
        request,
        context,
        'availability_exception',
        before.id,
        'delete',
        { dateFrom: before.dateFrom, dateTo: before.dateTo, level: before.level },
        null,
      )
      return availabilityResponse(context, profileId)
    },
  )
}

async function availabilityResponse(
  context: TeacherContext,
  teacherProfileId: string,
): Promise<AvailabilityResponseDto> {
  const [rows, exceptions] = await Promise.all([
    context.db.availability.findMany({
      where: { teacherProfileId },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    }),
    context.db.availabilityException.findMany({
      where: { teacherProfileId },
      orderBy: [{ dateFrom: 'asc' }],
    }),
  ])

  const entries: AvailabilityEntryDto[] = rows.map((row) => ({
    weekday: row.weekday as Weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    level: row.level,
  }))

  const exceptionDtos: AvailabilityExceptionDto[] = exceptions.map((exception) => ({
    id: exception.id,
    dateFrom: exception.dateFrom.toISOString().slice(0, 10),
    dateTo: exception.dateTo.toISOString().slice(0, 10),
    reason: exception.reason,
    level: exception.level,
  }))

  return {
    teacherProfileId,
    entries,
    exceptions: exceptionDtos,
    // The grid geometry is a center parameter, not a constant (R9).
    grid: {
      dayStart: context.settings.schedule.dayStart,
      dayEnd: context.settings.schedule.dayEnd,
      slotMinutes: context.settings.schedule.slotMinutes,
      weekdays: context.settings.schedule.workingWeekdays as Weekday[],
    },
    hoursByLevel: availabilityHoursByLevel(entries),
    editable: await canEditAvailability(context, teacherProfileId),
  }
}

async function audit(
  request: FastifyRequest,
  context: TeacherContext,
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await writeAuditLog(prisma(), {
    centerId: context.centerId,
    userId: context.user.userId,
    entity,
    entityId,
    action,
    before,
    after,
    source: 'user',
    ip: request.ip,
  })
}
