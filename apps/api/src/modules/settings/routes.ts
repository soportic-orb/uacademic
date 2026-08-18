/**
 * The configuration of a center: how it is read from a regulation, how it is
 * confirmed, and how any rule can be traced back to the article behind it.
 *
 * Only the center's administration gets in. An extraction is a proposal and
 * stays one until somebody says yes, parameter by parameter (R5).
 */
import {
  EXTRACTION_BLOCKS,
  type ExtractionBlock,
  SETTING_PARAMS,
  bulkAcceptable,
  diffSettings,
  parseCenterSettings,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'
import { extractionAvailable } from '../ai/extraction.js'
import {
  applyRun,
  resolveExtraction,
  runView,
  startRun,
  toProposals,
} from '../../services/settings/extraction-run.js'
import {
  currentSettings,
  paramProvenance,
  settingsHistory,
} from '../../services/settings/versions.js'

const ADMINS = ['SUPERADMIN', 'CENTER_ADMIN'] as const
/** Coordination reads provenance too: it is what explains a blocked action. */
const READERS = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'] as const

export function registerSettingsRoutes(app: FastifyInstance): void {
  /** The catalogue itself: what can be configured, and what it is called. */
  app.get('/api/v1/settings/params', { config: { roles: [...READERS] } }, async () => ({
    blocks: EXTRACTION_BLOCKS,
    items: SETTING_PARAMS,
  }))

  /**
   * The reverse link, and the reason phase 5C exists. A constraint blocked
   * somebody; this says which parameter imposes it and which article of which
   * document put that number there.
   */
  app.get(
    '/api/v1/settings/provenance/:paramKey',
    { config: { roles: [...READERS] } },
    async (request: FastifyRequest<{ Params: { paramKey: string } }>) => {
      const { centerId } = requireCenterScope(request)
      const paramKey = request.params.paramKey

      if (!SETTING_PARAMS.some((param) => param.key === paramKey)) throw AppError.notFound()

      return paramProvenance(prisma(), centerId, paramKey)
    },
  )

  /** "Under which rules was last year's timetable generated?" */
  app.get('/api/v1/settings/versions', { config: { roles: [...ADMINS] } }, async (request) => {
    const { centerId } = requireCenterScope(request)
    return { items: await settingsHistory(prisma(), centerId) }
  })

  app.get(
    '/api/v1/settings/versions/:id',
    { config: { roles: [...ADMINS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const { centerId } = requireCenterScope(request)

      const version = await prisma().centerSettingsVersion.findFirst({
        where: { id: request.params.id, centerId },
        include: { provenance: { include: { document: { select: { title: true } } } } },
      })
      if (!version) throw AppError.notFound()

      const settings = parseCenterSettings(version.settingsJson)

      return {
        id: version.id,
        createdAt: version.createdAt.toISOString(),
        source: version.source,
        notes: version.notes,
        settings,
        // What this version said, against what the center runs today: a
        // version is read to see what changed, not to admire a snapshot.
        changes: diffSettings(settings, await currentSettings(prisma(), centerId)),
        provenance: version.provenance.map((record) => ({
          paramKey: record.paramKey,
          documentTitle: record.document?.title ?? null,
          page: record.page,
          section: record.section,
          quote: record.quote,
        })),
      }
    },
  )

  /* ───────────────────────────── extraction ───────────────────────────── */

  /** Reads a document into proposals: one job per block, none of them applied. */
  app.post(
    '/api/v1/settings/extractions',
    { config: { roles: [...ADMINS] } },
    async (request, reply) => {
      const user = requireUser(request)
      const { centerId, db } = requireCenterScope(request)
      const input = parseWith(z.object({ documentId: z.uuid() }), request.body)

      if (!extractionAvailable()) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'assistant.errors.unavailable')
      }

      const document = await db.document.findFirst({ where: { id: input.documentId } })
      if (!document) throw AppError.notFound()

      if (document.status !== 'indexed') {
        throw AppError.validation([
          { path: 'documentId', messageKey: 'settings.extraction.errors.documentNotIndexed' },
        ])
      }

      const run = await startRun(prisma(), {
        centerId,
        documentId: document.id,
        requestedBy: user.userId,
        ip: request.ip,
      })

      return reply.code(202).send(run)
    },
  )

  app.get('/api/v1/settings/extractions', { config: { roles: [...ADMINS] } }, async (request) => {
    const { centerId } = requireCenterScope(request)

    const runs = await prisma().settingExtractionRun.findMany({
      where: { centerId },
      include: { document: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })

    return {
      items: runs.map((run) => ({
        id: run.id,
        documentId: run.documentId,
        documentTitle: run.document.title,
        createdAt: run.createdAt.toISOString(),
        appliedAt: run.appliedAt?.toISOString() ?? null,
      })),
    }
  })

  app.get(
    '/api/v1/settings/extractions/:id',
    { config: { roles: [...ADMINS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const { centerId } = requireCenterScope(request)

      const run = await prisma().settingExtractionRun.findFirst({
        where: { id: request.params.id, centerId },
        select: { id: true },
      })
      if (!run) throw AppError.notFound()

      const view = await runView(prisma(), run.id)
      if (!view) throw AppError.notFound()

      return view
    },
  )

  /** One row, decided by a person: accepted as read, edited, or refused. */
  app.patch(
    '/api/v1/settings/extractions/:runId/rows/:id',
    { config: { roles: [...ADMINS] } },
    async (request: FastifyRequest<{ Params: { runId: string; id: string } }>) => {
      const user = requireUser(request)
      const { centerId } = requireCenterScope(request)

      const input = parseWith(
        z.object({
          status: z.enum(['accepted', 'edited', 'rejected', 'pending']),
          value: z.unknown().optional(),
        }),
        request.body,
      )

      const row = await resolveExtraction(prisma(), {
        id: request.params.id,
        centerId,
        userId: user.userId,
        status: input.status,
        value: input.value,
      })
      if (!row) throw AppError.notFound()

      return row
    },
  )

  /**
   * "Accept every high-confidence reading of this block."
   *
   * Still one human click, and still not everything: a contradiction needs a
   * choice, and a parameter somebody edited by hand is not this run's to
   * reverse.
   */
  app.post(
    '/api/v1/settings/extractions/:id/accept-high',
    { config: { roles: [...ADMINS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const user = requireUser(request)
      const { centerId } = requireCenterScope(request)
      const input = parseWith(
        z.object({ block: z.enum(EXTRACTION_BLOCKS).optional() }),
        request.body ?? {},
      )

      const view = await runView(prisma(), request.params.id)
      if (!view) throw AppError.notFound()

      const proposals = toProposals(view.rows)
      const accepted = bulkAcceptable(proposals, input.block as ExtractionBlock | undefined)
      const ids = view.rows
        .filter((row) => accepted.some((entry) => entry.key === row.paramKey))
        .map((row) => row.id)

      for (const id of ids) {
        await resolveExtraction(prisma(), {
          id,
          centerId,
          userId: user.userId,
          status: 'accepted',
        })
      }

      return { accepted: ids.length }
    },
  )

  /**
   * Writes the run into a new settings version. Everything that was not
   * confirmed stays exactly as it was, and comes back on the summary as work
   * still to do by hand.
   */
  app.post(
    '/api/v1/settings/extractions/:id/apply',
    { config: { roles: [...ADMINS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const user = requireUser(request)
      const { centerId } = requireCenterScope(request)

      const summary = await applyRun(prisma(), {
        runId: request.params.id,
        centerId,
        userId: user.userId,
        ip: request.ip,
      })
      if (!summary) throw AppError.notFound()

      return summary
    },
  )
}
