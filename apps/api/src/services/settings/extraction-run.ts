/**
 * One reading of one regulation, from the job queue to a list somebody can
 * say yes to.
 *
 * A run holds eight blocks. Each is a job of its own, so a block that fails —
 * the model returned nothing usable, the API was down — is retried on its own
 * and the other seven stand. Nothing here writes configuration: a run produces
 * proposals, and proposals wait for a person (R5).
 */
import type { PrismaClient } from '@uacademic/db'
import {
  EXTRACTION_BLOCKS,
  type ExtractionBlock,
  type ExtractionProposal,
  type Resolution,
  applyResolutions,
} from '@uacademic/shared'

import { enqueueJob } from '../../jobs/worker.js'
import { writeAuditLog } from '../../lib/audit.js'
import { toJson } from '../../lib/json.js'
import { extractBlock, documentText } from '../../modules/ai/extraction.js'
import { recordInteraction } from '../../modules/ai/service.js'
import { currentSettings, manualParamKeys, publishSettingsVersion } from './versions.js'

export type BlockState = 'pending' | 'running' | 'ready' | 'failed'

export interface BlockStatus {
  state: BlockState
  /** Why it failed, as a key the interface can translate. */
  errorKey?: string
  proposals?: number
  updatedAt?: string
}

export type BlockStatuses = Record<ExtractionBlock, BlockStatus>

function initialBlocks(): BlockStatuses {
  return Object.fromEntries(
    EXTRACTION_BLOCKS.map((block) => [block, { state: 'pending' as const }]),
  ) as BlockStatuses
}

function readBlocks(value: unknown): BlockStatuses {
  const stored = (value ?? {}) as Partial<BlockStatuses>
  return Object.fromEntries(
    EXTRACTION_BLOCKS.map((block) => [block, stored[block] ?? { state: 'pending' as const }]),
  ) as BlockStatuses
}

/** Queues one job per block. The document is read eight times, cached once. */
export async function startRun(
  client: PrismaClient,
  input: { centerId: string; documentId: string; requestedBy: string; ip?: string | null },
): Promise<{ runId: string }> {
  const run = await client.settingExtractionRun.create({
    data: {
      centerId: input.centerId,
      documentId: input.documentId,
      requestedBy: input.requestedBy,
      blocksJson: toJson(initialBlocks()),
    },
  })

  for (const block of EXTRACTION_BLOCKS) {
    await enqueueJob(client, 'settings.extract', { runId: run.id, block }, { maxAttempts: 3 })
  }

  await writeAuditLog(client, {
    centerId: input.centerId,
    userId: input.requestedBy,
    entity: 'setting_extraction_run',
    entityId: run.id,
    action: 'start',
    before: null,
    after: { documentId: input.documentId, blocks: EXTRACTION_BLOCKS.length },
    source: 'user',
    ip: input.ip ?? null,
  })

  return { runId: run.id }
}

async function setBlock(
  client: PrismaClient,
  runId: string,
  block: ExtractionBlock,
  status: BlockStatus,
): Promise<void> {
  const run = await client.settingExtractionRun.findUnique({
    where: { id: runId },
    select: { blocksJson: true },
  })
  const blocks = readBlocks(run?.blocksJson)
  blocks[block] = { ...status, updatedAt: new Date().toISOString() }

  await client.settingExtractionRun.update({
    where: { id: runId },
    data: { blocksJson: toJson(blocks) },
  })
}

/**
 * Runs one block and stores what survived validation.
 *
 * The parameters the document does not answer are stored too, as `not_found`
 * rows: they keep their default and end up on the "still to configure by
 * hand" list, which is the honest outcome and the one worth showing.
 */
