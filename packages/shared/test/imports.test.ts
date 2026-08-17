import { describe, expect, it } from 'vitest'

import {
  SUBJECT_IMPORT_FIELDS,
  TEACHER_IMPORT_FIELDS,
  fieldsFor,
  keyFieldFor,
  summarizeRows,
  suggestMapping,
  validateMapping,
  validateRow,
} from '../src/domain/imports.js'

describe('column mapping', () => {
  it('recognises headers in any of the three languages, accents and all', () => {
    const mapping = suggestMapping(
      ['Correu', 'Nom', 'Cognoms', 'Categoria', 'Dedicació', 'Hores contractades'],
      TEACHER_IMPORT_FIELDS,
    )

    expect(mapping).toMatchObject({
      email: 0,
      firstName: 1,
      lastName: 2,
      category: 3,
      dedication: 4,
      contractedHours: 5,
    })
  })

  it('leaves unknown columns unmapped instead of guessing', () => {
    const mapping = suggestMapping(['email', 'departamento'], TEACHER_IMPORT_FIELDS)

    expect(mapping.email).toBe(0)
    expect(mapping.firstName).toBeNull()
  })

  it('refuses a mapping that misses a required field', () => {
    const mapping = suggestMapping(['email', 'Nom'], TEACHER_IMPORT_FIELDS)
    const validation = validateMapping(mapping, TEACHER_IMPORT_FIELDS)

    expect(validation.ok).toBe(false)
    expect(validation.missingRequired).toContain('lastName')
    expect(validation.missingRequired).toContain('contractedHours')
  })

  it('accepts a complete mapping', () => {
    const headers = ['email', 'nom', 'cognoms', 'categoria', 'dedicacio', 'hores']
    const mapping = suggestMapping(headers, TEACHER_IMPORT_FIELDS)

    expect(validateMapping(mapping, TEACHER_IMPORT_FIELDS)).toEqual({
      ok: true,
      missingRequired: [],
    })
  })
})

describe('teacher rows', () => {
  const mapping = suggestMapping(
    ['email', 'nom', 'cognoms', 'categoria', 'dedicacio', 'hores', 'area'],
    TEACHER_IMPORT_FIELDS,
  )

  it('normalises a well-formed row', () => {
    const row = validateRow(
      2,
      ['Marta.Puig@Uni.edu', 'Marta', 'Puig Serra', 'Agregat', 'Temps complet', '240,50', 'Física'],
      mapping,
      TEACHER_IMPORT_FIELDS,
    )

    expect(row.status).toBe('valid')
    expect(row.values).toEqual({
      email: 'marta.puig@uni.edu',
      firstName: 'Marta',
      lastName: 'Puig Serra',
      category: 'associate_professor',
      dedication: 'full_time',
      contractedHours: 240.5,
      knowledgeArea: 'Física',
    })
  })

  it('reports every problem in the row, not just the first', () => {
    const row = validateRow(
      3,
      ['not-an-email', '', 'Puig', 'Inventada', 'Temps complet', 'moltes', ''],
      mapping,
      TEACHER_IMPORT_FIELDS,
    )

    expect(row.status).toBe('invalid')
    expect(row.errors.map((error) => error.field).sort()).toEqual([
      'category',
      'contractedHours',
      'email',
      'firstName',
    ])
    expect(row.errors.find((error) => error.field === 'firstName')?.messageKey).toBe(
      'validation.required',
    )
    expect(row.errors.find((error) => error.field === 'contractedHours')?.messageKey).toBe(
      'imports.errors.notANumber',
    )
  })

  it('leaves optional fields out when empty, without failing', () => {
    const row = validateRow(
      4,
      ['a@b.edu', 'Anna', 'Torres', 'associate_professor', 'full_time', '120', ''],
      mapping,
      TEACHER_IMPORT_FIELDS,
    )

    expect(row.status).toBe('valid')
    expect(row.values.knowledgeArea).toBeUndefined()
  })

  it('rejects hours outside a plausible contract', () => {
    const row = validateRow(
      5,
      ['a@b.edu', 'Anna', 'Torres', 'associate_professor', 'full_time', '-4', ''],
      mapping,
      TEACHER_IMPORT_FIELDS,
    )

    expect(row.errors[0]?.messageKey).toBe('imports.errors.outOfRange')
  })
})

describe('subject rows', () => {
  const headers = ['codi', 'nom ca', 'nombre es', 'name en', 'titulacio', 'ects', 'curs', 'periode', 'tipus', 'idioma']
  const mapping = suggestMapping(headers, SUBJECT_IMPORT_FIELDS)

  it('maps the three names and the academic metadata', () => {
    const row = validateRow(
      2,
      ['FIS101', 'Física', 'Física', 'Physics', 'GEI', '6', '1', '1r semestre', 'Bàsica', 'Català'],
      mapping,
      SUBJECT_IMPORT_FIELDS,
    )

    expect(row.status).toBe('valid')
    expect(row.values).toMatchObject({
      code: 'FIS101',
      nameCa: 'Física',
      nameEn: 'Physics',
      degreeCode: 'GEI',
      ects: 6,
      year: 1,
      term: 't1',
      type: 'basic',
      teachingLanguage: 'ca',
    })
  })

  it('fails a subject missing one of the three languages (R1)', () => {
    const row = validateRow(
      3,
      ['FIS101', 'Física', '', 'Physics', 'GEI', '6', '1', 't1', 'basic', 'ca'],
      mapping,
      SUBJECT_IMPORT_FIELDS,
    )

    expect(row.status).toBe('invalid')
    expect(row.errors).toEqual([
      { field: 'nameEs', messageKey: 'validation.required', value: '' },
    ])
  })

  it('rejects a non-integer year', () => {
    const row = validateRow(
      4,
      ['FIS101', 'a', 'b', 'c', 'GEI', '6', '1.5', 't1', 'basic', 'ca'],
      mapping,
      SUBJECT_IMPORT_FIELDS,
    )

    expect(row.errors[0]).toMatchObject({ field: 'year', messageKey: 'imports.errors.notAnInteger' })
  })
})

describe('dry-run summary', () => {
  const mapping = suggestMapping(
    ['email', 'nom', 'cognoms', 'categoria', 'dedicacio', 'hores'],
    TEACHER_IMPORT_FIELDS,
  )

  const row = (rowNumber: number, email: string, hours = '120') =>
    validateRow(
      rowNumber,
      [email, 'Anna', 'Torres', 'associate_professor', 'full_time', hours],
      mapping,
      TEACHER_IMPORT_FIELDS,
    )

  it('counts valid, invalid and duplicated rows', () => {
    const summary = summarizeRows(
      [row(2, 'a@b.edu'), row(3, 'A@B.edu'), row(4, 'c@d.edu', 'nope')],
      keyFieldFor('teachers'),
    )

    expect(summary).toMatchObject({ total: 3, valid: 2, invalid: 1, duplicates: 1 })
    expect(summary.errorsByField.contractedHours).toBe(1)
  })

  it('exposes the field spec per import kind', () => {
    expect(fieldsFor('teachers')).toBe(TEACHER_IMPORT_FIELDS)
    expect(fieldsFor('subjects')).toBe(SUBJECT_IMPORT_FIELDS)
    expect(keyFieldFor('subjects')).toBe('code')
  })
})
