/**
 * Applying a proposal, after a person said yes.
 *
 * This is the only place in the assistant that writes, and it runs exactly
 * once per proposal: the row moves from `pending` to `confirmed` in the same
 * breath, so a double-click cannot apply a change twice. Every write it makes
 * is audited with `source = 'ai'` (R4), which is what makes "who moved this
 * class?" answerable a year later.
 *
 * The change is re-checked against the constraint engine first. A proposal is
 * a photograph of a moment; by the time somebody confirms it the timetable may
 * have moved underneath it, and applying it blindly is how a conflict gets
 * written into a published week.
 */
import {
  type AiProposal,
  type PlannedSession,
  type ScheduleVersionStatus,
  type Weekday,
  evaluatePlacement,
  isConfirmable,
  isEditable,
} from '@uacademic/shared'

import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { toJson } from '../../lib/json.js'
import { prisma } from '../../lib/prisma.js'
import type { AiContext } from './context.js'

export interface ExecutionResult {
  applied: number
  entity: string
}

interface ProposalRow {
  id: string
  centerId: string
  conversationId: string
  userId: string
  tool: string
  inputJson: unknown
  previewJson: unknown
  status: string
}

export async function executeProposal(
  context: AiContext,
  row: ProposalRow,
  options: { ip?: string | null } = {},
): Promise<ExecutionResult> {
  const proposal = row.previewJson as unknown as AiProposal

  if (!isConfirmable(proposal)) {
    throw new AppError(409, 'CONFLICT', 'assistant.errors.notConfirmable')
  }

  const result =
    row.tool === 'move_session' || row.tool === 'propose_schedule' || row.tool === 'import_schedule'
      ? await applySessionChanges(context, proposal, options.ip ?? null)
      : row.tool === 'assign_teacher_to_group' || row.tool === 'rebalance_workload'
        ? await applyAssignments(context, proposal, options.ip ?? null)
        : row.tool === 'draft_announcement'
          ? await applyAnnouncement(context, proposal, options.ip ?? null)
          : { applied: 0, entity: 'unknown' }

  await prisma().aiInteraction.updateMany({
    where: { centerId: context.centerId, userId: row.userId },
    data: { actionExecuted: true },
  })

  return result
}