export async function runExtractionBlock(
  client: PrismaClient,
  runId: string,
  block: ExtractionBlock,
): Promise<{ proposals: number; notFound: number; discarded: number }> {
  const run = await client.settingExtractionRun.findUnique({
    where: { id: runId },
    include: { document: { select: { id: true, centerId: true } } },
  })
  if (!run) throw new Error(`extraction run ${runId} not found`)

  await setBlock(client, runId, block, { state: 'running' })

  try {
    const source = await documentText(client, run.documentId)
    if (!source || source.text.trim().length === 0) {
      await setBlock(client, runId, block, {
        state: 'failed',
        errorKey: 'settings.extraction.errors.documentNotIndexed',
      })
      return { proposals: 0, notFound: 0, discarded: 0 }
    }

    const current = await currentSettings(client, run.centerId)
    const manualKeys = await manualParamKeys(client, run.centerId)

    const result = await extractBlock({
      block,
      documentId: run.documentId,
      documentTitle: source.title,
      documentText: source.text,
      current,
      manualKeys,
    })

    // A block is re-runnable: its previous rows go, its resolutions with them.
    await client.settingExtraction.deleteMany({ where: { runId, block } })

    for (const proposal of result.proposals) {
      await client.settingExtraction.create({
        data: {
          centerId: run.centerId,
          runId,
          documentId: run.documentId,
          block,
          paramKey: proposal.key,
          proposedValueJson: toJson(proposal.proposedValue),
          unit: proposal.unit,
          currentValueJson: toJson(proposal.currentValue ?? null),
          confidence: proposal.confidence,
          citationJson: toJson(proposal.citation),
          reasoning: proposal.reasoning,
          exceptionNote: proposal.exceptionNote,
          manualOverride: proposal.manualOverride,
          status: 'pending',
        },
      })
    }

    for (const missing of result.notFound) {
      await client.settingExtraction.create({
        data: {
          centerId: run.centerId,
          runId,
          documentId: run.documentId,
          block,
          paramKey: missing.key,
          proposedValueJson: toJson(null),
          currentValueJson: toJson(null),
          confidence: 'low',
          citationJson: toJson(null),
          reasoning: missing.reasonKey,
          status: 'not_found',
        },
      })
    }

    if (run.requestedBy) {
      await recordInteraction({
        centerId: run.centerId,
        userId: run.requestedBy,
        question: `settings.extraction:${block}`,
        answer: `${result.proposals.length} proposals, ${result.notFound.length} not found`,
        tools: ['record_parameters'],
        documents: [{ documentId: run.documentId, title: source.title, chunkIds: [] }],
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })
    }

    await setBlock(client, runId, block, { state: 'ready', proposals: result.proposals.length })

    return {
      proposals: result.proposals.length,
      notFound: result.notFound.length,
      discarded: result.discarded.length,
    }
  } catch (error) {
    await setBlock(client, runId, block, {
      state: 'failed',
      errorKey: 'settings.extraction.errors.failed',
    })
    throw error
  }
}

export interface RunRow {
  id: string
  paramKey: string
  block: ExtractionBlock
  proposedValue: unknown
  currentValue: unknown
  unit: string | null
  confidence: 'high' | 'medium' | 'low'
  citation: {
    documentId: string
    page: number | null
    section: string | null
    quote: string
  } | null
  reasoning: string | null
  exceptionNote: string | null
  manualOverride: boolean
  status: string
  resolvedValue: unknown
}

export interface RunView {
  id: string
  documentId: string
  documentTitle: string
  createdAt: string
  appliedAt: string | null
  blocks: BlockStatuses
  rows: RunRow[]
  /** Parameters two articles disagree about: both are shown, nobody chooses. */
  conflicts: string[]
}

export async function runView(client: PrismaClient, runId: string): Promise<RunView | null> {
  const run = await client.settingExtractionRun.findUnique({
    where: { id: runId },
    include: { document: { select: { title: true } } },
  })
  if (!run) return null

  const rows = await client.settingExtraction.findMany({
    where: { runId },
    orderBy: [{ block: 'asc' }, { paramKey: 'asc' }],
  })

  const mapped = rows.map(toRow)
  const byKey = new Map<string, unknown[]>()
  for (const row of mapped) {
    if (row.status === 'not_found') continue
    byKey.set(row.paramKey, [...(byKey.get(row.paramKey) ?? []), row.proposedValue])
  }

  const conflicts = [...byKey.entries()]
    .filter(([, values]) => new Set(values.map((value) => JSON.stringify(value))).size > 1)
    .map(([key]) => key)

  return {
    id: run.id,
    documentId: run.documentId,
    documentTitle: run.document.title,
    createdAt: run.createdAt.toISOString(),
    appliedAt: run.appliedAt?.toISOString() ?? null,
    blocks: readBlocks(run.blocksJson),
    rows: mapped,
    conflicts,
  }
}

