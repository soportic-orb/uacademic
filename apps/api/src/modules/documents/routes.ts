/**
 * The document library.
 *
 * Who may upload what is decided by the pure rules in `@uacademic/shared`: the
 * framework is the platform's, a center's criteria are its administration's,
 * and a subject's teaching plan belongs to whoever actually coordinates *that*
 * subject — not to any coordinator.
 *
 * Files never get a URL. They are written outside the webroot and served only
 * through these routes, after the role and the tenant have been checked, so a
 * link that leaks is not a document that leaks.
 */
import {
  type DocumentAudience,
  type DocumentScope,
  canUploadDocument,
  checkUpload,
  expiresWithin,
  isExpired,
  parseCenterSettings,
  sniffMime,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { enqueueJob } from '../../jobs/worker.js'
import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { documentSummary, usedStorageBytes } from '../../services/documents/index-service.js'
import { estimateOcr } from '../../services/documents/ocr.js'
import { invalidateVectorCache } from '../../services/documents/retrieval.js'
import {
  checksumOf,
  deleteDocument,
  readDocument,
  storeDocument,
} from '../../services/documents/storage.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

const MANAGERS = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR'] as const

const metadataSchema = z.object({
  title: z.string().trim().min(3).max(300),
  type: z.enum(['regulation', 'teaching_plan', 'agreement', 'guide', 'minutes', 'other']),
  scope: z.enum(['university', 'center', 'degree', 'subject']),
  scopeId: z.uuid().nullable().optional(),
  academicYearId: z.uuid().nullable().optional(),
  language: z.enum(['ca', 'es', 'en']).default('ca'),
  validFrom: z.iso.date().nullable().optional(),
  validTo: z.iso.date().nullable().optional(),
  /** `ai_only` keeps it out of the repository; `center` publishes it. */
  visibility: z.enum(['ai_only', 'center']).default('ai_only'),
})

const listSchema = z.object({
  scope: z.enum(['university', 'center', 'degree', 'subject']).optional(),
  type: z.string().max(40).optional(),
  status: z.string().max(20).optional(),
  academicYearId: z.uuid().optional(),
  /** `current` hides what is out of force; `expired` shows only that. */
  validity: z.enum(['all', 'current', 'expired']).default('all'),
  q: z.string().trim().max(200).optional(),
})

export function registerDocumentRoutes(app: FastifyInstance): void {
  app.get('/api/v1/documents', { config: { roles: [...MANAGERS, 'TEACHER'] } }, async (request) => {
    const user = requireUser(request)
    const { centerId, db } = requireCenterScope(request)
    const query = parseWith(listSchema, request.query)

    const roles = rolesIn(user, centerId)
    const center = await prisma().center.findUnique({ where: { id: centerId } })
    const settings = parseCenterSettings(center?.settingsJson).documents

    const rows = await db.document.findMany({
      where: {
        ...(query.scope ? { scope: query.scope } : {}),
        ...(query.type ? { type: query.type as 'regulation' } : {}),
        ...(query.status ? { status: query.status as 'indexed' } : {}),
        ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
        ...(query.q ? { title: { contains: query.q } } : {}),
        // A teacher browses the repository; anything `ai_only` is not part of
        // it, and the assistant reads those on their behalf instead.
        ...(roles.some((role) => (MANAGERS as readonly string[]).includes(role))
          ? {}
          : { visibility: { not: 'ai_only' } }),
      },
      include: { uploader: { select: { firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    })

    const today = new Date()
    const items = rows
      .map((row) => ({
        ...documentSummary(row),
        uploadedBy: row.uploader ? `${row.uploader.firstName} ${row.uploader.lastName}` : null,
        expired: isExpired(toRef(row), today),
        expiringSoon: expiresWithin(toRef(row), settings.expiryWarningDays, today),
      }))
      .filter((item) =>
        query.validity === 'current'
          ? !item.expired
          : query.validity === 'expired'
            ? item.expired
            : true,
      )

    const used = await usedStorageBytes(prisma(), centerId)

    return {
      items,
      quota: {
        usedBytes: used,
        quotaBytes: settings.quotaMb * 1024 * 1024,
        maxFileBytes: settings.maxFileMb * 1024 * 1024,
      },
    }
  })

  /**
   * The upload. Everything that could be a lie is checked before a byte is
   * written: what the file actually is, how big it is, whether the center has
   * room, and whether it is already here under another name.
   */
  app.post('/api/v1/documents', { config: { roles: [...MANAGERS] } }, async (request, reply) => {
    const user = requireUser(request)
    const { centerId, db } = requireCenterScope(request)

    const file = await request.file()
    if (!file) throw AppError.validation([{ path: 'file', messageKey: 'validation.required' }])

    const fields = file.fields as Record<string, { value?: string } | undefined>
    const raw = Object.fromEntries(
      Object.entries(fields)
        .filter(([, field]) => typeof field?.value === 'string')
        .map(([key, field]) => [key, field?.value]),
    )

    const metadata = parseWith(metadataSchema, {
      ...raw,
      scopeId: raw.scopeId || null,
      academicYearId: raw.academicYearId || null,
      validFrom: raw.validFrom || null,
      validTo: raw.validTo || null,
    })

    const coordinated = await db.subjectCoordinator.findMany({
      where: { userId: user.userId },
      select: { subjectId: true },
    })

    if (
      !canUploadDocument({
        scope: metadata.scope,
        roles: rolesIn(user, centerId),
        coordinatedSubjectIds: coordinated.map((entry) => entry.subjectId),
        scopeId: metadata.scopeId ?? null,
      })
    ) {
      throw AppError.forbidden()
    }

    const bytes = await file.toBuffer()
    const center = await prisma().center.findUnique({ where: { id: centerId } })
    const settings = parseCenterSettings(center?.settingsJson).documents

    const checksum = checksumOf(bytes)
    const existing = await db.document.findMany({
      where: { status: { not: 'archived' } },
      select: { checksum: true },
      take: 1_000,
    })

    const check = checkUpload({
      declaredMime: file.mimetype,
      // The extension is a claim; the first bytes are the file.
      sniffed: sniffMime(bytes.subarray(0, 512)),
      sizeBytes: bytes.byteLength,
      maxBytes: settings.maxFileMb * 1024 * 1024,
      usedBytes: await usedStorageBytes(prisma(), centerId),
      quotaBytes: settings.quotaMb * 1024 * 1024,
      existingChecksums: existing.map((entry) => entry.checksum),
      checksum,
    })

    if (!check.ok) {
      throw AppError.validation([
        { path: 'file', messageKey: `documents.errors.${check.rejection}` },
      ])
    }

    const created = await db.document.create({
      data: {
        centerId,
        scope: metadata.scope as DocumentScope,
        scopeId: metadata.scopeId ?? null,
        title: metadata.title,
        type: metadata.type,
        academicYearId: metadata.academicYearId ?? null,
        language: metadata.language,
        validFrom: metadata.validFrom ? new Date(`${metadata.validFrom}T00:00:00Z`) : null,
        validTo: metadata.validTo ? new Date(`${metadata.validTo}T00:00:00Z`) : null,
        visibility: metadata.visibility,
        filePath: '',
        mime: file.mimetype,
        sizeBytes: BigInt(bytes.byteLength),
        checksum,
        status: 'uploaded',
        uploadedBy: user.userId,
      },
    })

    const stored = await storeDocument(centerId, created.id, bytes)
    await db.document.update({ where: { id: created.id }, data: { filePath: stored.path } })

    await writeAuditLog(prisma(), {
      centerId,
      userId: user.userId,
      entity: 'document',
      entityId: created.id,
      action: 'upload',
      before: null,
      after: {
        title: metadata.title,
        scope: metadata.scope,
        type: metadata.type,
        sizeBytes: bytes.byteLength,
        checksum,
      },
      source: 'user',
      ip: request.ip,
    })

    // Extraction, chunking and embedding belong to the worker: a 25 MB PDF is
    // not something an HTTP request should be holding.
    await enqueueJob(prisma(), 'documents.index', { documentId: created.id })

    return reply.code(201).send(documentSummary(created))
  })

  app.get(
    '/api/v1/documents/:id',
    { config: { roles: [...MANAGERS, 'TEACHER'] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const { document } = await find(request)

      const chunks = await prisma().documentChunk.findMany({
        where: { documentId: document.id },
        select: {
          id: true,
          ordinal: true,
          headingPath: true,
          pageFrom: true,
          pageTo: true,
          content: true,
        },
        orderBy: { ordinal: 'asc' },
        take: 400,
      })

      return { ...documentSummary(document), chunks }
    },
  )

  /** The file itself, streamed only to somebody entitled to it. */
  app.get(
    '/api/v1/documents/:id/file',
    { config: { roles: [...MANAGERS, 'TEACHER'] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { document, centerId } = await find(request)
      const user = requireUser(request)

      const bytes = await readDocument(centerId, document.id).catch(() => null)
      if (!bytes) throw AppError.notFound()

      await writeAuditLog(prisma(), {
        centerId,
        userId: user.userId,
        entity: 'document',
        entityId: document.id,
        action: 'read',
        before: null,
        after: { title: document.title },
        source: 'user',
        ip: request.ip,
      })

      return (
        reply
          .header('content-type', document.mime)
          .header('content-disposition', `inline; filename="${encodeURIComponent(document.title)}"`)
          // Never cached by a proxy: this is somebody's regulation, not an asset.
          .header('cache-control', 'private, no-store')
          .send(bytes)
      )
    },
  )

  app.patch(
    '/api/v1/documents/:id',
    { config: { roles: [...MANAGERS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const { document, centerId, db } = await find(request)
      const user = requireUser(request)
      const input = parseWith(metadataSchema.partial(), request.body)

      const updated = await db.document.update({
        where: { id: document.id },
        data: {
          ...(input.title ? { title: input.title } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(input.visibility ? { visibility: input.visibility as DocumentAudience } : {}),
          ...(input.academicYearId === undefined ? {} : { academicYearId: input.academicYearId }),
          ...(input.validFrom === undefined
            ? {}
            : { validFrom: input.validFrom ? new Date(`${input.validFrom}T00:00:00Z`) : null }),
          ...(input.validTo === undefined
            ? {}
            : { validTo: input.validTo ? new Date(`${input.validTo}T00:00:00Z`) : null }),
        },
      })

      await writeAuditLog(prisma(), {
        centerId,
        userId: user.userId,
        entity: 'document',
        entityId: document.id,
        action: 'update',
        before: { title: document.title, validTo: document.validTo },
        after: input,
        source: 'user',
        ip: request.ip,
      })

      return documentSummary(updated)
    },
  )

  /**
   * Reading a scanned document with the model's vision costs money per page,
   * so it is asked for explicitly — and the estimate is on the screen when the
   * question is put.
   */
  app.get(
    '/api/v1/documents/:id/ocr-estimate',
    { config: { roles: [...MANAGERS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const { document, centerId } = await find(request)
      const center = await prisma().center.findUnique({ where: { id: centerId } })
      const settings = parseCenterSettings(center?.settingsJson).documents

      return {
        ...estimateOcr(document.pageCount ?? 0, settings.visionOcrMaxPages),
        allowed: settings.allowVisionOcr,
        maxPages: settings.visionOcrMaxPages,
      }
    },
  )

  app.post(
    '/api/v1/documents/:id/reprocess',
    { config: { roles: [...MANAGERS] } },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { useOcr?: boolean } }>) => {
      const { document, centerId } = await find(request)
      const user = requireUser(request)
      const useOcr = Boolean((request.body as { useOcr?: boolean } | undefined)?.useOcr)

      await enqueueJob(prisma(), 'documents.index', { documentId: document.id, useOcr })

      await writeAuditLog(prisma(), {
        centerId,
        userId: user.userId,
        entity: 'document',
        entityId: document.id,
        action: useOcr ? 'ocr' : 'reprocess',
        before: { status: document.status },
        after: { queued: true, useOcr },
        source: 'user',
        ip: request.ip,
      })

      return { queued: true, useOcr }
    },
  )

  app.delete(
    '/api/v1/documents/:id',
    { config: { roles: [...MANAGERS] } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { document, centerId, db } = await find(request)
      const user = requireUser(request)

      await db.documentChunk.deleteMany({ where: { documentId: document.id } })
      await db.document.delete({ where: { id: document.id } })
      await deleteDocument(centerId, document.id)
      invalidateVectorCache(centerId)

      await writeAuditLog(prisma(), {
        centerId,
        userId: user.userId,
        entity: 'document',
        entityId: document.id,
        action: 'delete',
        before: { title: document.title, checksum: document.checksum },
        after: null,
        source: 'user',
        ip: request.ip,
      })

      return reply.code(204).send()
    },
  )
}

function rolesIn(user: ReturnType<typeof requireUser>, centerId: string): string[] {
  return user.memberships
    .filter((membership) => membership.centerId === centerId)
    .map((membership) => membership.role)
}

async function find(request: FastifyRequest<{ Params: { id: string } }>) {
  const user = requireUser(request)
  const { centerId, db } = requireCenterScope(request)

  const document = await db.document.findFirst({ where: { id: request.params.id } })
  if (!document) throw AppError.notFound()

  // `ai_only` is not part of the repository: a teacher cannot read it, and
  // cannot learn it exists either.
  const roles = rolesIn(user, centerId)
  const manages = roles.some((role) => (MANAGERS as readonly string[]).includes(role))
  if (document.visibility === 'ai_only' && !manages) throw AppError.notFound()

  return { document, centerId, db }
}

function toRef(document: {
  id: string
  title: string
  scope: string
  scopeId: string | null
  type: string
  academicYearId: string | null
  validFrom: Date | null
  validTo: Date | null
}) {
  return {
    id: document.id,
    title: document.title,
    scope: document.scope as DocumentScope,
    scopeId: document.scopeId,
    type: document.type as 'regulation',
    academicYearId: document.academicYearId,
    validFrom: document.validFrom,
    validTo: document.validTo,
  }
}
