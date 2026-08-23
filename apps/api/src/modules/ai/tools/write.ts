/**
 * The tools that would change something — and therefore do not.
 *
 * R5, stated once and enforced here: a write tool builds a **proposal**. It
 * reads whatever it needs, computes exactly what would change, runs the same
 * constraint engine the planner uses so the preview shows real conflicts, and
 * returns all of it. Nothing is written. The row it produces sits in
 * `ai_proposals` with status `pending` until a person confirms it, and the
 * execution that follows is audited with `source = 'ai'`.
 *
 * A proposal with a hard violation is still returned — knowing precisely what
 * is impossible is useful — but it cannot be confirmed.
 */
import {
  type AiProposal,
  type PlannedSession,
  type ProposalChange,
  type Weekday,
  computeTeacherLoad,
  evaluatePlacement,
  generateSchedule,
  minimizeForModel,
} from '@uacademic/shared'

import type { AiContext } from '../context.js'

type WriteInput = Record<string, never>

async function publishedPlan(context: AiContext): Promise<{
  sessions: PlannedSession[]
  rows: Awaited<ReturnType<AiContext['db']['classSession']['findMany']>>
}> {
  const rows = await context.db.classSession.findMany({
    where: { scheduleVersion: { status: 'published' } },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    take: 500,
  })

  return {
    rows,
    sessions: rows.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      teacherProfileId: row.teacherProfileId,
      spaceId: row.spaceId,
      weekday: row.weekday as Weekday,
      startTime: row.startTime as PlannedSession['startTime'],
      endTime: row.endTime as PlannedSession['endTime'],
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      recurrence: row.recurrence,
    })),
  }
}

function label(prefix: string, session: { weekday: number; startTime: string }): string {
  return `${prefix} · ${session.weekday} ${session.startTime}`
}

export const writeTools: Record<
  string,
  (context: AiContext, input: WriteInput) => Promise<AiProposal>
