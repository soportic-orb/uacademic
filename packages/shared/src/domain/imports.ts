/**
 * Bulk import of teachers and subjects: column mapping and row validation.
 *
 * All of it is pure, so the same code validates in the browser preview and on
 * the server before anything is written — and the dry-run report is the exact
 * outcome of the real run.
 */
import { round2 } from './time.js'

export type ImportKind = 'teachers' | 'subjects'

export interface FieldParseSuccess {
  ok: true
  value: string | number
}

export interface FieldParseFailure {
  ok: false
  messageKey: string
}

export type FieldParseResult = FieldParseSuccess | FieldParseFailure

export interface ImportFieldSpec {
  key: string
  /** i18n key for the column label shown in the mapping step. */
  labelKey: string
  required: boolean
  /** Header names recognised automatically, lower-cased and accent-stripped. */
  aliases: readonly string[]
  parse: (raw: string) => FieldParseResult
  /**
   * A value that fills this column in the sample workbook.
   *
   * Written as somebody would type it, not as it is stored: the point of the
   * sample is to show what a spreadsheet may say, so the accepted synonyms are
   * discoverable. `test/imports.test.ts` parses every one of them, so an
   * example that this field would reject cannot survive.
   */
  example: string
}

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const text =
  (max: number) =>
  (raw: string): FieldParseResult => {
    const value = raw.trim()
    if (value.length === 0) return { ok: false, messageKey: 'validation.required' }
    if (value.length > max) return { ok: false, messageKey: 'validation.max' }
    return { ok: true, value }
  }

const email = (raw: string): FieldParseResult => {
  const value = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { ok: false, messageKey: 'imports.errors.invalidEmail' }
  }
  return { ok: true, value }
}

/** Accepts both decimal separators: spreadsheets in three languages arrive here. */
const decimal =
  (min: number, max: number) =>
  (raw: string): FieldParseResult => {
    const value = Number(raw.trim().replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(value)) return { ok: false, messageKey: 'imports.errors.notANumber' }
    if (value < min || value > max) return { ok: false, messageKey: 'imports.errors.outOfRange' }
    return { ok: true, value: round2(value) }
  }

const integer =
  (min: number, max: number) =>
  (raw: string): FieldParseResult => {
    const value = Number(raw.trim())
    if (!Number.isInteger(value)) return { ok: false, messageKey: 'imports.errors.notAnInteger' }
    if (value < min || value > max) return { ok: false, messageKey: 'imports.errors.outOfRange' }
    return { ok: true, value }
  }

/** Enum values, plus the aliases a human is likely to type in a spreadsheet. */
const enumeration =
  (values: readonly string[], aliases: Record<string, string> = {}) =>
  (raw: string): FieldParseResult => {
    const normalized = normalizeHeader(raw)
    const direct = values.find((value) => normalizeHeader(value) === normalized)
    if (direct) return { ok: true, value: direct }

    const alias = aliases[normalized]
    if (alias) return { ok: true, value: alias }

    return { ok: false, messageKey: 'imports.errors.unknownValue' }
  }

export const TEACHER_IMPORT_FIELDS: readonly ImportFieldSpec[] = [
  {
    key: 'email',
    example: 'marta.puig@universitat.cat',
    labelKey: 'imports.fields.email',
    required: true,
    aliases: ['email', 'correo', 'correu', 'mail', 'emailaddress'],
    parse: email,
  },
  {
    key: 'firstName',
    example: 'Marta',
    labelKey: 'imports.fields.firstName',
    required: true,
    aliases: ['firstname', 'nombre', 'nom', 'name'],
    parse: text(100),
  },
  {
    key: 'lastName',
    example: 'Puig Serra',
    labelKey: 'imports.fields.lastName',
    required: true,
    aliases: ['lastname', 'apellidos', 'cognoms', 'surname', 'apellido'],
    parse: text(150),
  },
  {
    key: 'category',
    example: 'Agregat',
    labelKey: 'imports.fields.category',
    required: true,
    aliases: ['category', 'categoria', 'categoría'],
    parse: enumeration(
      [
        'full_professor',
        'associate_professor',
        'assistant_professor',
        'lecturer',
        'adjunct',
        'visiting',
        'external',
      ],
      {
        catedratic: 'full_professor',
        catedratico: 'full_professor',
        agregat: 'associate_professor',
        agregado: 'associate_professor',
        lector: 'assistant_professor',
        collaborador: 'lecturer',
        colaborador: 'lecturer',
        associat: 'adjunct',
        asociado: 'adjunct',
        visitant: 'visiting',
        visitante: 'visiting',
        extern: 'external',
        externo: 'external',
      },
    ),
  },
  {
    key: 'dedication',
    example: 'Completa',
    labelKey: 'imports.fields.dedication',
    required: true,
    aliases: ['dedication', 'dedicacion', 'dedicació', 'dedicacio', 'jornada'],
    parse: enumeration(['full_time', 'part_time', 'hourly'], {
      completa: 'full_time',
      tempscomplet: 'full_time',
      tiempocompleto: 'full_time',
      parcial: 'part_time',
      tempsparcial: 'part_time',
      tiempoparcial: 'part_time',
      perhores: 'hourly',
      porhoras: 'hourly',
    }),
  },
  {
    key: 'contractedHours',
    example: '240',
    labelKey: 'imports.fields.contractedHours',
    required: true,
    aliases: ['contractedhours', 'horas', 'hores', 'horascontratadas', 'horescontractades'],
    parse: decimal(0, 9999.99),
  },
  {
    key: 'knowledgeArea',
    example: 'Didàctica de les matemàtiques',
    labelKey: 'imports.fields.knowledgeArea',
    required: false,
    aliases: [
      'knowledgearea',
      'area',
      'àrea',
      'areaconocimiento',
      'areadeconeixement',
      'areadeconocimiento',
    ],
    parse: text(150),
  },
]

