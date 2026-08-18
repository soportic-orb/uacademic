/**
 * The configuration of a center, as a history rather than as a field.
 *
 * A timetable was generated under some set of rules. Six months later, when
 * somebody asks why last year's plan allowed 250 hours and this year's does
 * not, the answer has to exist — which it only does if every change to the
 * configuration left a version behind, with who approved it and which
 * document it came from.
 *
 * So nothing writes `centers.settings_json` directly any more. A change is a
 * new version; the column is the materialisation of the version currently in
 * force, kept in the same transaction so every reader stays fast.
 */
import type { PrismaClient } from '@uacademic/db'
import {
  type CenterSettings,
  type SettingProvenance,
  defaultCenterSettings,
  manuallyEditedKeys,
  parseCenterSettings,
} from '@uacademic/shared'

import { writeAuditLog } from '../../lib/audit.js'
import { toJson } from '../../lib/json.js'

export interface PublishInput {
  centerId: string
  settings: CenterSettings
  source: 'manual' | 'ai_extraction'
  sourceDocumentId?: string | null
  academicYearId?: string | null
  approvedBy?: string | null
  notes?: string | null
  /**
   * Where each parameter comes from. Carried forward from the previous
   * version for everything this change does not touch, so a citation survives
   * the next edit (that is the whole point of the chain).
   */
  provenance?: readonly SettingProvenance[]
  ip?: string | null
}

/**
 * The configuration in force. Resolved from the current version, falling back
 * to the column for a center that has never published one.
 */
export async function currentSettings(
  client: PrismaClient,
  centerId: string,
): Promise<CenterSettings> {
  const center = await client.center.findUnique({
    where: { id: centerId },
    select: {
      settingsJson: true,
      settingsVersionId: true,
    },
  })
  if (!center) return defaultCenterSettings

  if (center.settingsVersionId) {
    const version = await client.centerSettingsVersion.findUnique({
      where: { id: center.settingsVersionId },
      select: { settingsJson: true },
    })
    if (version) return parseCenterSettings(version.settingsJson)
  }

  return parseCenterSettings(center.settingsJson)
}

/** The version a center is currently running, when it has one. */
export async function currentVersionId(
  client: PrismaClient,
  centerId: string,
): Promise<string | null> {
  const center = await client.center.findUnique({
    where: { id: centerId },
    select: { settingsVersionId: true },
  })
  return center?.settingsVersionId ?? null
}

/**
 * Writes a new version and makes it the one in force.
 *
 * Provenance rows belong to the version, not to the center: that is what lets
 * "why 240?" be answered for the rules that were in force at the time, not
 * only for today's.
 */
export async function publishSettingsVersion(
  client: PrismaClient,
  input: PublishInput,
): Promise<{ versionId: string; settings: CenterSettings }> {
  const before = await currentSettings(client, input.centerId)
  const inherited = await inheritedProvenance(client, input.centerId)

  // A fresh citation replaces the inherited one for the same parameter.
  const merged = new Map<string, SettingProvenance>()
  for (const record of inherited) merged.set(record.paramKey, record)
  for (const record of input.provenance ?? []) merged.set(record.paramKey, record)

  const version = await client.centerSettingsVersion.create({
    data: {
      centerId: input.centerId,
      academicYearId: input.academicYearId ?? null,
      settingsJson: toJson(input.settings),
      source: input.source,
      sourceDocumentId: input.sourceDocumentId ?? null,
      approvedBy: input.approvedBy ?? null,
      notes: input.notes ?? null,
    },
  })

  if (merged.size > 0) {
    await client.settingProvenance.createMany({
      data: [...merged.values()].map((record) => ({
        centerId: input.centerId,
        paramKey: record.paramKey,
        settingsVersionId: version.id,
        documentId: record.documentId,
        page: record.page,
        section: record.section,
        quote: record.quote,
      })),
    })
  }

  await client.center.update({
    where: { id: input.centerId },
    data: { settingsJson: toJson(input.settings), settingsVersionId: version.id },
  })

  await writeAuditLog(client, {
    centerId: input.centerId,
    userId: input.approvedBy ?? null,
    entity: 'center_settings',
    entityId: version.id,
    action: 'publish',
    before: toJson(before),
    after: toJson(input.settings),
    // R4: a configuration written from an extraction is still a human's
    // decision — they confirmed it — but the origin is recorded either way.
    source: input.source === 'ai_extraction' ? 'ai' : 'user',
    ip: input.ip ?? null,
  })

  return { versionId: version.id, settings: input.settings }
}