> = {
  /**
   * A timetable for one subject, produced by the same generator the planner
   * uses — so what the assistant proposes is what the planner would have
   * produced, not a second opinion with different rules.
   */
  async propose_schedule(context, input) {
    const subject = await context.db.subject.findFirst({
      where: {
        academicYearId: context.academicYearId,
        ...(input.subjectId
          ? { id: input.subjectId }
          : input.subjectCode
            ? { OR: [{ code: input.subjectCode }, { nameCa: { contains: input.subjectCode } }] }
            : { id: context.subjectId ?? '—' }),
      },
      include: { groups: true },
    })

    if (!subject) {
      return {
        tool: 'propose_schedule',
        summary: 'Subject not found in this center and academic year.',
        changes: [],
        violations: [],
        warnings: [],
      }
    }

    const { sessions, rows } = await publishedPlan(context)
    const existing = new Set(
      rows
        .filter((row) => subject.groups.some((group) => group.id === row.groupId))
        .map((row) => row.id),
    )

    // Everything else in the week stays put; only this subject is planned.
    const fixed = sessions.filter((session) => !existing.has(session.id))

    // The classes to place, and who may take each: the group's own assigned
    // teachers, because a proposal that hands a class to somebody who does not
    // teach it is not a proposal anybody can accept.
    const assignments = await context.db.assignment.findMany({
      where: { groupId: { in: subject.groups.map((group) => group.id) } },
      select: { groupId: true, teacherProfileId: true },
    })
    const spaces = [...context.schedule.spaces.keys()]

    const requirements = subject.groups.map((group) => ({
      id: `group:${group.id}`,
      groupId: group.id,
      durationMinutes: context.settings.schedule.defaultSessionMinutes,
      candidateTeacherIds: assignments
        .filter((assignment) => assignment.groupId === group.id)
        .map((assignment) => assignment.teacherProfileId),
      candidateSpaceIds: spaces,
      dateFrom: new Date(),
      dateTo: new Date(Date.now() + 120 * 86_400_000),
    }))

    const result = generateSchedule(
      { context: context.schedule, requirements, fixed },
      // A proposal inside a conversation has to come back while the person is
      // still reading: seconds, not the planner's full minute.
      { proposals: 1, timeBudgetMs: 5_000 },
    )

    const best = result.proposals[0]
    const placed =
      best?.sessions.filter((session) => !fixed.some((entry) => entry.id === session.id)) ?? []

    const changes: ProposalChange[] = placed.map((session) => ({
      entity: 'class_session',
      entityId: existing.has(session.id) ? session.id : null,
      label: label(subject.code, session),
      before: null,
      after: {
        groupId: session.groupId,
        weekday: session.weekday,
        startTime: session.startTime,
        endTime: session.endTime,
        spaceId: session.spaceId,
        teacherProfileId: session.teacherProfileId,
      },
    }))

    return minimizeForModel({
      tool: 'propose_schedule',
      summary: `${placed.length} session(s) placed for ${subject.code}${
        (best?.unplaced.length ?? 0) > 0
          ? `, ${best?.unplaced.length} could not be placed legally`
          : ''
      }.${input.notes ? ` Notes: ${input.notes}` : ''}`,
      changes,
      violations: best?.score.violations ?? [],
      warnings: (best?.sacrifices ?? []).map((sacrifice) => ({
        messageKey: sacrifice.messageKey,
        params: sacrifice.params,
      })),
    })
  },

  async assign_teacher_to_group(context, input) {
    const [group, teacher] = await Promise.all([
      context.db.group.findFirst({
        where: { id: input.groupId },
        include: { subject: { select: { id: true, code: true } } },
      }),
      context.db.teacherProfile.findFirst({
        where: { id: input.teacherProfileId, academicYearId: context.academicYearId },
        include: {
          user: { select: { firstName: true, lastName: true } },
          reductions: { select: { hours: true, status: true } },
          assignments: { select: { assignedHours: true, concept: true } },
          skills: { select: { subjectId: true } },
        },
      }),
    ])

    if (!group || !teacher) {
      return {
        tool: 'assign_teacher_to_group',
        summary: 'Group or teacher not found in this center.',
        changes: [],
        violations: [],
        warnings: [],
      }
    }

    const hours = input.hours ?? Number(group.plannedHours)
    const load = computeTeacherLoad({
      contractedHours: Number(teacher.contractedHours),
      reductions: teacher.reductions.map((reduction) => ({
        hours: Number(reduction.hours),
        approved: reduction.status === 'approved',
      })),
      assignments: [
        ...teacher.assignments.map((assignment) => ({
          hours: Number(assignment.assignedHours),
          concept: assignment.concept,
        })),
        { hours, concept: 'lecture' as const },
      ],
    })

    const warnings: AiProposal['warnings'] = []
    if (load.status === 'over' || load.status === 'limit') {
      warnings.push({
        messageKey: 'assistant.warnings.loadAfterAssignment',
        params: { percent: load.ratioPercent ?? 0, status: load.status },
      })
    }
    if (!teacher.skills.some((skill) => skill.subjectId === group.subject.id)) {
      warnings.push({
        messageKey: 'assistant.warnings.notQualified',
        params: { subject: group.subject.code },
      })
    }

    return minimizeForModel({
      tool: 'assign_teacher_to_group',
      summary: `${teacher.user.firstName} ${teacher.user.lastName} would take ${hours} h of ${group.subject.code} ${group.code}, reaching ${load.ratioPercent ?? 0}% of contracted capacity.`,
      changes: [
        {
          entity: 'assignment',
          entityId: null,
          label: `${group.subject.code} ${group.code}`,
          before: null,
          after: {
            groupId: group.id,
            teacherProfileId: teacher.id,
            assignedHours: hours,
            concept: 'lecture',
          },
        },
      ],
      violations: [],
      warnings,
    })
  },

  /**
   * The move a coordinator asks for in words. The engine judges it exactly as
   * it would judge a drag in the planner — same rules, same messages.
   */
  /**
   * A timetable read out of a document somebody attached.
   *
   * Everything the model gives is what the *document* says: a group written
   * "MAT101 T1", a teacher written "M. Puig". This resolves each against the
   * center's own data and refuses what it cannot match, which is the whole
   * safeguard — a plausible-looking invention never becomes a class, and a row
   * that will not match comes back as a question rather than as a guess.
   *
   * Nothing is written here either (R5). What comes out is a list of classes
   * that *would* be created, with the conflicts the engine finds among them
   * and against what is already planned, for a person to confirm.
   */
  async import_schedule(context, input) {
    const rows = (input.rows ?? []) as ImportRow[]
    const version = await targetVersion(context, input.versionId)

    if (!version) {
      return {
        tool: 'import_schedule',
        summary: 'There is no draft to import into. Create one on the planning screen first.',
        changes: [],
        violations: [],
        warnings: [],
      }
    }

    const directory = await importDirectory(context)
    const existing = await versionSessions(context, version.id)

    const changes: ProposalChange[] = []
    const unmatched: { messageKey: string; params: Record<string, string | number> }[] = []
    const planned: PlannedSession[] = [...existing]

    for (const [index, row] of rows.entries()) {
      const resolved = resolveRow(row, directory)

      if (!resolved.group.id) {
        // Named and numbered, so the assistant can ask about this row rather
        // than about "one of them".
        unmatched.push(unmatchedRow('Group', index, row.group, resolved.group))
        continue
      }
      if (row.teacher && !resolved.teacher.id) {
        unmatched.push(unmatchedRow('Teacher', index, row.teacher, resolved.teacher))
        continue
      }
      if (row.space && !resolved.space.id) {
        unmatched.push(unmatchedRow('Space', index, row.space, resolved.space))
        continue
      }

      const day = new Date(`${row.date}T00:00:00Z`)
      if (Number.isNaN(day.getTime())) {
        unmatched.push({
          messageKey: 'assistant.import.badDate',
          params: { row: index + 1, value: row.date },
        })
        continue
      }

      const candidate: PlannedSession = {
        id: `import-${index}`,
        groupId: resolved.group.id,
        teacherProfileId: resolved.teacher.id,
        spaceId: resolved.space.id,
        weekday: (day.getUTCDay() === 0 ? 7 : day.getUTCDay()) as Weekday,
        startTime: row.startTime as PlannedSession['startTime'],
        endTime: row.endTime as PlannedSession['endTime'],
        dateFrom: day,
        dateTo: day,
        recurrence: 'once',
      }

      // Against what is already there *and* against the rows before it: a
      // document that books one room twice is a document worth arguing with.
      const violations = evaluatePlacement(candidate, planned, context.schedule)
      planned.push(candidate)

      changes.push({
        entity: 'class_session',
        // No id: this class does not exist yet. The execution creates it.
        entityId: null,
        label: `${row.date} ${row.startTime} · ${row.group}`,
        before: null,
        after: {
          versionId: version.id,
          groupId: resolved.group.id,
          teacherProfileId: resolved.teacher.id,
          spaceId: resolved.space.id,
          date: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
          ...(row.topic ? { topic: row.topic } : {}),
          ...(violations.length > 0
            ? { conflicts: violations.map((violation) => violation.messageKey) }
            : {}),
        },
      })
    }

    return minimizeForModel({
      tool: 'import_schedule',
      summary:
        unmatched.length > 0
          ? `${changes.length} of ${rows.length} rows could be matched. Ask about the rest before proposing anything.`
          : `${changes.length} classes would be added to "${version.name}".`,
      changes,
      // What could not be matched is a hard stop: it is the model's cue to
      // ask, and it stops the proposal being confirmable as it stands.
      violations: unmatched,
      warnings: [],
    })
  },

  async move_session(context, input) {
    const { sessions } = await publishedPlan(context)
    const current = sessions.find((session) => session.id === input.sessionId)

    if (!current) {
      return {
        tool: 'move_session',
        summary: 'That class is not in the published timetable.',
        changes: [],
        violations: [],
        warnings: [],
      }
    }

    const candidate: PlannedSession = {
      ...current,
      ...(input.weekday ? { weekday: input.weekday as Weekday } : {}),
      ...(input.startTime ? { startTime: input.startTime as PlannedSession['startTime'] } : {}),
      ...(input.endTime ? { endTime: input.endTime as PlannedSession['endTime'] } : {}),
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      ...(input.teacherProfileId === undefined ? {} : { teacherProfileId: input.teacherProfileId }),
    }

    const violations = evaluatePlacement(
      candidate,
      sessions.filter((session) => session.id !== current.id),
      context.schedule,
    )

    return minimizeForModel({
      tool: 'move_session',
      summary:
        violations.length === 0
          ? 'The class can be moved as asked.'
          : 'The move breaks a hard constraint and cannot be applied as it stands.',
      changes: [
        {
          entity: 'class_session',
          entityId: current.id,
          label: label('', current).trim(),
          before: {
            weekday: current.weekday,
            startTime: current.startTime,
            endTime: current.endTime,
            spaceId: current.spaceId,
            teacherProfileId: current.teacherProfileId,
          },
          after: {
            weekday: candidate.weekday,
            startTime: candidate.startTime,
            endTime: candidate.endTime,
            spaceId: candidate.spaceId,
            teacherProfileId: candidate.teacherProfileId,
          },
        },
      ],
      violations,
      warnings: [],
    })
  },

  /**
   * Moving hours from whoever is over the line to whoever has room and the
   * competence. Only whole assignments move — half a group is not a thing a
   * timetable can express.
   */
  async rebalance_workload(context, input) {
    const profiles = await context.db.teacherProfile.findMany({
      where: { academicYearId: context.academicYearId },
      include: {
        user: { select: { firstName: true, lastName: true } },
        reductions: { select: { hours: true, status: true } },
        skills: { select: { subjectId: true } },
        assignments: {
          include: {
            group: {
              select: {
                id: true,
                code: true,
                subjectId: true,
                subject: { select: { code: true } },
              },
            },
          },
        },
      },
    })

    const loads = profiles.map((profile) => ({
      profile,
      load: computeTeacherLoad({
        contractedHours: Number(profile.contractedHours),
        reductions: profile.reductions.map((reduction) => ({
          hours: Number(reduction.hours),
          approved: reduction.status === 'approved',
        })),
        assignments: profile.assignments.map((assignment) => ({
          hours: Number(assignment.assignedHours),
          concept: assignment.concept,
        })),
      }),
    }))

    const wanted = new Set<string>(input.teacherProfileIds ?? [])
    const overloaded = loads
      .filter((entry) =>
        wanted.size > 0
          ? wanted.has(entry.profile.id)
          : entry.load.status === 'over' || entry.load.status === 'limit',
      )
      .sort((a, b) => (b.load.ratioPercent ?? 0) - (a.load.ratioPercent ?? 0))

    const changes: ProposalChange[] = []
    const warnings: AiProposal['warnings'] = []
    // Headroom is consumed as it is handed out: two moves must not both spend
    // the same free hours.
    const headroom = new Map(loads.map((entry) => [entry.profile.id, entry.load.remainingHours]))

    for (const source of overloaded) {
      let excess = source.load.assignedHours - source.load.capacityHours
      if (excess <= 0) continue

      const movable = [...source.profile.assignments]
        .filter((assignment) =>
          input.subjectId ? assignment.group.subjectId === input.subjectId : true,
        )
        .sort((a, b) => Number(b.assignedHours) - Number(a.assignedHours))

      for (const assignment of movable) {
        if (excess <= 0) break
        const hours = Number(assignment.assignedHours)

        const target = loads
          .filter((entry) => entry.profile.id !== source.profile.id)
          .filter((entry) =>
            entry.profile.skills.some((skill) => skill.subjectId === assignment.group.subjectId),
          )
          .filter((entry) => (headroom.get(entry.profile.id) ?? 0) >= hours)
          .sort((a, b) => (headroom.get(b.profile.id) ?? 0) - (headroom.get(a.profile.id) ?? 0))[0]

        if (!target) continue

        headroom.set(target.profile.id, (headroom.get(target.profile.id) ?? 0) - hours)
        excess -= hours

        changes.push({
          entity: 'assignment',
          entityId: assignment.id,
          label: `${assignment.group.subject.code} ${assignment.group.code} · ${hours} h`,
          before: {
            teacherProfileId: source.profile.id,
            teacherName: `${source.profile.user.firstName} ${source.profile.user.lastName}`,
            assignedHours: hours,
          },
          after: {
            teacherProfileId: target.profile.id,
            teacherName: `${target.profile.user.firstName} ${target.profile.user.lastName}`,
            assignedHours: hours,
          },
        })
      }

      if (excess > 0) {
        warnings.push({
          messageKey: 'assistant.warnings.stillOverloaded',
          params: {
            name: `${source.profile.user.firstName} ${source.profile.user.lastName}`,
            hours: Math.round(excess * 100) / 100,
          },
        })
      }
    }

    return minimizeForModel({
      tool: 'rebalance_workload',
      summary:
        changes.length === 0
          ? 'No assignment can move: nobody with the right competence has enough headroom.'
          : `${changes.length} assignment(s) would move between ${overloaded.length} overloaded teacher(s) and colleagues with capacity.`,
      changes,
      violations: [],
      warnings,
    })
  },

  /**
   * A draft, not a message. It is written for the reader in their own
   * language, and it is not sent until somebody confirms it.
   */
  async draft_announcement(context, input) {
    const subject = input.subjectId
      ? await context.db.subject.findFirst({
          where: { id: input.subjectId, academicYearId: context.academicYearId },
          select: { id: true, code: true, nameCa: true },
        })
      : null

    return {
      tool: 'draft_announcement',
      summary: `Draft announcement for ${
        input.audience === 'center' ? 'the center channel' : `subject ${subject?.code ?? '—'}`
      }.`,
      changes: [
        {
          entity: 'message',
          entityId: null,
          label: subject ? `${subject.code} · ${subject.nameCa}` : 'center',
          before: null,
          after: {
            audience: input.audience,
            subjectId: subject?.id ?? null,
            body: input.topic,
          },
        },
      ],
      violations: [],
      warnings: [],
    }
  },
}

