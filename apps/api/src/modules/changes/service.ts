/**
 * Class changes: the shared pieces the routes and the expiry job both need.
 *
 * The ladder itself lives in `@uacademic/shared` (R7). This file is what turns
 * a request row into the three things the ladder needs to judge it: who is
 * acting, what the change would do to the published week, and who has to be
 * told afterwards.
 */
import type { PrismaClient } from '@uacademic/db'
import {
  type ChangeActor,
  type ChangeProposal,
  type ChangeRequestStatus,
  type ChangeTransitionRules,
  type PlannedSession,
  type ProposedSession,
  type ScheduleContext,
  type Violation,
  type Weekday,
  applyProposal,
  evaluatePlacement,
  hasRole,
  swapSlots,
} from '@uacademic/shared'

import type { RequestUser } from '../../plugins/context.js'

export interface ChangeRow {
  id: string
  centerId: string
  requesterId: string
  targetUserId: string | null
  sessionId: string | null
  status: ChangeRequestStatus
  proposedJson: unknown
  expiresAt: Date | null
}

/**
 * Which parts the caller plays in *this* request — not their platform role.
 * More than one is normal: a coordinator who asks for a room change is both
 * the requester and the coordination the request passes through.
 */
export function actorsFor(user: RequestUser, request: ChangeRow): ChangeActor[] {
  const actors: ChangeActor[] = []
  if (user.userId === request.requesterId) actors.push('requester')
  if (request.targetUserId && user.userId === request.targetUserId) actors.push('target')
  if (hasRole(user, request.centerId, ['COORDINATOR', 'CENTER_ADMIN'])) actors.push('coordinator')
  return actors
}

/** The part to record as the author of a step, when several apply. */
export function primaryActor(actors: readonly ChangeActor[]): ChangeActor | null {
  return actors[0] ?? null
}

export function rulesFor(
  settings: { workflow: { coordinatorApprovesChanges: boolean } },
  request: ChangeRow,
): ChangeTransitionRules {
  return {
    coordinatorApproves: settings.workflow.coordinatorApprovesChanges,
    // Only a change that lands on somebody else's timetable needs their word.
    requiresTeacherAcceptance: Boolean(request.targetUserId),
  }
}

export function readProposal(value: unknown): ChangeProposal {
  return (value ?? {}) as ChangeProposal
}

export function toProposed(session: {
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
}): ProposedSession {
  return {
    id: session.id,
    groupId: session.groupId,
    teacherProfileId: session.teacherProfileId,
    spaceId: session.spaceId,
    weekday: session.weekday as Weekday,
    startTime: session.startTime,
    endTime: session.endTime,
    dateFrom: session.dateFrom,
    dateTo: session.dateTo,
    recurrence: session.recurrence as ProposedSession['recurrence'],
  }
}

export interface ChangeEffect {
  /** The sessions as they would be, keyed by id. */
  sessions: ProposedSession[]
  violations: Violation[]
}

/**
 * What the change would do to the published week, judged by the planner's own
 * engine. Running it on every transition — not only when applying — is what
 * lets a coordinator see, before approving, that the room was taken yesterday.
 */
export async function evaluateChange(
  client: PrismaClient,
  request: ChangeRow,
  context: ScheduleContext,
): Promise<ChangeEffect> {
  if (!request.sessionId) return { sessions: [], violations: [] }

  const session = await client.classSession.findUnique({ where: { id: request.sessionId } })
  if (!session) return { sessions: [], violations: [] }

  const week = await client.classSession.findMany({
    where: { scheduleVersionId: session.scheduleVersionId },
  })

  const proposal = readProposal(request.proposedJson)
  const current = toProposed(session)

  let updated: ProposedSession[]
  if (proposal.swapWithSessionId) {
    const partner = week.find((entry) => entry.id === proposal.swapWithSessionId)
    if (!partner) return { sessions: [], violations: [] }
    const [first, second] = swapSlots(current, toProposed(partner))
    updated = [first, second]
  } else {
    updated = [applyProposal(current, proposal)]
  }

  const touched = new Set(updated.map((entry) => entry.id))
  const others: PlannedSession[] = week.filter((entry) => !touched.has(entry.id)).map(toProposed)

  const violations = updated.flatMap((entry) =>
    evaluatePlacement(
      entry,
      [...others, ...updated.filter((other) => other.id !== entry.id)],
      context,
    ),
  )

  return { sessions: updated, violations }
}

/** Writes an accepted change into the timetable, and returns what it moved. */
export async function applyChange(
  client: PrismaClient,
  effect: ChangeEffect,
): Promise<{ before: unknown; after: unknown }> {
  const before: unknown[] = []

  for (const session of effect.sessions) {
    const current = await client.classSession.findUnique({ where: { id: session.id } })
    if (!current) continue

    before.push({
      id: current.id,
      weekday: current.weekday,
      startTime: current.startTime,
      endTime: current.endTime,
      teacherProfileId: current.teacherProfileId,
      spaceId: current.spaceId,
    })

    await client.classSession.update({
      where: { id: session.id },
      data: {
        weekday: session.weekday,
        startTime: session.startTime,
        endTime: session.endTime,
        teacherProfileId: session.teacherProfileId,
        spaceId: session.spaceId,
      },
    })
  }

  return {
    before,
    after: effect.sessions.map((session) => ({
      id: session.id,
      weekday: session.weekday,
      startTime: session.startTime,
      endTime: session.endTime,
      teacherProfileId: session.teacherProfileId,
      spaceId: session.spaceId,
    })),
  }
}

/**
 * The published version keeps a snapshot of what people were told; a change
 * applied afterwards has to be reflected there too, or the comparator and the
 * ICS feed would keep serving the old Tuesday.
 */
export async function refreshSnapshot(
  client: PrismaClient,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return

  const sessions = await client.classSession.findMany({
    where: { id: { in: [...sessionIds] } },
    include: { space: { select: { name: true } } },
  })
  const versionIds = [...new Set(sessions.map((session) => session.scheduleVersionId))]

  for (const versionId of versionIds) {
    const version = await client.scheduleVersion.findUnique({ where: { id: versionId } })
    if (!version || !Array.isArray(version.snapshotJson)) continue

    const snapshot = version.snapshotJson as Record<string, unknown>[]
    const updated = snapshot.map((entry) => {
      const session = sessions.find((row) => row.id === entry.id)
      if (!session) return entry
      return {
        ...entry,
        weekday: session.weekday,
        startTime: session.startTime,
        endTime: session.endTime,
        teacherProfileId: session.teacherProfileId,
        spaceId: session.spaceId,
        spaceName: session.space?.name ?? null,
      }
    })

    await client.scheduleVersion.update({
      where: { id: versionId },
      data: { snapshotJson: updated as never },
    })
  }
}

/** Everyone the ladder says should hear about a step, as user ids. */
export async function recipientsFor(
  client: PrismaClient,
  request: ChangeRow,
  audience: readonly ChangeActor[],
): Promise<string[]> {
  const ids = new Set<string>()

  for (const actor of audience) {
    if (actor === 'requester') ids.add(request.requesterId)
    if (actor === 'target' && request.targetUserId) ids.add(request.targetUserId)
    if (actor === 'coordinator') {
      const coordinators = await client.userCenterRole.findMany({
        where: { centerId: request.centerId, role: 'COORDINATOR' },
        select: { userId: true },
      })
      for (const coordinator of coordinators) ids.add(coordinator.userId)
    }
  }

  return [...ids]
}