/** Moves classes, after asking the engine again whether they may move. */
async function applySessionChanges(
  context: AiContext,
  proposal: AiProposal,
  ip: string | null,
): Promise<ExecutionResult> {
  const changes = proposal.changes.filter((change) => change.entity === 'class_session')
  if (changes.length === 0) return { applied: 0, entity: 'class_session' }

  const published = await context.db.classSession.findMany({
    where: { scheduleVersion: { status: 'published' } },
  })

  const planned: PlannedSession[] = published.map((row) => ({
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

  let applied = 0

  for (const change of changes) {
    if (!change.after) continue

    /*
      No id means this class does not exist yet — an import read out of a
      document. It is created rather than moved, into the draft the proposal
      named, and audited as the assistant's like everything else here.
    */
    if (!change.entityId) {
      applied += await createFromImport(
        context,
        change.after as Record<string, unknown>,
        ip ?? undefined,
      )
      continue
    }

    const current = published.find((row) => row.id === change.entityId)
    if (!current) continue

    const after = change.after as {
      weekday?: number
      startTime?: string
      endTime?: string
      spaceId?: string | null
      teacherProfileId?: string | null
    }

    /*
      A class is placed on a date, so moving it to another weekday moves its
      date with it — inside the same week, which is what "move it to Thursday"
      means. Leaving the date behind would put the weekday and the day it
      happens on out of step, and the class would quietly slide days.
    */
    const weekday = (after.weekday ?? current.weekday) as Weekday
    const moved = shiftToWeekday(current.dateFrom, current.weekday, weekday)

    const candidate: PlannedSession = {
      id: current.id,
      groupId: current.groupId,
      teacherProfileId: after.teacherProfileId ?? current.teacherProfileId,
      spaceId: after.spaceId ?? current.spaceId,
      weekday,
      startTime: (after.startTime ?? current.startTime) as PlannedSession['startTime'],
      endTime: (after.endTime ?? current.endTime) as PlannedSession['endTime'],
      dateFrom: moved,
      dateTo: current.recurrence === 'once' ? moved : current.dateTo,
      recurrence: current.recurrence,
    }

    // The world may have moved since the proposal was written.
    const violations = evaluatePlacement(
      candidate,
      planned.filter((session) => session.id !== candidate.id),
      context.schedule,
    )
    if (violations.length > 0) {
      throw new AppError(409, 'CONFLICT', 'assistant.errors.staleProposal')
    }

    await context.db.classSession.update({
      where: { id: current.id },
      data: {
        weekday: candidate.weekday,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        spaceId: candidate.spaceId,
        teacherProfileId: candidate.teacherProfileId,
        dateFrom: candidate.dateFrom,
        dateTo: candidate.dateTo,
      },
    })

    await writeAuditLog(prisma(), {
      centerId: context.centerId,
      userId: context.userId,
      entity: 'class_session',
      entityId: current.id,
      action: 'update',
      before: {
        weekday: current.weekday,
        startTime: current.startTime,
        endTime: current.endTime,
        spaceId: current.spaceId,
        teacherProfileId: current.teacherProfileId,
      },
      after: change.after,
      // R4: this was the assistant's idea, and the record says so.
      source: 'ai',
      ip,
    })

    applied += 1
  }

  return { applied, entity: 'class_session' }
}

async function applyAssignments(
  context: AiContext,
  proposal: AiProposal,
  ip: string | null,
): Promise<ExecutionResult> {
  const changes = proposal.changes.filter((change) => change.entity === 'assignment')
  let applied = 0

  for (const change of changes) {
    const after = change.after as {
      groupId?: string
      teacherProfileId?: string
      assignedHours?: number
      concept?: string
    } | null
    if (!after?.teacherProfileId) continue

    if (change.entityId) {
      const current = await context.db.assignment.findFirst({ where: { id: change.entityId } })
      if (!current) continue

      await context.db.assignment.update({
        where: { id: current.id },
        data: { teacherProfileId: after.teacherProfileId },
      })

      await writeAuditLog(prisma(), {
        centerId: context.centerId,
        userId: context.userId,
        entity: 'assignment',
        entityId: current.id,
        action: 'reassign',
        before: { teacherProfileId: current.teacherProfileId },
        after: { teacherProfileId: after.teacherProfileId },
        source: 'ai',
        ip,
      })

      applied += 1
      continue
    }

    if (!after.groupId) continue

    const created = await context.db.assignment.create({
      data: {
        centerId: context.centerId,
        academicYearId: context.academicYearId,
        groupId: after.groupId,
        teacherProfileId: after.teacherProfileId,
        assignedHours: after.assignedHours ?? 0,
        concept: (after.concept as 'lecture') ?? 'lecture',
      },
    })

    await writeAuditLog(prisma(), {
      centerId: context.centerId,
      userId: context.userId,
      entity: 'assignment',
      entityId: created.id,
      action: 'create',
      before: null,
      after,
      source: 'ai',
      ip,
    })

    applied += 1
  }

  return { applied, entity: 'assignment' }
}

/** The draft becomes a real message, in the channel it was written for. */
async function applyAnnouncement(
  context: AiContext,
  proposal: AiProposal,
  ip: string | null,
): Promise<ExecutionResult> {
  const change = proposal.changes.find((entry) => entry.entity === 'message')
  const after = change?.after as { audience?: string; subjectId?: string | null; body?: string }
  if (!after?.body) return { applied: 0, entity: 'message' }

  const conversation =
    after.audience === 'center'
      ? await context.db.conversation.findFirst({
          where: { centerId: context.centerId, type: 'announcement' },
        })
      : await context.db.conversation.findFirst({
          where: { centerId: context.centerId, type: 'subject', subjectId: after.subjectId },
        })

  if (!conversation) throw new AppError(409, 'CONFLICT', 'assistant.errors.noChannel')

  const message = await context.db.message.create({
    data: {
      centerId: context.centerId,
      conversationId: conversation.id,
      senderId: context.userId,
      body: after.body,
    },
  })

  await writeAuditLog(prisma(), {
    centerId: context.centerId,
    userId: context.userId,
    entity: 'message',
    entityId: message.id,
    action: 'create',
    before: null,
    after: { conversationId: conversation.id, body: after.body.slice(0, 500) },
    source: 'ai',
    ip,
  })

  return { applied: 1, entity: 'message' }
}

export function proposalPreview(row: { previewJson: unknown }): AiProposal {
  return row.previewJson as unknown as AiProposal
}

export function toStoredJson(value: unknown) {
  return toJson(value)
}

/**
 * The same week, another day.
 *
 * A one-off class carries the date it happens on, and its weekday has to keep
 * agreeing with that date. Moving it two days later is moving the date two
 * days later, not relabelling it.
 */
function shiftToWeekday(from: Date, fromWeekday: number, toWeekday: number): Date {
  if (fromWeekday === toWeekday) return from

  const moved = new Date(from)
  moved.setUTCDate(moved.getUTCDate() + (toWeekday - fromWeekday))
  return moved
}

/**
 * One class, created from a confirmed import.
 *
 * Everything was resolved to an identifier when the proposal was built, and
 * it is checked again here: the draft must still be editable and the group,
 * the teacher and the room must still belong to this center. A proposal is
 * allowed to be a day old, and the world moves.
 */
async function createFromImport(
  context: AiContext,
  after: Record<string, unknown>,
  ip?: string,
): Promise<number> {
  const versionId = String(after.versionId ?? '')
  const groupId = String(after.groupId ?? '')
  const date = String(after.date ?? '')

  if (!versionId || !groupId || !date) return 0

  const version = await context.db.scheduleVersion.findFirst({
    where: { id: versionId, academicYearId: context.academicYearId },
  })
  if (!version || !isEditable(version.status as ScheduleVersionStatus)) {
    throw new AppError(409, 'CONFLICT', 'planner.version.errors.notEditable')
  }

  const day = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(day.getTime())) return 0

  const created = await context.db.classSession.create({
    data: {
      centerId: context.centerId,
      scheduleVersionId: version.id,
      groupId,
      teacherProfileId: (after.teacherProfileId as string | null) ?? null,
      spaceId: (after.spaceId as string | null) ?? null,
      weekday: day.getUTCDay() === 0 ? 7 : day.getUTCDay(),
      startTime: String(after.startTime ?? ''),
      endTime: String(after.endTime ?? ''),
      // Placed on its day and never repeated, like every other class.
      dateFrom: day,
      dateTo: day,
      recurrence: 'once',
      topic: (after.topic as string | undefined) ?? null,
    },
  })

  await writeAuditLog(prisma(), {
    centerId: context.centerId,
    userId: context.userId,
    entity: 'class_session',
    entityId: created.id,
    action: 'create',
    before: null,
    after,
    // R4: read out of a document by the assistant, confirmed by a person.
    source: 'ai',
    ip,
  })

  return 1
}