/* ─────────────────── matching a document to this center ────────────────── */

interface ImportRow {
  date: string
  startTime: string
  endTime: string
  group: string
  subject?: string
  teacher?: string
  space?: string
  topic?: string
}

interface ImportDirectory {
  groups: { id: string; keys: string[] }[]
  teachers: { id: string; keys: string[] }[]
  spaces: { id: string; keys: string[] }[]
}

/**
 * The draft the classes would go into.
 *
 * Named explicitly, or the one that is editable. Importing into a published
 * timetable is not something to do by inference.
 */
async function targetVersion(context: AiContext, versionId?: string) {
  return context.db.scheduleVersion.findFirst({
    where: {
      academicYearId: context.academicYearId,
      ...(versionId ? { id: versionId } : { status: { in: ['draft', 'in_review'] } }),
    },
    orderBy: { createdAt: 'desc' },
  })
}

async function versionSessions(context: AiContext, versionId: string): Promise<PlannedSession[]> {
  const rows = await context.db.classSession.findMany({
    where: { scheduleVersionId: versionId },
    take: 1_000,
  })

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    teacherProfileId: row.teacherProfileId,
    spaceId: row.spaceId,
    weekday: row.weekday as Weekday,
    startTime: row.startTime as PlannedSession['startTime'],
    endTime: row.endTime as PlannedSession['endTime'],
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    recurrence: row.recurrence,
  }))
}

