/**
 * Cancellations, kept just long enough to be delivered.
 *
 * An ICS subscription is a one-way copy: the client keeps whatever it was last
 * told about. Dropping a VEVENT for a class that no longer exists therefore
 * does *not* remove it from anybody's calendar — the class simply stays there
 * forever. The only way to take it back is to keep publishing it, marked
 * `STATUS:CANCELLED`, until every client has had the chance to read it.
 *
 * That is what a tombstone is, and why it has an expiry rather than living
 * forever: after `calendar.tombstoneDays` even Google has re-read the feed.
 */
import {
  type ScheduleDiff,
  type SessionSnapshot,
  parseCenterSettings,
  renderTemplate,
} from '@uacademic/shared'

import { toJson } from '../../lib/json.js'
import type { PrismaClient } from '../../lib/prisma.js'
import type { TombstonePayload } from './drafts.js'

export interface TombstoneInput {
  centerId: string
  userId: string
  sessionId: string
  payload: TombstonePayload
  reason: string
}

export async function recordTombstones(
  client: PrismaClient,
  entries: readonly TombstoneInput[],
  days: number,
): Promise<number> {
  if (entries.length === 0) return 0
  const expiresAt = new Date(Date.now() + days * 86_400_000)

  for (const entry of entries) {
    await client.calendarTombstone.upsert({
      where: { userId_sessionId: { userId: entry.userId, sessionId: entry.sessionId } },
      create: {
        centerId: entry.centerId,
        userId: entry.userId,
        sessionId: entry.sessionId,
        payloadJson: toJson(entry.payload),
        reason: entry.reason,
        expiresAt,
      },
      // Re-cancelling refreshes the clock and the sequence: a client that
      // missed the first announcement still gets one.
      update: {
        payloadJson: toJson(entry.payload),
        reason: entry.reason,
        cancelledAt: new Date(),
        expiresAt,
      },
    })
  }

  return entries.length
}

/**
 * A class that is somebody's again has nothing to announce to *them*.
 *
 * Scoped to the pair on purpose: the same session can be live for its new
 * teacher and cancelled for the previous one at the very same moment, and
 * clearing by session id alone would silently swallow that cancellation.
 */
export async function clearTombstones(
  client: PrismaClient,
  pairs: readonly { userId: string; sessionId: string }[],
): Promise<number> {
  let cleared = 0

  for (const pair of pairs) {
    const result = await client.calendarTombstone.deleteMany({
      where: { userId: pair.userId, sessionId: pair.sessionId },
    })
    cleared += result.count
  }

  return cleared
}

/**
 * The cancellation one teacher has to hear about for one class — a
 * substitution accepted, a session withdrawn — built from the row as it
 * currently stands.
 */
export async function tombstoneForSession(
  client: PrismaClient,
  input: { centerId: string; sessionId: string; userId: string; reason: string },
): Promise<TombstoneInput | null> {
  const session = await client.classSession.findUnique({
    where: { id: input.sessionId },
    include: {
      group: { select: { code: true, subject: { select: { code: true, nameCa: true } } } },
      space: { select: { name: true } },
    },
  })
  if (!session) return null

  const center = await client.center.findUnique({ where: { id: input.centerId } })
  const settings = parseCenterSettings(center?.settingsJson).calendar

  return {
    centerId: input.centerId,
    userId: input.userId,
    sessionId: session.id,
    reason: input.reason,
    payload: {
      summary: renderTemplate(settings.summaryTemplate, {
        subjectCode: session.group.subject.code,
        subjectName: session.group.subject.nameCa,
        groupCode: session.group.code,
        spaceName: session.space?.name ?? '',
        centerName: center?.name ?? '',
      }),
      ...(session.space?.name ? { location: session.space.name } : {}),
      weekday: session.weekday,
      startTime: session.startTime,
      endTime: session.endTime,
      dateFrom: session.dateFrom.toISOString().slice(0, 10),
      dateTo: session.dateTo.toISOString().slice(0, 10),
      recurrence: session.recurrence,
    },
  }
}

export async function purgeExpiredTombstones(client: PrismaClient): Promise<number> {
  const result = await client.calendarTombstone.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}

/**
 * Who lost which class in this publication.
 *
 * Two cases produce a cancellation: a session that is gone, and a session that
 * now belongs to somebody else — from the previous teacher's calendar those
 * are the same event, and both have to be withdrawn.
 */
export async function tombstonesFromDiff(
  client: PrismaClient,
  centerId: string,
  diff: ScheduleDiff,
): Promise<TombstoneInput[]> {
  const losses: { snapshot: SessionSnapshot; teacherProfileId: string; reason: string }[] = []

  for (const change of diff.changes) {
    const before = change.before
    if (!before?.teacherProfileId) continue

    if (change.kind === 'removed') {
      losses.push({
        snapshot: before,
        teacherProfileId: before.teacherProfileId,
        reason: 'removed',
      })
      continue
    }

    if (
      change.kind === 'changed' &&
      change.fields.includes('teacher') &&
      change.after?.teacherProfileId !== before.teacherProfileId
    ) {
      losses.push({
        snapshot: before,
        teacherProfileId: before.teacherProfileId,
        reason: 'reassigned',
      })
    }
  }

  if (losses.length === 0) return []

  const [profiles, center, sessions] = await Promise.all([
    client.teacherProfile.findMany({
      where: { id: { in: losses.map((loss) => loss.teacherProfileId) } },
      select: { id: true, userId: true },
    }),
    client.center.findUnique({ where: { id: centerId } }),
    client.classSession.findMany({
      where: { id: { in: losses.map((loss) => loss.snapshot.id) } },
      select: { id: true, dateFrom: true, dateTo: true },
    }),
  ])

  const settings = parseCenterSettings(center?.settingsJson).calendar
  const entries: TombstoneInput[] = []

  for (const loss of losses) {
    const profile = profiles.find((row) => row.id === loss.teacherProfileId)
    if (!profile) continue

    const dates = sessions.find((row) => row.id === loss.snapshot.id)
    const fallbackFrom = new Date()
    const fallbackTo = new Date(Date.now() + 120 * 86_400_000)

    entries.push({
      centerId,
      userId: profile.userId,
      sessionId: loss.snapshot.id,
      reason: loss.reason,
      payload: {
        summary: renderTemplate(settings.summaryTemplate, {
          subjectCode: loss.snapshot.subjectCode,
          subjectName: loss.snapshot.subjectName,
          groupCode: loss.snapshot.groupCode,
          spaceName: loss.snapshot.spaceName ?? '',
          teacherName: loss.snapshot.teacherName ?? '',
          centerName: center?.name ?? '',
        }),
        ...(loss.snapshot.spaceName ? { location: loss.snapshot.spaceName } : {}),
        weekday: loss.snapshot.weekday,
        startTime: loss.snapshot.startTime,
        endTime: loss.snapshot.endTime,
        dateFrom: (dates?.dateFrom ?? fallbackFrom).toISOString().slice(0, 10),
        dateTo: (dates?.dateTo ?? fallbackTo).toISOString().slice(0, 10),
        recurrence: loss.snapshot.recurrence,
      },
    })
  }

  return entries
}