/** The citations attached to the version currently in force. */
export async function inheritedProvenance(
  client: PrismaClient,
  centerId: string,
): Promise<SettingProvenance[]> {
  const versionId = await currentVersionId(client, centerId)
  if (!versionId) return []

  const rows = await client.settingProvenance.findMany({
    where: { settingsVersionId: versionId },
    orderBy: { paramKey: 'asc' },
  })

  return rows.map((row) => ({
    paramKey: row.paramKey,
    documentId: row.documentId,
    page: row.page,
    section: row.section,
    quote: row.quote,
  }))
}

/**
 * Parameters a person set by hand: they differ from the platform default and
 * no citation explains them. An extraction proposes changes to these; it does
 * not get to overwrite somebody's deliberate decision (rule 5).
 */
export async function manualParamKeys(client: PrismaClient, centerId: string): Promise<string[]> {
  const settings = await currentSettings(client, centerId)
  const cited = (await inheritedProvenance(client, centerId)).map((record) => record.paramKey)
  return manuallyEditedKeys(settings, defaultCenterSettings, cited)
}

export interface VersionSummary {
  id: string
  createdAt: string
  source: string
  documentTitle: string | null
  approver: string | null
  notes: string | null
  current: boolean
}

/** "Under which rules was last year's timetable generated?" */
export async function settingsHistory(
  client: PrismaClient,
  centerId: string,
): Promise<VersionSummary[]> {
  const current = await currentVersionId(client, centerId)

  const rows = await client.centerSettingsVersion.findMany({
    where: { centerId },
    include: {
      sourceDocument: { select: { title: true } },
      approver: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    source: row.source,
    documentTitle: row.sourceDocument?.title ?? null,
    approver: row.approver ? `${row.approver.firstName} ${row.approver.lastName}` : null,
    notes: row.notes,
    current: row.id === current,
  }))
}

export interface ParamProvenance {
  paramKey: string
  value: unknown
  documentId: string | null
  documentTitle: string | null
  page: number | null
  section: string | null
  quote: string | null
  /** The indexed fragment the quote lives in, so the viewer opens on it. */
  chunkId: string | null
}

/**
 * The reverse link. A constraint blocked somebody; this answers which article
 * of which document put that constraint there, precisely enough for the
 * viewer to open on the paragraph.
 */
export async function paramProvenance(
  client: PrismaClient,
  centerId: string,
  paramKey: string,
): Promise<ParamProvenance | null> {
  const versionId = await currentVersionId(client, centerId)

  const record = versionId
    ? await client.settingProvenance.findFirst({
        where: { settingsVersionId: versionId, paramKey },
        include: { document: { select: { id: true, title: true } } },
      })
    : null

  const settings = await currentSettings(client, centerId)
  const value = readPath(settings, paramKey)

  if (!record) {
    // No citation is an answer too: the parameter is the platform's default or
    // somebody's decision, and saying so beats implying a regulation said it.
    return {
      paramKey,
      value,
      documentId: null,
      documentTitle: null,
      page: null,
      section: null,
      quote: null,
      chunkId: null,
    }
  }

  const chunkId =
    record.document && record.quote
      ? await findChunk(client, record.document.id, record.quote, record.page)
      : null

  return {
    paramKey,
    value,
    documentId: record.document?.id ?? null,
    documentTitle: record.document?.title ?? null,
    page: record.page,
    section: record.section,
    quote: record.quote,
    chunkId,
  }
}

/** The indexed fragment that contains the quoted text, when there is one. */
async function findChunk(
  client: PrismaClient,
  documentId: string,
  quote: string,
  page: number | null,
): Promise<string | null> {
  const chunks = await client.documentChunk.findMany({
    where: { documentId, ...(page ? { pageFrom: { lte: page }, pageTo: { gte: page } } : {}) },
    select: { id: true, content: true },
    orderBy: { ordinal: 'asc' },
    take: 400,
  })

  const needle = normalize(quote)
  const hit = chunks.find((chunk) => normalize(chunk.content).includes(needle))
  return hit?.id ?? chunks[0]?.id ?? null
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function readPath(settings: CenterSettings, key: string): unknown {
  let cursor: unknown = settings
  for (const part of key.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}