/**
 * Every way this center's own things might be written down.
 *
 * A document says "MAT101 T1", or "T1", or "Matemàtiques I – grup 1". Each of
 * those is offered as a key for the same group, so an exact match on any of
 * them is a match. Nothing fuzzy: a near miss is a question for the
 * coordinator, not a guess by the platform.
 */
async function importDirectory(context: AiContext): Promise<ImportDirectory> {
  const [groups, teachers, spaces] = await Promise.all([
    context.db.group.findMany({
      where: { subject: { academicYearId: context.academicYearId } },
      select: { id: true, code: true, subject: { select: { code: true, nameCa: true } } },
    }),
    context.db.teacherProfile.findMany({
      where: { academicYearId: context.academicYearId },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    }),
    context.db.space.findMany({ select: { id: true, name: true, building: true } }),
  ])

  return {
    groups: groups.map((group) => ({
      id: group.id,
      keys: [
        `${group.subject.code} ${group.code}`,
        `${group.subject.nameCa} ${group.code}`,
        group.code,
      ],
    })),
    teachers: teachers.map((teacher) => ({
      id: teacher.id,
      keys: [
        `${teacher.user.firstName} ${teacher.user.lastName}`,
        `${teacher.user.lastName} ${teacher.user.firstName}`,
        teacher.user.lastName,
      ],
    })),
    spaces: spaces.map((space) => ({
      id: space.id,
      // The building too, because a document often writes "A · Aula 1.1".
      keys: [space.name, space.building ? `${space.building} ${space.name}` : ''].filter(Boolean),
    })),
  }
}

