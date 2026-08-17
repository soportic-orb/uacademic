/**
 * Bulk import, end to end: upload → map → dry run → apply.
 *
 * The point of the dry run is that it writes nothing, and the point of the
 * report is that it matches what the apply step will do. Both are asserted
 * here against a real database.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

const BOUNDARY = '----uacademictest'

/** Builds a multipart body by hand: no extra dependency for four fields. */
function multipart(
  file: { name: string; type: string; content: string },
  fields: Record<string, string>,
): { payload: Buffer; headers: Record<string, string> } {
  const parts: string[] = []

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )
  }
  parts.push(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
      `Content-Type: ${file.type}\r\n\r\n${file.content}\r\n`,
  )
  parts.push(`--${BOUNDARY}--\r\n`)

  return {
    payload: Buffer.from(parts.join(''), 'utf8'),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  }
}

const TEACHERS_CSV = [
  'Correu;Nom;Cognoms;Categoria;Dedicació;Hores contractades;Àrea',
  'nova.docent@demo.uacademic.test;Nova;Docent Importada;Agregat;Temps complet;120,5;Física',
  'segona.docent@demo.uacademic.test;Segona;Docent Importada;Associat;Per hores;40;Programació',
  'tercera.docent@demo.uacademic.test;;Sense Nom;Agregat;Temps complet;90;',
  'no-es-un-correu;Quarta;Docent;Agregat;Temps complet;90;',
  'NOVA.DOCENT@demo.uacademic.test;Duplicada;Docent;Agregat;Temps complet;60;',
].join('\n')

