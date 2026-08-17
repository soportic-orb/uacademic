/**
 * Everything the constraint engine needs, loaded once per request.
 *
 * The engine itself is pure and lives in `@uacademic/shared` (R7); this file is
 * the only place that knows those numbers come from MySQL. Reads go through the
 * tenant-scoped client, so a planner can never be handed another center's rooms
 * (R2), and the weights and the working week come from `centers.settings_json`
 * (R9).
 */
import {
  type AvailabilityEntry,
  type CenterSettings,
  type GroupResource,
  type PlannedSession,
  type ScheduleContext,
  type SessionRequirement,
  type SessionSnapshot,
  type SpaceResource,
  type TeacherResource,
  type Weekday,
  computeTeacherLoad,
  parseCenterSettings,
  weeklyCapacityFrom,
} from '@uacademic/shared'
import type { FastifyRequest } from 'fastify'

import { AppError } from '../../lib/errors.js'
import { type ScopedPrismaClient, prisma } from '../../lib/prisma.js'
import { type RequestUser, requireCenterScope, requireUser } from '../../plugins/context.js'

export interface PlannerContext {
  centerId: string
  db: ScopedPrismaClient
  user: RequestUser
  settings: CenterSettings
  academicYearId: string
  academicYear: { startDate: Date; endDate: Date }
  schedule: ScheduleContext
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** Loads the center's rooms, groups and teachers as the engine sees them. */
export async function plannerContext(request: FastifyRequest): Promise<PlannerContext> {
  const user = requireUser(request)
  const { centerId, db } = requireCenterScope(request)

  const academicYear = await db.academicYear.findFirst({
    where: { status: 'active' },
    orderBy: { startDate: 'desc' },
  })
  if (!academicYear) throw AppError.notFound()

  const center = await prisma().center.findUnique({ where: { id: centerId } })
  const settings = parseCenterSettings(center?.settingsJson)

  const [profiles, spaces, groups] = await Promise.all([
    db.teacherProfile.findMany({
      where: { academicYearId: academicYear.id },
      include: {
        availability: true,
        reductions: { select: { hours: true, status: true } },
      },
    }),
    db.space.findMany(),
    db.group.findMany({
      where: { subject: { academicYearId: academicYear.id } },
      include: { subject: { select: { id: true, code: true, nameCa: true } } },
    }),
  ])

  const teachers = new Map<string, TeacherResource>(
    profiles.map((profile) => {
      const load = computeTeacherLoad({
        contractedHours: Number(profile.contractedHours),
        reductions: profile.reductions.map((reduction) => ({
          hours: Number(reduction.hours),
          approved: reduction.status === 'approved',
        })),
      })

      const availability: AvailabilityEntry[] = profile.availability.map((entry) => ({
        weekday: entry.weekday as Weekday,
        startTime: entry.startTime,
        endTime: entry.endTime,
        level: entry.level,
      }))

      return [
        profile.id,
        {
          teacherProfileId: profile.id,
          availability,
          weeklyCapacityHours:
            load.capacityHours > 0 ? weeklyCapacityFrom(load.capacityHours, settings) : null,
        },
      ]
    }),
  )

  return {
    centerId,
    db,
    user,
    settings,
    academicYearId: academicYear.id,
    academicYear: { startDate: academicYear.startDate, endDate: academicYear.endDate },
    schedule: {
      settings,
      teachers,
      spaces: new Map<string, SpaceResource>(
        spaces.map((space) => [
          space.id,
          {
            spaceId: space.id,
            name: space.name,
            building: space.building,
            capacity: space.capacity,
            type: space.type,
            equipment: stringList(space.equipmentJson),
          },
        ]),
      ),
      groups: new Map<string, GroupResource>(
        groups.map((group) => [
          group.id,
          {
            groupId: group.id,
            code: group.code,
            subjectId: group.subject.id,
            subjectCode: group.subject.code,
            subjectName: group.subject.nameCa,
            capacity: group.capacity,
            requiredSpaceType: group.requiredSpaceType,
            requiredEquipment: stringList(group.requiredEquipmentJson),
          },
        ]),
      ),
    },
  }
}

const SESSION_INCLUDE = {
  group: {
    select: {
      id: true,
      code: true,
      subject: { select: { id: true, code: true, nameCa: true } },
    },
  },
  teacherProfile: {
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  },
  space: { select: { id: true, name: true, building: true } },
} as const

export type SessionRow = Awaited<
  ReturnType<ScopedPrismaClient['classSession']['findMany']>
>[number] & {
  group: { id: string; code: string; subject: { id: string; code: string; nameCa: string } }
  teacherProfile: { id: string; user: { firstName: string; lastName: string } } | null
  space: { id: string; name: string; building: string | null } | null
}

export function sessionInclude() {
  return SESSION_INCLUDE
}

export function toPlannedSession(row: {
  id: string
  groupId: string
  teacherProfileId: string | null
  spaceId: string | null
  weekday: number
  startTime: string
  endTime: string
  dateFrom: Date
  dateTo: Date
  recurrence: string
}): PlannedSession {
  return {
    id: row.id,
    groupId: row.groupId,
    teacherProfileId: row.teacherProfileId,
    spaceId: row.spaceId,
    weekday: row.weekday as Weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    recurrence: row.recurrence as PlannedSession['recurrence'],
  }
}

/** A session with the names the UI, the diff and the ICS feed all need. */
export function toSnapshot(row: SessionRow): SessionSnapshot {
  return {
    id: row.id,
    groupId: row.groupId,
    groupCode: row.group.code,
    subjectCode: row.group.subject.code,
    subjectName: row.group.subject.nameCa,
    teacherProfileId: row.teacherProfileId,
    teacherName: row.teacherProfile
      ? `${row.teacherProfile.user.firstName} ${row.teacherProfile.user.lastName}`
      : null,
    spaceId: row.spaceId,
    spaceName: row.space?.name ?? null,
    weekday: row.weekday as Weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    recurrence: row.recurrence as SessionSnapshot['recurrence'],
  }
}

export interface DateRange {
  from: Date
  to: Date
}

/**
 * When a group's classes actually run.
 *
 * A first-term subject and a second-term one can share a room at the same hour
 * without ever meeting, so the planner has to know the term a session belongs
 * to — giving every session the whole academic year would invent conflicts
 * that do not exist. Terms are read from the academic calendar
 * (`term_start` / `term_end`, in chronological pairs) and fall back to the
 * academic year when a center has not recorded them.
 */
export async function termRanges(
  context: Pick<PlannerContext, 'db' | 'academicYearId' | 'academicYear'>,
): Promise<Record<string, DateRange>> {
  const year: DateRange = {
    from: context.academicYear.startDate,
    to: context.academicYear.endDate,
  }

  const entries = await context.db.academicCalendarEntry.findMany({
    where: {
      academicYearId: context.academicYearId,
      type: { in: ['term_start', 'term_end'] },
    },
    orderBy: { dateFrom: 'asc' },
  })

  const starts = entries.filter((entry) => entry.type === 'term_start')
  const ends = entries.filter((entry) => entry.type === 'term_end')

  const term = (index: number): DateRange => {
    const start = starts[index]?.dateFrom
    const end = ends[index]?.dateTo
    return start && end ? { from: start, to: end } : year
  }

  return { t1: term(0), t2: term(1), t3: term(1), annual: year }
}

export function rangeForTerm(
  ranges: Record<string, DateRange>,
  term: string | null | undefined,
): DateRange {
  return ranges[term ?? 'annual'] ?? ranges.annual!
}

/**
 * Turns the teaching that has to be covered into the sessions the generator
 * has to place: a group's weekly hours, cut into sessions of the center's
 * default length, taught by whoever is assigned to it.
 */
export async function sessionRequirements(context: PlannerContext): Promise<SessionRequirement[]> {
  const groups = await context.db.group.findMany({
    where: { subject: { academicYearId: context.academicYearId } },
    include: {
      subject: { select: { term: true } },
      assignments: { select: { teacherProfileId: true, concept: true } },
    },
  })

  const spaces = [...context.schedule.spaces.values()]
  const ranges = await termRanges(context)
  const { defaultSessionMinutes, teachingWeeks } = context.settings.schedule

  const requirements: SessionRequirement[] = []

  for (const group of groups) {
    const teacherIds = [
      ...new Set(
        group.assignments
          .filter((assignment) => assignment.concept === 'lecture')
          .map((assignment) => assignment.teacherProfileId),
      ),
    ]
    if (teacherIds.length === 0) continue

    const resource = context.schedule.groups.get(group.id)
    const candidateSpaceIds = spaces
      .filter((space) => !group.requiredSpaceType || space.type === group.requiredSpaceType)
      .filter((space) => (resource?.capacity ?? 0) <= space.capacity)
      .filter((space) =>
        (resource?.requiredEquipment ?? []).every((item) => space.equipment.includes(item)),
      )
      .map((space) => space.spaceId)

    const weeklyMinutes = (Number(group.plannedHours) / teachingWeeks) * 60
    const count = Math.max(1, Math.round(weeklyMinutes / defaultSessionMinutes))

    const range = rangeForTerm(ranges, group.subject.term)

    for (let index = 0; index < count; index += 1) {
      requirements.push({
        id: `${group.id}#${index + 1}`,
        groupId: group.id,
        durationMinutes: defaultSessionMinutes,
        candidateTeacherIds: teacherIds,
        candidateSpaceIds,
        dateFrom: range.from,
        dateTo: range.to,
        recurrence: 'weekly',
      })
    }
  }

  return requirements
}