function resolveRow(
  row: ImportRow,
  directory: ImportDirectory,
): { group: Match; teacher: Match; space: Match } {
  const qualified = row.subject ? match(directory.groups, `${row.subject} ${row.group}`) : NOTHING

  return {
    // "T1" on its own belongs to seven subjects; "MAT101 T1" belongs to one.
    // The qualified reading wins whenever it lands, and the bare one is only
    // consulted after, so a document that names the subject is never dragged
    // down to the ambiguity of one that does not.
    group: qualified.id ? qualified : match(directory.groups, row.group),
    teacher: row.teacher ? match(directory.teachers, row.teacher) : NOTHING,
    space: row.space ? match(directory.spaces, row.space) : NOTHING,
  }
}

/**
 * One candidate, or none.
 *
 * Compared with case, accents and punctuation folded away, because a document
 * writes "Aula 1.1" and the platform holds "AULA 1-1". Two candidates for the
 * same text is *not* a match: "T1" belonging to three subjects is exactly the
 * ambiguity the coordinator has to resolve, and picking one would be inventing
 * an answer to their question.
 */
/**
 * What one word of a document turned out to be.
 *
 * `ambiguous` is not a failure to match: it is a match to several things at
 * once, and it is a different question to ask. "We do not know who Marta is"
 * and "there are two Martas" send the coordinator looking in different places.
 */
interface Match {
  id: string | null
  ambiguous: boolean
}

const NOTHING: Match = { id: null, ambiguous: false }

/** The question this row raises, numbered so a person can find the row. */
function unmatchedRow(
  what: 'Group' | 'Teacher' | 'Space',
  index: number,
  value: string,
  result: Match,
): { messageKey: string; params: Record<string, string | number> } {
  const kind = result.ambiguous ? 'ambiguous' : 'unknown'
  return {
    messageKey: `assistant.import.${kind}${what}`,
    params: { row: index + 1, value },
  }
}

function match(candidates: { id: string; keys: string[] }[], value: string): Match {
  const wanted = fold(value)
  if (!wanted) return NOTHING

  const found = candidates.filter((candidate) => candidate.keys.some((key) => fold(key) === wanted))

  // Two candidates for the same text is not a match. Picking one would be
  // inventing an answer to the question the coordinator has to settle.
  if (found.length !== 1) return { id: null, ambiguous: found.length > 1 }
  return { id: (found[0] as { id: string }).id, ambiguous: false }
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