describe.skipIf(!hasDatabase)('bulk import', () => {
  let app: FastifyInstance
  let centerId: string
  let academicYearId: string
  const prisma = getPrismaClient()

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })
  const importedEmails = [
    'nova.docent@demo.uacademic.test',
    'segona.docent@demo.uacademic.test',
    'tercera.docent@demo.uacademic.test',
  ]

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    const year = await prisma.academicYear.findFirst({ where: { centerId, status: 'active' } })
    academicYearId = year!.id
    await cleanUp()
  })

  afterAll(async () => {
    await cleanUp()
    await app.close()
    await disconnectPrisma()
  })

  async function cleanUp() {
    const users = await prisma.user.findMany({ where: { email: { in: importedEmails } } })
    const ids = users.map((user) => user.id)
    if (ids.length > 0) {
      await prisma.teacherProfile.deleteMany({ where: { userId: { in: ids } } })
      await prisma.userCenterRole.deleteMany({ where: { userId: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    }
    await prisma.importBatch.deleteMany({ where: { centerId, fileName: 'docents.csv' } })
  }

  async function uploadTeachers() {
    const body = multipart(
      { name: 'docents.csv', type: 'text/csv', content: TEACHERS_CSV },
      { kind: 'teachers', academicYearId },
    )

    return app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { ...asAdmin(), ...body.headers },
      payload: body.payload,
    })
  }

  it('reads the file, detects the delimiter and proposes a column mapping', async () => {
    const response = await uploadTeachers()

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.rowCount).toBe(5)
    // Semicolon-separated, accented Catalan headers, and it still maps.
    expect(body.headers).toHaveLength(7)
    expect(body.mapping).toMatchObject({ email: 0, firstName: 1, contractedHours: 5 })
    expect(body.fields.find((field: { key: string }) => field.key === 'email').required).toBe(true)
  })

  it('validates every row without writing anything to the business tables', async () => {
    const uploaded = await uploadTeachers()
    const id = uploaded.json().id

    const validated = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${id}/validate`,
      headers: asAdmin(),
    })

    expect(validated.statusCode).toBe(200)
    expect(validated.json().dryRun).toBe(true)
    expect(validated.json().summary).toMatchObject({
      total: 5,
      valid: 2,
      invalid: 3,
      duplicates: 1,
    })

    // The dry run is a dry run: nobody exists yet.
    const created = await prisma.user.findMany({ where: { email: { in: importedEmails } } })
    expect(created).toHaveLength(0)
  })

  it('reports the failing rows with their row number and field', async () => {
    const uploaded = await uploadTeachers()
    const id = uploaded.json().id
    await app.inject({ method: 'POST', url: `/api/v1/imports/${id}/validate`, headers: asAdmin() })

    const report = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${id}?status=invalid`,
      headers: asAdmin(),
    })

    const rows = report.json().rows
    expect(rows.map((row: { rowNumber: number }) => row.rowNumber)).toEqual([4, 5, 6])
    expect(rows[0].errors[0]).toMatchObject({ field: 'firstName', messageKey: 'validation.required' })
    expect(rows[1].errors[0]).toMatchObject({ field: 'email' })
    expect(rows[2].errors[0]).toMatchObject({ messageKey: 'imports.errors.duplicateInFile' })
  })

  it('applies only the valid rows and creates the teachers with their contract', async () => {
    const uploaded = await uploadTeachers()
    const id = uploaded.json().id
    await app.inject({ method: 'POST', url: `/api/v1/imports/${id}/validate`, headers: asAdmin() })

    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${id}/apply`,
      headers: asAdmin(),
    })

    expect(applied.statusCode).toBe(200)
    expect(applied.json()).toMatchObject({ status: 'applied', applied: 2 })

    const teacher = await prisma.user.findUnique({
      where: { email: 'nova.docent@demo.uacademic.test' },
      include: { teacherProfiles: true, centerRoles: true },
    })

    expect(teacher?.firstName).toBe('Nova')
    // Imported people are invited, not active: they still have to sign in.
    expect(teacher?.status).toBe('invited')
    expect(teacher?.centerRoles[0]?.role).toBe('TEACHER')
    expect(Number(teacher?.teacherProfiles[0]?.contractedHours)).toBe(120.5)
    expect(teacher?.teacherProfiles[0]?.category).toBe('associate_professor')

    // The row that failed validation was not applied.
    expect(
      await prisma.user.findUnique({ where: { email: 'tercera.docent@demo.uacademic.test' } }),
    ).toBeNull()
  })

  it('is repeatable: re-importing updates the contract instead of duplicating', async () => {
    const uploaded = await uploadTeachers()
    const id = uploaded.json().id
    await app.inject({ method: 'POST', url: `/api/v1/imports/${id}/validate`, headers: asAdmin() })
    await app.inject({ method: 'POST', url: `/api/v1/imports/${id}/apply`, headers: asAdmin() })

    const profiles = await prisma.teacherProfile.findMany({
      where: { centerId, user: { email: 'nova.docent@demo.uacademic.test' } },
    })

    expect(profiles).toHaveLength(1)
  })

  it('refuses a mapping that leaves a required column unassigned', async () => {
    const uploaded = await uploadTeachers()
    const id = uploaded.json().id

    const mapped = await app.inject({
      method: 'PATCH',
      url: `/api/v1/imports/${id}/mapping`,
      headers: asAdmin(),
      payload: { mapping: { email: 0, firstName: 1 } },
    })
    expect(mapped.json().ok).toBe(false)
    expect(mapped.json().missingRequired).toContain('contractedHours')

    const validated = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${id}/validate`,
      headers: asAdmin(),
    })
    expect(validated.statusCode).toBe(422)
  })

  it('rejects a file type it cannot read', async () => {
    const body = multipart(
      { name: 'docents.pdf', type: 'application/pdf', content: '%PDF-1.4' },
      { kind: 'teachers', academicYearId },
    )

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { ...asAdmin(), ...body.headers },
      payload: body.payload,
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.details[0].messageKey).toBe('imports.errors.unsupportedFile')
  })

  it('is closed to anyone who is not a center administrator', async () => {
    const body = multipart(
      { name: 'docents.csv', type: 'text/csv', content: TEACHERS_CSV },
      { kind: 'teachers', academicYearId },
    )

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: {
        'x-mock-user': SEED.teacherEmail,
        'x-center-id': centerId,
        ...body.headers,
      },
      payload: body.payload,
    })

    expect(response.statusCode).toBe(403)
  })
})
