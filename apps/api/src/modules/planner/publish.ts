/**
 * Publishing a version.
 *
 * Three things happen, in this order and only here:
 *
 *   1. the sessions are frozen into a snapshot, so what people were told stays
 *      readable even if a row is edited later;
 *   2. the diff against the previously published version is computed;
 *   3. each affected teacher is notified — only about their own changes.
 *
 * Nothing above happens for a draft. That is the whole point of the workflow:
 * a coordinator can move sessions around all week without anyone's phone
 * buzzing.
 */
import {
  type ScheduleDiff,
  type SessionSnapshot,
  diffSchedules,
  parseCenterSettings,
  translate,
} from '@uacademic/shared'
import type { PrismaClient } from '@uacademic/db'

import { writeAuditLog } from '../../lib/audit.js'
import { toJson } from '../../lib/json.js'
import { type RealtimeTransport, userChannel } from '../../lib/realtime.js'
import {
  clearTombstones,
  recordTombstones,
  tombstonesFromDiff,
} from '../../services/calendar/tombstones.js'
import { enqueueCalendarSync } from '../../services/calendar/sync.js'

export interface PublishInput {
  client: PrismaClient
  centerId: string
  academicYearId: string
  versionId: string
  versionName: string
  sessions: SessionSnapshot[]
  userId: string
  bus: RealtimeTransport
  ip?: string | null
}

export interface PublishResult {
  diff: ScheduleDiff
  notified: number
  previousVersionId: string | null
}

export function readSnapshot(value: unknown): SessionSnapshot[] {
  if (!Array.isArray(value)) return []
  return value as SessionSnapshot[]
}

/**
 * The published version to compare against: the one that was live until now.
 * Its snapshot is the truth, not its current rows.
 */
async function previousPublished(
  client: PrismaClient,
  centerId: string,
  academicYearId: string,
  versionId: string,
) {
  return client.scheduleVersion.findFirst({
    where: {
      centerId,
      academicYearId,
      status: 'published',
      NOT: { id: versionId },
    },
    orderBy: { publishedAt: 'desc' },
  })
}

export async function publishVersion(input: PublishInput): Promise<PublishResult> {
  const previous = await previousPublished(
    input.client,
    input.centerId,
    input.academicYearId,
    input.versionId,
  )

  const diff = diffSchedules(readSnapshot(previous?.snapshotJson), input.sessions)

  await input.client.scheduleVersion.update({
    where: { id: input.versionId },
    data: {
      status: 'published',
      publishedAt: new Date(),
      publishedBy: input.userId,
      snapshotJson: toJson(input.sessions),
      ...(previous ? { parentVersionId: previous.id } : {}),
    },
  })

  // The version that was live becomes history, never editable again.
  if (previous) {
    await input.client.scheduleVersion.update({
      where: { id: previous.id },
      data: { status: 'archived' },
    })
  }

  const notified = await notifyTeachers(input, diff)
  await propagateToCalendars(input, diff)

  await writeAuditLog(input.client, {
    centerId: input.centerId,
    userId: input.userId,
    entity: 'schedule_version',
    entityId: input.versionId,
    action: 'publish',
    before: previous
      ? { versionId: previous.id, sessions: readSnapshot(previous.snapshotJson).length }
      : null,
    after: {
      sessions: input.sessions.length,
      changes: diff.summary,
      notifiedTeachers: notified,
    },
    source: 'user',
    ip: input.ip ?? null,
  })

  return { diff, notified, previousVersionId: previous?.id ?? null }
}

/**
 * The same publication, seen from outside UAcademic.
 *
 * A class that disappeared from somebody's week has to be *announced* as
 * cancelled — a subscription cannot guess — and every connected provider
 * calendar is brought back in line through the queue, one job per person.
 */
async function propagateToCalendars(input: PublishInput, diff: ScheduleDiff): Promise<void> {
  const center = await input.client.center.findUnique({ where: { id: input.centerId } })
  const settings = parseCenterSettings(center?.settingsJson).calendar

  const tombstones = await tombstonesFromDiff(input.client, input.centerId, diff)
  await recordTombstones(input.client, tombstones, settings.tombstoneDays)

  const profileIds = [
    ...new Set(
      [
        ...diff.byTeacher.map((entry) => entry.teacherProfileId),
        // Everyone giving each class, not only the first of them: a second
        // lecturer's calendar is as wrong as anybody else's until it is synced.
        ...input.sessions.flatMap((session) =>
          session.teachers
            ? session.teachers.map((person) => person.teacherProfileId)
            : [session.teacherProfileId],
        ),
      ].filter((id): id is string => Boolean(id)),
    ),
  ]
  const profiles = await input.client.teacherProfile.findMany({
    where: { id: { in: profileIds } },
    select: { id: true, userId: true },
  })

  // A class that is live again for the person who teaches it is no longer
  // cancelled *for them* — while it may still be cancelled for whoever lost it.
  await clearTombstones(
    input.client,
    input.sessions.flatMap((session) => {
      const ids = session.teachers
        ? session.teachers.map((person) => person.teacherProfileId)
        : [session.teacherProfileId]
      return profiles
        .filter((row) => ids.includes(row.id))
        .map((profile) => ({ userId: profile.userId, sessionId: session.id }))
    }),
  )

  await enqueueCalendarSync(
    input.client,
    [...profiles.map((profile) => profile.userId), ...tombstones.map((entry) => entry.userId)],
    { reason: 'publish' },
  )
}

/**
 * One notification per affected teacher, carrying their own changes. A teacher
 * whose week did not move hears nothing at all — which is what makes the ones
 * they do receive worth reading.
 */
async function notifyTeachers(input: PublishInput, diff: ScheduleDiff): Promise<number> {
  if (diff.byTeacher.length === 0) return 0

  const profiles = await input.client.teacherProfile.findMany({
    where: { id: { in: diff.byTeacher.map((entry) => entry.teacherProfileId) } },
    select: { id: true, userId: true, user: { select: { locale: true } } },
  })

  let notified = 0

  for (const entry of diff.byTeacher) {
    const profile = profiles.find((row) => row.id === entry.teacherProfileId)
    if (!profile) continue

    const locale = profile.user.locale
    const payload = {
      scheduleVersionId: input.versionId,
      versionName: input.versionName,
      title: translate(locale, 'push.scheduleChangedTitle'),
      body: translate(locale, 'push.scheduleChangedBody', {
        count: entry.changes.length,
        version: input.versionName,
      }),
      changes: entry.changes.map((change) => ({
        kind: change.kind,
        fields: change.fields,
        messageKey: change.messageKey,
        params: change.params,
      })),
    }

    await input.client.notification.create({
      data: {
        centerId: input.centerId,
        userId: profile.userId,
        type: 'schedule.published',
        payloadJson: toJson(payload),
      },
    })

    // Delivery beyond the in-app bell is queued: email and push are the job
    // worker's business, not an HTTP request's.
    await input.client.job.create({
      data: {
        type: 'notification.deliver',
        payloadJson: toJson({
          userId: profile.userId,
          centerId: input.centerId,
          type: 'schedule.published',
          locale,
          subject: translate(locale, 'email.scheduleChangedSubject'),
          body: translate(locale, 'email.scheduleChangedBody', {
            count: entry.changes.length,
            version: input.versionName,
          }),
        }),
      },
    })

    input.bus.publish(userChannel(profile.userId), 'schedule.published', payload)
    notified += 1
  }

  return notified
}