function toRow(row: {
  id: string
  paramKey: string
  block: string
  proposedValueJson: unknown
  currentValueJson: unknown
  unit: string | null
  confidence: string
  citationJson: unknown
  reasoning: string | null
  exceptionNote: string | null
  manualOverride: boolean
  status: string
  resolvedValueJson: unknown
}): RunRow {
  return {
    id: row.id,
    paramKey: row.paramKey,
    block: row.block as ExtractionBlock,
    proposedValue: row.proposedValueJson ?? null,
    currentValue: row.currentValueJson ?? null,
    unit: row.unit,
    confidence: row.confidence as 'high' | 'medium' | 'low',
    citation: (row.citationJson ?? null) as RunRow['citation'],
    reasoning: row.reasoning,
    exceptionNote: row.exceptionNote,
    manualOverride: row.manualOverride,
    status: row.status,
    resolvedValue: row.resolvedValueJson ?? null,
  }
}

/** One row, decided. Accepting is a decision; so is rejecting. */
export async function resolveExtraction(
  client: PrismaClient,
  input: {
    id: string
    centerId: string
    userId: string
    status: 'accepted' | 'edited' | 'rejected' | 'pending'
    value?: unknown
  },
): Promise<RunRow | null> {
  const row = await client.settingExtraction.findFirst({
    where: { id: input.id, centerId: input.centerId },
  })
  if (!row) return null

  const updated = await client.settingExtraction.update({
    where: { id: row.id },
    data: {
      status: input.status,
      resolvedValueJson: toJson(
        input.status === 'edited' ? (input.value ?? null) : (row.proposedValueJson ?? null),
      ),
      resolvedBy: input.status === 'pending' ? null : input.userId,
      resolvedAt: input.status === 'pending' ? null : new Date(),
    },
  })

  return toRow(updated)
}

export interface ApplySummary {
  versionId: string | null
  applied: string[]
  rejected: string[]
  /** Left for a human: nobody resolved them, or the document never said. */
  pending: string[]
}

/**
 * Writes the run into a new settings version.
 *
 * Only what a person accepted or edited moves. Everything else is reported
 * back so the last screen of the wizard can say, honestly, what is still not
 * configured — with a link to each field.
 */
export async function applyRun(
  client: PrismaClient,
  input: { runId: string; centerId: string; userId: string; ip?: string | null },
): Promise<ApplySummary | null> {
  const run = await client.settingExtractionRun.findFirst({
    where: { id: input.runId, centerId: input.centerId },
  })
  if (!run) return null

  const rows = await client.settingExtraction.findMany({ where: { runId: input.runId } })
  const current = await currentSettings(client, input.centerId)

  const resolutions: Resolution[] = rows.map((row) => ({
    key: row.paramKey,
    status: row.status as Resolution['status'],
    value:
      row.status === 'edited' ? (row.resolvedValueJson ?? null) : (row.proposedValueJson ?? null),
    citation: (row.citationJson ?? null) as Resolution['citation'],
  }))

  const result = applyResolutions(current, resolutions)

  const { versionId } = await publishSettingsVersion(client, {
    centerId: input.centerId,
    settings: result.settings,
    source: 'ai_extraction',
    sourceDocumentId: run.documentId,
    approvedBy: input.userId,
    notes: `Extraction ${run.id}`,
    provenance: result.provenance.map((record) => ({
      paramKey: record.paramKey,
      documentId: record.documentId,
      page: record.page,
      section: record.section,
      quote: record.quote,
    })),
    ip: input.ip ?? null,
  })

  await client.settingExtractionRun.update({
    where: { id: run.id },
    data: { appliedAt: new Date(), appliedBy: input.userId },
  })

  return {
    versionId,
    applied: result.applied,
    rejected: result.rejected,
    pending: result.pending,
  }
}

/** Proposals of a run, in the domain's shape, for the rules that need them. */
export function toProposals(rows: readonly RunRow[]): ExtractionProposal[] {
  return rows
    .filter((row) => row.citation !== null)
    .map((row) => ({
      key: row.paramKey,
      block: row.block,
      proposedValue: row.proposedValue,
      unit: row.unit,
      currentValue: row.currentValue,
      confidence: row.confidence,
      citation: row.citation as NonNullable<RunRow['citation']>,
      reasoning: row.reasoning,
      exceptionNote: row.exceptionNote,
      unchanged: JSON.stringify(row.currentValue) === JSON.stringify(row.proposedValue),
      manualOverride: row.manualOverride,
      status: row.status as ExtractionProposal['status'],
    }))
}