export const SUBJECT_IMPORT_FIELDS: readonly ImportFieldSpec[] = [
  {
    key: 'code',
    example: 'MAT101',
    labelKey: 'imports.fields.code',
    required: true,
    aliases: ['code', 'codigo', 'codi', 'subjectcode'],
    parse: text(32),
  },
  {
    key: 'nameCa',
    example: 'Fonaments de matemàtiques',
    labelKey: 'imports.fields.nameCa',
    required: true,
    aliases: ['nameca', 'nomca', 'catala', 'nomcatala', 'nombrecatalan', 'namecatalan'],
    parse: text(200),
  },
  {
    key: 'nameEs',
    example: 'Fundamentos de matemáticas',
    labelKey: 'imports.fields.nameEs',
    required: true,
    aliases: [
      'namees',
      'nombrees',
      'castellano',
      'nombrecastellano',
      'nomcastella',
      'namespanish',
      'nombreespanol',
    ],
    parse: text(200),
  },
  {
    key: 'nameEn',
    example: 'Foundations of mathematics',
    labelKey: 'imports.fields.nameEn',
    required: true,
    aliases: ['nameen', 'english', 'nombreingles', 'nomangles', 'nameenglish'],
    parse: text(200),
  },
  {
    key: 'degreeCode',
    example: 'GEP',
    labelKey: 'imports.fields.degreeCode',
    required: true,
    aliases: [
      'degreecode',
      'titulacion',
      'titulacio',
      'grado',
      'grau',
      'degree',
      'codidetitulacio',
      'codigodetitulacion',
    ],
    parse: text(32),
  },
  {
    key: 'ects',
    example: '6',
    labelKey: 'imports.fields.ects',
    required: true,
    aliases: ['ects', 'credits', 'creditos', 'credits_ects'],
    parse: decimal(0, 999.9),
  },
  {
    key: 'year',
    example: '1',
    labelKey: 'imports.fields.year',
    required: true,
    aliases: ['year', 'curso', 'curs'],
    parse: integer(1, 9),
  },
  {
    key: 'term',
    example: 'S1',
    labelKey: 'imports.fields.term',
    required: true,
    aliases: ['term', 'periodo', 'periode', 'semestre'],
    parse: enumeration(['t1', 't2', 't3', 'annual'], {
      '1': 't1',
      '2': 't2',
      '3': 't3',
      s1: 't1',
      s2: 't2',
      s3: 't3',
      '1rsemestre': 't1',
      '1ersemestre': 't1',
      '1semestre': 't1',
      primersemestre: 't1',
      primersemestre1: 't1',
      '2nsemestre': 't2',
      '2osemestre': 't2',
      '2semestre': 't2',
      segonsemestre: 't2',
      segundosemestre: 't2',
      '3rsemestre': 't3',
      '3ersemestre': 't3',
      anual: 'annual',
      annual: 'annual',
    }),
  },
  {
    key: 'type',
    example: 'Obligatòria',
    labelKey: 'imports.fields.type',
    required: true,
    aliases: ['type', 'tipo', 'tipus'],
    parse: enumeration(['basic', 'compulsory', 'elective', 'practicum', 'final_project'], {
      basica: 'basic',
      basic: 'basic',
      obligatoria: 'compulsory',
      obligatoria1: 'compulsory',
      optativa: 'elective',
      practiques: 'practicum',
      practicas: 'practicum',
      tfg: 'final_project',
      treballfidegrau: 'final_project',
      trabajofindegrado: 'final_project',
    }),
  },
  {
    key: 'teachingLanguage',
    example: 'Català',
    labelKey: 'imports.fields.teachingLanguage',
    required: false,
    aliases: [
      'teachinglanguage',
      'idioma',
      'llengua',
      'language',
      'idiomadedocencia',
      'llenguadedocencia',
    ],
    parse: enumeration(['ca', 'es', 'en', 'other'], {
      catala: 'ca',
      catalan: 'ca',
      castella: 'es',
      castellano: 'es',
      espanol: 'es',
      angles: 'en',
      ingles: 'en',
      english: 'en',
    }),
  },
]

