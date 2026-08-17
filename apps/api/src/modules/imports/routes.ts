import {
  type ColumnMapping,
  type ImportKind,
  type ValidatedRow,
  fieldsFor,
  keyFieldFor,
  summarizeRows,
  suggestMapping,
  validateMapping,
  validateRow,
} from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { Env } from '../../config/env.js'
import { writeAuditLog } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { toJson } from '../../lib/json.js'
import { prisma } from '../../lib/prisma.js'
import { isSupportedUpload, parseTabular } from '../../lib/tabular.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

const IMPORTER_ROLES = ['CENTER_ADMIN'] as const

const mappingSchema = z.object({
  mapping: z.record(z.string(), z.number().int().min(0).nullable()),
})

const rowsQuerySchema = z.object({
  status: z.enum(['valid', 'invalid', 'applied', 'skipped', 'pending']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * Bulk import in four steps: upload, map the columns, validate (dry run) and
 * apply. Nothing reaches the business tables until the last step, and the
 * report the user approves is produced by the very same validation code that
 * the apply step trusts.
 */
export function registerImportRoutes(app: FastifyInstance, env: Env): void {
  app.post('/api/v1/imports', { config: { roles: IMPORTER_ROLES } }, async (request, reply) => {
    const { centerId, db } = requireCenterScope(request)
    const user = requireUser(request)

    const upload = await request.file({ limits: { fileSize: env.IMPORT_MAX_FILE_MB * 1024 * 1024 } })
    if (!upload) throw AppError.badRequest('imports.errors.unsupportedFile')

    const fields = upload.fields as Record<string, { value?: unknown } | undefined>
    const kindValue = String(fields.kind?.value ?? '')
    const academicYearId = String(fields.academicYearId?.value ?? '')

    if (kindValue !== 'teachers' && kindValue !== 'subjects') {
      throw AppError.validation([{ path: 'kind', messageKey: 'validation.required' }])
    }
    const kind: ImportKind = kindValue

    const academicYear = await db.academicYear.findUnique({ where: { id: academicYearId } })
    if (!academicYear) {
      throw AppError.validation([{ path: 'academicYearId', messageKey: 'validation.required' }])
    }

    if (!isSupportedUpload(upload.filename, upload.mimetype)) {
      throw AppError.validation([{ path: 'file', messageKey: 'imports.errors.unsupportedFile' }])
    }

    const buffer = await upload.toBuffer()
    const file = await parseTabular(buffer, upload.filename, upload.mimetype, env.IMPORT_MAX_ROWS)
    const specs = fieldsFor(kind)
    const mapping = suggestMapping(file.headers, specs)

    const batch = await db.importBatch.create({
      data: {
        centerId,
        academicYearId: academicYear.id,
        type: kind,
        fileName: upload.filename,
        mime: upload.mimetype,
        sizeBytes: buffer.byteLength,
        status: 'uploaded',
        headersJson: toJson(file.headers),
        mappingJson: toJson(mapping),
        createdBy: user.userId,
        rows: {
          create: file.rows.map((cells, index) => ({
            centerId,
            // Row 1 is the header, so data starts at 2 — the number the user
            // sees in their spreadsheet.
            rowNumber: index + 2,
            rawJson: toJson(cells),
          })),
        },
      },
    })

    void reply.status(201)
    return {
      id: batch.id,
      kind,
      fileName: batch.fileName,
      headers: file.headers,
      mapping,
      rowCount: file.rows.length,
      fields: specs.map((field) => ({
        key: field.key,
        labelKey: field.labelKey,
        required: field.required,
      })),
    }
  })

  app.patch(
    '/api/v1/imports/:id/mapping',
    { config: { roles: IMPORTER_ROLES } },
    async (request) => {
      const { db } = requireCenterScope(request)
      const { id } = request.params as { id: string }
      const body = parseWith(mappingSchema, request.body)

      const batch = await db.importBatch.findUnique({ where: { id } })
      if (!batch) throw AppError.notFound()
      if (batch.status === 'applied') throw AppError.conflict()

      const specs = fieldsFor(batch.type)
      const validation = validateMapping(body.mapping as ColumnMapping, specs)

      const updated = await db.importBatch.update({
        where: { id },
        data: { mappingJson: toJson(body.mapping), status: 'mapped' },
      })

      return { id: updated.id, mapping: body.mapping, ...validation }
    },
  )

  /**
   * The dry run: validates every row and stores the outcome, without touching
   * a single business table.
   */
  app.post('/api/v1/imports/:id/validate', { config: { roles: IMPORTER_ROLES } }, async (request) => {
    const { db } = requireCenterScope(request)
    const { id } = request.params as { id: string }

    const batch = await db.importBatch.findUnique({ where: { id } })
    if (!batch) throw AppError.notFound()
    if (batch.status === 'applied') throw AppError.conflict()

    const specs = fieldsFor(batch.type)
    const mapping = (batch.mappingJson ?? {}) as ColumnMapping
    const mappingCheck = validateMapping(mapping, specs)
    if (!mappingCheck.ok) {
      throw AppError.validation(
        mappingCheck.missingRequired.map((field) => ({
          path: field,
          messageKey: 'validation.required',
        })),
      )
    }

    const rows = await db.importRow.findMany({
      where: { importBatchId: id },
      orderBy: { rowNumber: 'asc' },
    })

    const keyField = keyFieldFor(batch.type)
    const seen = new Set<string>()
    const validated: ValidatedRow[] = []

    for (const row of rows) {
      const cells = (row.rawJson ?? []) as string[]
      const result = validateRow(row.rowNumber, cells, mapping, specs)

      // A file that repeats the same teacher twice is a mistake worth naming.
      const key = result.values[keyField]
      if (typeof key === 'string') {
        const normalized = key.toLowerCase()
        if (seen.has(normalized)) {
          result.errors.push({
            field: keyField,
            messageKey: 'imports.errors.duplicateInFile',
            value: key,
          })
          result.status = 'invalid'
        } else {
          seen.add(normalized)
        }
      }

      validated.push(result)

      await db.importRow.update({
        where: { id: row.id },
        data: {
          status: result.status,
          normalizedJson: toJson(result.values),
          errorsJson: toJson(result.errors),
        },
      })
    }

    const summary = summarizeRows(validated, keyField)
    await db.importBatch.update({
      where: { id },
      data: { status: 'validated', summaryJson: toJson(summary) },
    })

    return { id, summary, dryRun: true }
  })

  app.get('/api/v1/imports/:id', { config: { roles: IMPORTER_ROLES } }, async (request) => {
    const { db } = requireCenterScope(request)
    const { id } = request.params as { id: string }
    const query = parseWith(rowsQuerySchema, request.query)

    const batch = await db.importBatch.findUnique({ where: { id } })
    if (!batch) throw AppError.notFound()

    const where = { importBatchId: id, ...(query.status ? { status: query.status } : {}) }
    const [rows, total] = await Promise.all([
      db.importRow.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.importRow.count({ where }),
    ])

    return {
      id: batch.id,
      kind: batch.type,
      status: batch.status,
      fileName: batch.fileName,
      headers: batch.headersJson ?? [],
      mapping: batch.mappingJson ?? {},
      summary: batch.summaryJson ?? null,
      appliedAt: batch.appliedAt?.toISOString() ?? null,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        raw: row.rawJson,
        values: row.normalizedJson,
        errors: row.errorsJson ?? [],
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  })

  /** Confirms the run. Only rows the dry run marked valid are written. */
  app.post('/api/v1/imports/:id/apply', { config: { roles: IMPORTER_ROLES } }, async (request) => {
    const { centerId, db } = requireCenterScope(request)
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    const batch = await db.importBatch.findUnique({ where: { id } })
    if (!batch) throw AppError.notFound()
    if (batch.status !== 'validated') throw AppError.conflict()
    if (!batch.academicYearId) throw AppError.conflict()

    const rows = await db.importRow.findMany({
      where: { importBatchId: id, status: 'valid' },
      orderBy: { rowNumber: 'asc' },
    })

    let applied = 0
    const failures: { rowNumber: number; messageKey: string }[] = []

    for (const row of rows) {
      const values = (row.normalizedJson ?? {}) as Record<string, string | number>
      try {
        const entityId =
          batch.type === 'teachers'
            ? await applyTeacherRow(centerId, batch.academicYearId, values)
            : await applySubjectRow(centerId, batch.academicYearId, values)

        await db.importRow.update({
          where: { id: row.id },
          data: { status: 'applied', entityId },
        })
        applied += 1
      } catch (error) {
        const messageKey =
          error instanceof AppError ? error.messageKey : 'imports.errors.unknownValue'
        failures.push({ rowNumber: row.rowNumber, messageKey })
        await db.importRow.update({
          where: { id: row.id },
          data: {
            status: 'invalid',
            errorsJson: toJson([{ field: '_row', messageKey, value: '' }]),
          },
        })
      }
    }

    const updated = await db.importBatch.update({
      where: { id },
      data: {
        status: failures.length > 0 && applied === 0 ? 'failed' : 'applied',
        appliedAt: new Date(),
        appliedBy: user.userId,
        summaryJson: toJson({
          ...((batch.summaryJson ?? {}) as Record<string, unknown>),
          applied,
          failed: failures.length,
        }),
      },
    })

    await writeAuditLog(prisma(), {
      centerId,
      userId: user.userId,
      entity: 'import_batch',
      entityId: id,
      action: 'apply',
      after: { kind: batch.type, applied, failed: failures.length },
      source: 'user',
      ip: request.ip,
    })

    return { id: updated.id, status: updated.status, applied, failures }
  })

  app.delete('/api/v1/imports/:id', { config: { roles: IMPORTER_ROLES } }, async (request) => {
    const { db } = requireCenterScope(request)
    const { id } = request.params as { id: string }

    const batch = await db.importBatch.findUnique({ where: { id } })
    if (!batch) throw AppError.notFound()
    if (batch.status === 'applied') throw AppError.conflict()

    await db.importBatch.update({ where: { id }, data: { status: 'cancelled' } })
    return { ok: true }
  })
}

/**
 * Teachers: the person, their role in the center and their contract for the
 * year. Re-importing the same file updates the contract instead of duplicating
 * anything, which is what makes the operation safe to repeat.
 */
async function applyTeacherRow(
  centerId: string,
  academicYearId: string,
  values: Record<string, string | number>,
): Promise<string> {
  const client = prisma()
  const email = String(values.email).toLowerCase()

  const user = await client.user.upsert({
    where: { email },
    create: {
      email,
      firstName: String(values.firstName),
      lastName: String(values.lastName),
      status: 'invited',
    },
    update: {
      firstName: String(values.firstName),
      lastName: String(values.lastName),
    },
  })

  const membership = await client.userCenterRole.findFirst({
    where: { userId: user.id, centerId, role: 'TEACHER' },
  })
  if (!membership) {
    await client.userCenterRole.create({ data: { userId: user.id, centerId, role: 'TEACHER' } })
  }

  const profile = await client.teacherProfile.upsert({
    where: { userId_centerId_academicYearId: { userId: user.id, centerId, academicYearId } },
    create: {
      userId: user.id,
      centerId,
      academicYearId,
      category: values.category as 'associate_professor',
      dedication: values.dedication as 'full_time',
      contractedHours: Number(values.contractedHours),
    },
    update: {
      category: values.category as 'associate_professor',
      dedication: values.dedication as 'full_time',
      contractedHours: Number(values.contractedHours),
    },
  })

  if (typeof values.knowledgeArea === 'string' && values.knowledgeArea.length > 0) {
    const existing = await client.teacherSkill.findFirst({
      where: { teacherProfileId: profile.id, knowledgeArea: values.knowledgeArea },
    })
    if (!existing) {
      await client.teacherSkill.create({
        data: { centerId, teacherProfileId: profile.id, knowledgeArea: values.knowledgeArea },
      })
    }
  }

  return profile.id
}

async function applySubjectRow(
  centerId: string,
  academicYearId: string,
  values: Record<string, string | number>,
): Promise<string> {
  const client = prisma()

  const degree = await client.degree.findFirst({
    where: { centerId, code: String(values.degreeCode) },
  })
  if (!degree) throw AppError.validation([{ path: 'degreeCode', messageKey: 'errors.notFound' }])

  const code = String(values.code)
  const existing = await client.subject.findFirst({ where: { centerId, academicYearId, code } })

  const data = {
    centerId,
    academicYearId,
    degreeId: degree.id,
    code,
    nameCa: String(values.nameCa),
    nameEs: String(values.nameEs),
    nameEn: String(values.nameEn),
    ects: Number(values.ects),
    year: Number(values.year),
    term: values.term as 't1',
    type: values.type as 'basic',
    teachingLanguage: (values.teachingLanguage ?? 'ca') as 'ca',
  }

  const subject = existing
    ? await client.subject.update({ where: { id: existing.id }, data })
    : await client.subject.create({ data })

  return subject.id
}
