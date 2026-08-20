/**
 * The sample workbook. Its whole value is that its columns cannot drift from
 * what the importer accepts — so this reads the file back and checks exactly
 * that, rather than trusting that it was built from the right list.
 */
import { fieldsFor, translate } from '@uacademic/shared'
import ExcelJS from 'exceljs'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { disconnectPrisma } from '@uacademic/db'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('the sample workbook for an import', () => {
  let app: FastifyInstance
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await createTestApp()
    headers = { 'x-mock-user': SEED.adminEmail, 'x-center-id': await seedCenterId() }
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  async function download(kind: string) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/template/${kind}`,
      headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('spreadsheetml')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(new Uint8Array(response.rawPayload) as unknown as ArrayBuffer)
    return workbook
  }

  it.each(['teachers', 'subjects'] as const)(
    'carries every column the %s importer expects, in order',
    async (kind) => {
      const workbook = await download(kind)
      const sheet = workbook.worksheets[0]!

      const written = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
      const expected = fieldsFor(kind).map((field) => translate('ca', field.labelKey))

      expect(written).toEqual(expected)
    },
  )

  it('fills one row in, so nobody has to guess what belongs in a column', async () => {
    const sheet = (await download('teachers')).worksheets[0]!
    const row = (sheet.getRow(2).values as unknown[]).slice(1).map(String)

    expect(row).toHaveLength(fieldsFor('teachers').length)
    expect(row).toContain('Marta')
  })

  it('explains each column on a second sheet, required ones included', async () => {
    const workbook = await download('subjects')
    const guide = workbook.worksheets[1]

    expect(guide).toBeDefined()
    expect(guide!.rowCount).toBe(fieldsFor('subjects').length + 1)
  })

  it('has nothing to offer for a kind that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/imports/template/espais',
      headers,
    })

    expect(response.statusCode).toBe(404)
  })
})