export function fieldsFor(kind: ImportKind): readonly ImportFieldSpec[] {
  return kind === 'teachers' ? TEACHER_IMPORT_FIELDS : SUBJECT_IMPORT_FIELDS
}

/** field key → column index in the uploaded file, or null when unmapped. */
export type ColumnMapping = Record<string, number | null>

/**
 * Proposes a mapping from the file's headers. Accent- and case-insensitive,
 * because nobody's spreadsheet says `contractedHours`.
 */
export function suggestMapping(
  headers: readonly string[],
  fields: readonly ImportFieldSpec[],
): ColumnMapping {
  const normalizedHeaders = headers.map(normalizeHeader)
  const mapping: ColumnMapping = {}

  for (const field of fields) {
    const candidates = [field.key, ...field.aliases].map(normalizeHeader)
    const index = normalizedHeaders.findIndex((header) => candidates.includes(header))
    mapping[field.key] = index >= 0 ? index : null
  }

  return mapping
}

export interface RowError {
  field: string
  messageKey: string
  value: string
}

export interface ValidatedRow {
  rowNumber: number
  status: 'valid' | 'invalid'
  values: Record<string, string | number>
  errors: RowError[]
}

/** Validates a single row against the mapping. Never throws: it reports. */
export function validateRow(
  rowNumber: number,
  cells: readonly string[],
  mapping: ColumnMapping,
  fields: readonly ImportFieldSpec[],
): ValidatedRow {
  const values: Record<string, string | number> = {}
  const errors: RowError[] = []

  for (const field of fields) {
    const index = mapping[field.key]
    const raw = index === null || index === undefined ? '' : (cells[index] ?? '')
    const trimmed = raw.trim()

    if (trimmed.length === 0) {
      if (field.required) {
        errors.push({ field: field.key, messageKey: 'validation.required', value: '' })
      }
      continue
    }

    const parsed = field.parse(trimmed)
    if (parsed.ok) {
      values[field.key] = parsed.value
    } else {
      errors.push({ field: field.key, messageKey: parsed.messageKey, value: trimmed })
    }
  }

  return { rowNumber, status: errors.length === 0 ? 'valid' : 'invalid', values, errors }
}

export interface MappingValidation {
  ok: boolean
  missingRequired: string[]
}

/** A mapping is usable only when every required field points at a column. */
export function validateMapping(
  mapping: ColumnMapping,
  fields: readonly ImportFieldSpec[],
): MappingValidation {
  const missingRequired = fields
    .filter((field) => field.required)
    .filter((field) => mapping[field.key] === null || mapping[field.key] === undefined)
    .map((field) => field.key)

  return { ok: missingRequired.length === 0, missingRequired }
}

export interface ImportSummary {
  total: number
  valid: number
  invalid: number
  duplicates: number
  errorsByField: Record<string, number>
}

/**
 * Counts what a run would do. Duplicates are detected on the key field — the
 * same teacher twice in one file is an error worth surfacing before applying.
 */
export function summarizeRows(rows: readonly ValidatedRow[], keyField: string): ImportSummary {
  const errorsByField: Record<string, number> = {}
  const seen = new Set<string>()
  let duplicates = 0

  for (const row of rows) {
    for (const error of row.errors) {
      errorsByField[error.field] = (errorsByField[error.field] ?? 0) + 1
    }

    const key = row.values[keyField]
    if (typeof key === 'string') {
      const normalized = key.toLowerCase()
      if (seen.has(normalized)) duplicates += 1
      else seen.add(normalized)
    }
  }

  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === 'valid').length,
    invalid: rows.filter((row) => row.status === 'invalid').length,
    duplicates,
    errorsByField,
  }
}

export function keyFieldFor(kind: ImportKind): string {
  return kind === 'teachers' ? 'email' : 'code'
}
