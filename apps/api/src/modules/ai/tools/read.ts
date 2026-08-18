/**
 * The tools the assistant may run by itself.
 *
 * They only ever read, they only ever read *this* center (R2 — the scoped
 * client is the same one the HTTP routes use, so a tenant filter cannot be
 * forgotten here either), and what they return is minimised before it leaves:
 * internal identifiers, names, hours and slots. No identity documents, no
 * phone numbers, no addresses, nothing medical.
 */
import {
  type AvailabilityEntry,
  type PlannedSession,
  type SubstituteCandidate,
  type Weekday,
  availabilityHoursByLevel,
  computeTeacherLoad,
  evaluatePlacement,
  minimizeForModel,
  rankSubstitutes,
  weeklyCapacityFrom,
} from '@uacademic/shared'

import type { AiContext } from '../context.js'

export type ReadToolResult = Record<string, unknown>

/** Finds a teacher by internal id or by name, which is how people ask. */
async function resolveTeacher(
  context: AiContext,
  input: { teacherProfileId?: string; teacherName?: string },
) {
  if (input.teacherProfileId) {
    return context.db.teacherProfile.findFirst({
      where: { id: input.teacherProfileId, academicYearId: context.academicYearId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    })
  }

  if (!input.teacherName) return null

  // A first name is enough in a conversation; the match stays inside the
  // center because the client is already scoped to it.
  const terms = input.teacherName.trim().split(/\s+/).filter(Boolean)
  const candidates = await context.db.teacherProfile.findMany({
    where: {
      academicYearId: context.academicYearId,
      OR: terms.flatMap((term) => [
        { user: { firstName: { contains: term } } },
        { user: { lastName: { contains: term } } },
      ]),
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    take: 5,
  })

  return candidates[0] ?? null
}

async function resolveSubject(
  context: AiContext,
  input: { subjectId?: string; subjectCode?: string },
) {
  const subjectId = input.subjectId ?? context.subjectId ?? undefined

  if (subjectId) {
    const byId = await context.db.subject.findFirst({
      where: { id: subjectId, academicYearId: context.academicYearId },
    })
    if (byId) return byId
  }

  if (!input.subjectCode) return null

  return context.db.subject.findFirst({
    where: {
      academicYearId: context.academicYearId,
      OR: [
        { code: input.subjectCode },
        { nameCa: { contains: input.subjectCode } },
        { nameEs: { contains: input.subjectCode } },
        { nameEn: { contains: input.subjectCode } },
      ],
    },
  })
}

async function publishedSessions(context: AiContext, where: Record<string, unknown> = {}) {
  return context.db.classSession.findMany({
    where: { scheduleVersion: { status: 'published' }, ...where },
    include: {
      group: { select: { id: true, code: true, subject: { select: { id: true, code: true } } } },
      space: { select: { id: true, name: true, building: true } },
      teacherProfile: {
        select: { id: true, user: { select: { firstName: true, lastName: true } } },
      },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    take: 500,
  })
}

type SessionRow = Awaited<ReturnType<typeof publishedSessions>>[number]

function toPlanned(session: SessionRow): PlannedSession {
  return {
    id: session.id,
    groupId: session.groupId,
    teacherProfileId: session.teacherProfileId,
    spaceId: session.spaceId,
    weekday: session.weekday as Weekday,
    startTime: session.startTime as PlannedSession['startTime'],
    endTime: session.endTime as PlannedSession['endTime'],
    dateFrom: session.dateFrom,
    dateTo: session.dateTo,
    recurrence: session.recurrence,
  }
}

function describe(session: SessionRow) {
  return {
    sessionId: session.id,
    subjectCode: session.group.subject.code,
    groupCode: session.group.code,
    weekday: session.weekday,
    startTime: session.startTime,
    endTime: session.endTime,
    spaceId: session.spaceId,
    spaceName: session.space?.name ?? null,
    teacherProfileId: session.teacherProfileId,
    teacherName: session.teacherProfile
      ? `${session.teacherProfile.user.firstName} ${session.teacherProfile.user.lastName}`
      : null,
  }
}

export const readTools: Record<
  string,
  (context: AiContext, input: Record<string, never>) => Promise<ReadToolResult>
> = {
  async get_teacher_workload(context, input) {
    const teacher = await resolveTeacher(context, input)
    if (!teacher) return { found: false, hint: 'No teacher matched. Ask for the exact name.' }

    const [reductions, assignments] = await Promise.all([
      context.db.teacherReduction.findMany({
        where: { teacherProfileId: teacher.id },
        select: { hours: true, status: true },
      }),
      context.db.assignment.findMany({
        where: { teacherProfileId: teacher.id },
        include: {
          group: { select: { code: true, subject: { select: { code: true, term: true } } } },
        },
      }),
    ])

    const load = computeTeacherLoad({
      contractedHours: Number(teacher.contractedHours),
      reductions: reductions.map((reduction) => ({
        hours: Number(reduction.hours),
        approved: reduction.status === 'approved',
      })),
      assignments: assignments.map((assignment) => ({
        hours: Number(assignment.assignedHours),
        concept: assignment.concept,
      })),
    })

    // "This semester" is a real question: the hours are per term, so the
    // breakdown carries the term each assignment belongs to.
    const byTerm = assignments.reduce<Record<string, number>>((totals, assignment) => {
      const term = assignment.group.subject.term
      totals[term] = (totals[term] ?? 0) + Number(assignment.assignedHours)
      return totals
    }, {})

    return minimizeForModel({
      found: true,
      teacherProfileId: teacher.id,
      teacherName: `${teacher.user.firstName} ${teacher.user.lastName}`,
      contractedHours: load.contractedHours,
      reductionHours: load.reductionHours,
      capacityHours: load.capacityHours,
      assignedHours: load.assignedHours,
      remainingHours: load.remainingHours,
      ratioPercent: load.ratioPercent,
      status: load.status,
      weeklyCapacityHours: weeklyCapacityFrom(load.capacityHours, context.settings),
      hoursByTerm: byTerm,
      requestedTerm: input.term ?? 'annual',
      assignments: assignments.map((assignment) => ({
        subjectCode: assignment.group.subject.code,
        groupCode: assignment.group.code,
        term: assignment.group.subject.term,
        concept: assignment.concept,
        hours: Number(assignment.assignedHours),
      })),
    })
  },

  async get_teacher_availability(context, input) {
    const teacher = await resolveTeacher(context, input)
    if (!teacher) return { found: false }

    const [entries, exceptions] = await Promise.all([
      context.db.availability.findMany({ where: { teacherProfileId: teacher.id } }),
      context.db.availabilityException.findMany({
        where: { teacherProfileId: teacher.id },
        // `reason` is free text a teacher wrote; it can hold anything,
        // including why they were ill. It never goes to the model.
        select: { dateFrom: true, dateTo: true, level: true },
      }),
    ])

    const availability: AvailabilityEntry[] = entries.map((entry) => ({
      weekday: entry.weekday as Weekday,
      startTime: entry.startTime as AvailabilityEntry['startTime'],
      endTime: entry.endTime as AvailabilityEntry['endTime'],
      level: entry.level,
    }))

    return minimizeForModel({
      found: true,
      teacherProfileId: teacher.id,
      teacherName: `${teacher.user.firstName} ${teacher.user.lastName}`,
      entries: availability,
      exceptions: exceptions.map((exception) => ({
        dateFrom: exception.dateFrom.toISOString().slice(0, 10),
        dateTo: exception.dateTo.toISOString().slice(0, 10),
        level: exception.level,
      })),
      hoursByLevel: availabilityHoursByLevel(availability),
    })
  },

  async get_subject_schedule(context, input) {
    const subject = await resolveSubject(context, input)
    if (!subject) return { found: false }

    const sessions = await publishedSessions(context, { group: { subjectId: subject.id } })
    const groups = await context.db.group.findMany({
      where: { subjectId: subject.id },
      select: { id: true, code: true, type: true, plannedHours: true, capacity: true },
    })

    return minimizeForModel({
      found: true,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.nameCa,
      term: subject.term,
      groups: groups.map((group) => ({
        groupId: group.id,
        code: group.code,
        type: group.type,
        plannedHours: Number(group.plannedHours),
        capacity: group.capacity,
      })),
      sessions: sessions.map(describe),
    })
  },

  /**
   * Both questions a coordinator asks: "what is broken?" and "why can I not
   * put this class here?". The second is the same engine, run against a
   * placement that does not exist yet.
   */
  async list_conflicts(context, input) {
    const sessions = await publishedSessions(context)
    const planned = sessions.map(toPlanned)

    if (!input.sessionId) {
      // The whole week: every session judged against the rest of it.
      const violations = planned.flatMap((session) =>
        evaluatePlacement(
          session,
          planned.filter((other) => other.id !== session.id),
          context.schedule,
        ),
      )

      return minimizeForModel({
        scope: 'week',
        sessionCount: planned.length,
        violations,
      })
    }

    const current = sessions.find((session) => session.id === input.sessionId)
    if (!current) return { found: false }

    const candidate: PlannedSession = {
      ...toPlanned(current),
      ...(input.weekday ? { weekday: input.weekday as Weekday } : {}),
      ...(input.startTime ? { startTime: input.startTime as PlannedSession['startTime'] } : {}),
      ...(input.endTime ? { endTime: input.endTime as PlannedSession['endTime'] } : {}),
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      ...(input.teacherProfileId === undefined ? {} : { teacherProfileId: input.teacherProfileId }),
    }

    const others = planned.filter((session) => session.id !== current.id)
    const violations = evaluatePlacement(candidate, others, context.schedule)

    return minimizeForModel({
      scope: 'placement',
      session: describe(current),
      candidate: {
        weekday: candidate.weekday,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        spaceId: candidate.spaceId,
        teacherProfileId: candidate.teacherProfileId,
      },
      allowed: violations.length === 0,
      violations,
    })
  },

  async get_space_occupancy(context, input) {
    const [spaces, sessions] = await Promise.all([
      context.db.space.findMany({
        where: input.spaceId ? { id: input.spaceId } : {},
        select: { id: true, name: true, building: true, capacity: true, type: true },
      }),
      publishedSessions(context, input.weekday ? { weekday: input.weekday } : {}),
    ])

    return minimizeForModel({
      weekday: input.weekday ?? null,
      spaces: spaces.map((space) => ({
        spaceId: space.id,
        name: space.name,
        building: space.building,
        capacity: space.capacity,
        type: space.type,
        busy: sessions
          .filter((session) => session.spaceId === space.id)
          .map((session) => ({
            weekday: session.weekday,
            startTime: session.startTime,
            endTime: session.endTime,
            subjectCode: session.group.subject.code,
            groupCode: session.group.code,
          })),
      })),
    })
  },

  async get_change_history(context, input) {
    const days = input.days ?? 30
    const since = new Date(Date.now() - days * 86_400_000)

    const entries = await context.db.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        ...(input.entity ? { entity: input.entity } : {}),
      },
      select: {
        entity: true,
        entityId: true,
        action: true,
        source: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return minimizeForModel({
      days,
      entries: entries.map((entry) => ({
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        source: entry.source,
        at: entry.createdAt.toISOString(),
        by: entry.user ? `${entry.user.firstName} ${entry.user.lastName}` : null,
      })),
    })
  },

  async find_eligible_substitutes(context, input) {
    const sessions = await publishedSessions(context)

    // "Juan is away on the 14th" names a person and a day, not a session id.
    const targets = input.sessionId
      ? sessions.filter((session) => session.id === input.sessionId)
      : sessions.filter((session) => {
          if (!input.teacherProfileId || session.teacherProfileId !== input.teacherProfileId) {
            return false
          }
          if (!input.date) return true
          const date = new Date(`${input.date}T00:00:00Z`)
          const weekday = ((date.getUTCDay() + 6) % 7) + 1
          return session.weekday === weekday
        })

    if (targets.length === 0) return { found: false, sessions: [] }

    const profiles = await context.db.teacherProfile.findMany({
      where: { academicYearId: context.academicYearId },
      include: {
        user: { select: { firstName: true, lastName: true } },
        skills: { select: { subjectId: true, knowledgeArea: true } },
        reductions: { select: { hours: true, status: true } },
        assignments: { select: { assignedHours: true, concept: true } },
      },
    })

    const planned = sessions.map(toPlanned)

    return minimizeForModel({
      found: true,
      sessions: targets.map((session) => {
        const candidates: SubstituteCandidate[] = profiles.map((profile) => {
          const load = computeTeacherLoad({
            contractedHours: Number(profile.contractedHours),
            reductions: profile.reductions.map((reduction) => ({
              hours: Number(reduction.hours),
              approved: reduction.status === 'approved',
            })),
            assignments: profile.assignments.map((assignment) => ({
              hours: Number(assignment.assignedHours),
              concept: assignment.concept,
            })),
          })

          const weeklyCapacity = weeklyCapacityFrom(load.capacityHours, context.settings)
          const own = planned.filter((entry) => entry.teacherProfileId === profile.id)
          const weeklyAssigned = own.reduce(
            (total, entry) =>
              total +
              (Number(entry.endTime.slice(0, 2)) * 60 +
                Number(entry.endTime.slice(3)) -
                (Number(entry.startTime.slice(0, 2)) * 60 + Number(entry.startTime.slice(3)))) /
                60,
            0,
          )

          return {
            teacherProfileId: profile.id,
            name: `${profile.user.firstName} ${profile.user.lastName}`,
            subjectIds: profile.skills
              .map((skill) => skill.subjectId)
              .filter((id): id is string => Boolean(id)),
            knowledgeAreas: profile.skills
              .map((skill) => skill.knowledgeArea)
              .filter((area): area is string => Boolean(area)),
            availability: context.schedule.teachers.get(profile.id)?.availability ?? [],
            remainingWeeklyHours: Math.round((weeklyCapacity - weeklyAssigned) * 100) / 100,
            sessions: own,
          }
        })

        return {
          session: describe(session),
          candidates: rankSubstitutes({
            session: toPlanned(session),
            subjectId: session.group.subject.id,
            knowledgeArea: null,
            context: context.schedule,
            candidates,
          }),
        }
      }),
    })
  },
}
