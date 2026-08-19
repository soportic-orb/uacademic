/**
 * The document library, end to end: who may upload what, what is refused
 * before a byte is written, what the pipeline makes of a file, and what the
 * assistant is allowed to see of it.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { pino } from 'pino'

import { buildJobHandlers } from '../src/jobs/handlers.js'
import { setAnthropicClient } from '../src/modules/ai/client.js'
import { invalidateVectorCache } from '../src/services/documents/retrieval.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

const POD_TEXT = [
  '# Normativa POD 2026-27',
  '',
  'Aquest document regula la dedicacio docent del centre.',
  '',
  '## 1. Dedicacio',
  '',
  'El professorat a temps complet imparteix 240 hores anuals.',
  '',
  '## 2. Reduccions',
  '',
  'La coordinacio de titulacio dona dret a una reduccio de 60 hores.',
  'El professorat associat no pot superar les 180 hores.',
].join('\n')

/** A multipart body, built by hand: the upload route reads real files. */
function multipart(
  fields: Record<string, string>,
  file: { name: string; filename: string; mime: string; content: Uint8Array },
) {
  const boundary = '----uacademictest'
  const parts: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.mime}\r\n\r\n`,
    ),
    Buffer.from(file.content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )

  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

describe.skipIf(!hasDatabase)('the document library', () => {
  let app: FastifyInstance
  let centerId: string
  let academicYearId: string
  const prisma = getPrismaClient()
  const handlers = buildJobHandlers(prisma, pino({ level: 'silent' }))

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })
  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  const upload = async (
    fields: Record<string, string>,
    headers: Record<string, string>,
    content: Uint8Array = new TextEncoder().encode(POD_TEXT),
    file: { filename: string; mime: string } = { filename: 'pod.md', mime: 'text/markdown' },
  ) => {
    const body = multipart(fields, { name: 'file', ...file, content })
    return app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...headers, ...body.headers },
      payload: body.payload,
    })
  }

  const index = async (documentId: string, useOcr = false) => {
    await handlers['documents.index']!({ documentId, useOcr })
  }

  /**
   * Documents the seed put there — the center's own regulation, which other
   * suites cite through settings provenance. This suite cleans up after
   * itself and only after itself.
   */
  let preexisting: string[] = []

  beforeAll(async () => {
    process.env.UACADEMIC_UPLOAD_DIR = './var/test-uploads'
    app = await createTestApp()
    centerId = await seedCenterId()

    preexisting = (
      await prisma.document.findMany({ where: { centerId }, select: { id: true } })
    ).map((row) => row.id)

    const year = await prisma.academicYear.findFirstOrThrow({
      where: { centerId, status: 'active' },
    })
    academicYearId = year.id
  })

  afterAll(async () => {
    setAnthropicClient(undefined)
    await cleanUp()
    await app.close()
    await disconnectPrisma()
  })

  const cleanUp = async () => {
    const mine = { centerId, documentId: { notIn: preexisting } }
    await prisma.documentChunk.deleteMany({ where: mine })
    await prisma.document.deleteMany({ where: { centerId, id: { notIn: preexisting } } })
  }

  afterEach(async () => {
    await cleanUp()
    invalidateVectorCache(centerId)
  })

  describe('who may upload what', () => {
    it('lets the center administration upload the center’s own criteria', async () => {
      const response = await upload(
        {
          title: 'Normativa POD 2026-27',
          type: 'regulation',
          scope: 'center',
          academicYearId,
          validFrom: '2026-09-01',
          validTo: '2027-08-31',
          visibility: 'ai_only',
        },
        asAdmin(),
      )

      expect(response.statusCode).toBe(201)
      expect(response.json().status).toBe('uploaded')
    })

    it('refuses a coordinator a subject they do not coordinate', async () => {
      const foreign = await prisma.subject.findFirst({
        where: {
          centerId,
          NOT: { coordinators: { some: { user: { email: SEED.teacherEmail } } } },
        },
      })
      if (!foreign) return

      const response = await upload(
        {
          title: 'Guia docent aliena',
          type: 'teaching_plan',
          scope: 'subject',
          scopeId: foreign.id,
          academicYearId,
        },
        asCoordinator(),
      )

      expect(response.statusCode).toBe(403)
    })

    it('lets a coordinator upload the plan of a subject they do coordinate', async () => {
      const own = await prisma.subjectCoordinator.findFirst({
        where: { user: { email: SEED.teacherEmail } },
      })
      if (!own) return

      const response = await upload(
        {
          title: 'Guia docent propia',
          type: 'teaching_plan',
          scope: 'subject',
          scopeId: own.subjectId,
          academicYearId,
        },
        asCoordinator(),
      )

      expect(response.statusCode).toBe(201)
    })

    it('reserves the university framework for the platform', async () => {
      const response = await upload(
        { title: 'Conveni marc', type: 'agreement', scope: 'university' },
        asAdmin(),
      )

      expect(response.statusCode).toBe(403)
    })
  })

  describe('what is refused before anything is written', () => {
    it('reads the first bytes rather than the extension', async () => {
      // A zip pretending to be a PDF: the magic number gives it away.
      const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
      const response = await upload(
        { title: 'Fals PDF', type: 'other', scope: 'center' },
        asAdmin(),
        zip,
        { filename: 'trojan.pdf', mime: 'application/pdf' },
      )

      expect(response.statusCode).toBe(422)
      expect(JSON.stringify(response.json())).toContain('mismatchedType')
    })

    it('refuses a type it cannot read at all', async () => {
      const response = await upload(
        { title: 'Binari', type: 'other', scope: 'center' },
        asAdmin(),
        new TextEncoder().encode('MZ'),
        { filename: 'setup.exe', mime: 'application/x-msdownload' },
      )

      expect(response.statusCode).toBe(422)
      expect(JSON.stringify(response.json())).toContain('unsupportedType')
    })

    it('notices the same file arriving twice under another name', async () => {
      const first = await upload(
        { title: 'Normativa', type: 'regulation', scope: 'center' },
        asAdmin(),
      )
      expect(first.statusCode).toBe(201)

      const second = await upload(
        { title: 'Normativa (copia)', type: 'regulation', scope: 'center' },
        asAdmin(),
      )

      expect(second.statusCode).toBe(422)
      expect(JSON.stringify(second.json())).toContain('duplicate')
    })
  })

  describe('processing', () => {
    it('indexes a document into citable fragments', async () => {
      const created = await upload(
        {
          title: 'Normativa POD 2026-27',
          type: 'regulation',
          scope: 'center',
          academicYearId,
        },
        asAdmin(),
      )
      const documentId = created.json().id as string

      await index(documentId)

      const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } })
      expect(document.status).toBe('indexed')
      expect(document.chunkCount).toBeGreaterThan(0)
      expect(document.extractedWith).toBe('plain')

      const chunks = await prisma.documentChunk.findMany({ where: { documentId } })
      expect(chunks.length).toBe(document.chunkCount)
      // Every fragment carries where it came from and a vector to find it by.
      expect(chunks.every((chunk) => chunk.embedding !== null)).toBe(true)
      expect(chunks.some((chunk) => chunk.headingPath?.includes('Reduccions'))).toBe(true)
    })

    it('says why in words when it cannot read a file', async () => {
      const created = await upload(
        { title: 'PDF trencat', type: 'other', scope: 'center' },
        asAdmin(),
        Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x01]),
        { filename: 'broken.pdf', mime: 'application/pdf' },
      )

      await index(created.json().id as string)

      const document = await prisma.document.findUniqueOrThrow({
        where: { id: created.json().id as string },
      })
      expect(document.status).toBe('failed')
      // An i18n key the UI turns into a sentence — never a stack trace.
      expect(document.errorKey).toBeTruthy()
      expect(document.errorKey).not.toContain('Error:')

      // And the parser's own words reach whoever manages documents. Without
      // them, "the file may be corrupted" is where the investigation ends:
      // a library that failed to load, a file that really is truncated and a
      // page the parser choked on all look identical.
      expect(document.errorDetail).toBeTruthy()

      const listed = await app.inject({
        method: 'GET',
        url: '/api/v1/documents',
        headers: asAdmin(),
      })
      const row = listed
        .json()
        .items.find((item: { id: string }) => item.id === (created.json().id as string))
      expect(row.errorDetail).toBe(document.errorDetail)
    })
  })

  describe('reading', () => {
    it('serves the file only through the API, never as a URL', async () => {
      const created = await upload(
        { title: 'Normativa', type: 'regulation', scope: 'center', visibility: 'center' },
        asAdmin(),
      )
      const documentId = created.json().id as string

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${documentId}/file`,
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toContain('no-store')
      expect(response.body).toContain('240 hores')

      // And the read is on the record.
      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'document', entityId: documentId, action: 'read' },
      })
      expect(audit).not.toBeNull()
    })

    it('keeps an assistant-only document out of a teacher’s repository', async () => {
      const created = await upload(
        { title: 'Criteris interns', type: 'regulation', scope: 'center', visibility: 'ai_only' },
        asAdmin(),
      )
      const documentId = created.json().id as string

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/documents',
        headers: asTeacher(),
      })
      expect((list.json().items as { id: string }[]).some((item) => item.id === documentId)).toBe(
        false,
      )

      // Not even by guessing the address.
      const direct = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${documentId}`,
        headers: asTeacher(),
      })
      expect(direct.statusCode).toBe(404)
    })

    it('separates what is in force from what has expired', async () => {
      await upload(
        {
          title: 'Pla docent 2024-25',
          type: 'teaching_plan',
          scope: 'center',
          validFrom: '2024-09-01',
          validTo: '2025-08-31',
        },
        asAdmin(),
      )

      const expired = await app.inject({
        method: 'GET',
        url: '/api/v1/documents?validity=expired',
        headers: asAdmin(),
      })
      const current = await app.inject({
        method: 'GET',
        url: '/api/v1/documents?validity=current',
        headers: asAdmin(),
      })

      const titles = (list: { items: { title: string; expired: boolean }[] }) =>
        list.items.filter((item) => item.title === 'Pla docent 2024-25')

      expect(titles(expired.json())).toHaveLength(1)
      expect(titles(expired.json())[0]?.expired).toBe(true)
      // The same plan is not offered as something still in force.
      expect(titles(current.json())).toHaveLength(0)
    })

    it('reports what the center is using against its quota', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/documents',
        headers: asAdmin(),
      })

      expect(response.json().quota.quotaBytes).toBeGreaterThan(0)
      expect(response.json().quota.usedBytes).toBeGreaterThanOrEqual(0)
    })
  })

  describe('what the assistant is given', () => {
    /** A stub that records the context it was handed. */
    class Recorder {
      requests: { messages: unknown[] }[] = []

      messages = {
        stream: (params: { messages: unknown[] }) => {
          this.requests.push({ messages: params.messages })
          return {
            on() {
              return this
            },
            async finalMessage() {
              return {
                content: [{ type: 'text', text: 'Segons la normativa, 240 hores.' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 10, output_tokens: 5 },
              }
            },
          }
        },
      }
    }

    it('injects the documents whole, cached, and records which fed the answer', async () => {
      const created = await upload(
        {
          title: 'Normativa POD 2026-27',
          type: 'regulation',
          scope: 'center',
          academicYearId,
        },
        asAdmin(),
      )
      const documentId = created.json().id as string
      await index(documentId)

      const recorder = new Recorder()
      setAnthropicClient(recorder as never)

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/ask',
        headers: asCoordinator(),
        payload: { question: 'Quantes hores imparteix el professorat a temps complet?' },
      })

      expect(response.statusCode).toBe(200)

      const sent = JSON.stringify(recorder.requests[0]?.messages)
      expect(sent).toContain('240 hores')
      expect(sent).toContain('cache_control')
      // The rules travel with the documents.
      expect(sent).toContain('[doc:')

      const events = response.body
        .split('\n\n')
        .filter((frame) => frame.startsWith('data: '))
        .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>)

      const documents = events.find((event) => event.type === 'documents')
      expect(documents?.strategy).toBe('injected')

      const interaction = await prisma.aiInteraction.findFirstOrThrow({
        where: { centerId },
        orderBy: { createdAt: 'desc' },
      })
      expect(JSON.stringify(interaction.documentsUsedJson)).toContain(documentId)

      setAnthropicClient(undefined)
      await prisma.aiInteraction.deleteMany({ where: { centerId } })
    })

    it('never hands over a document that is out of force', async () => {
      const stale = await upload(
        {
          title: 'Normativa antiga',
          type: 'regulation',
          scope: 'center',
          validFrom: '2023-09-01',
          validTo: '2024-08-31',
        },
        asAdmin(),
      )
      await index(stale.json().id as string)

      const recorder = new Recorder()
      setAnthropicClient(recorder as never)

      await app.inject({
        method: 'POST',
        url: '/api/v1/ai/ask',
        headers: asCoordinator(),
        payload: { question: 'Que diu la normativa?' },
      })

      const sent = JSON.stringify(recorder.requests[0]?.messages)
      expect(sent).not.toContain('Normativa antiga')

      setAnthropicClient(undefined)
      await prisma.aiInteraction.deleteMany({ where: { centerId } })
    })
  })
})
