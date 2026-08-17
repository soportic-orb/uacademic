import { parse as parseCsv } from 'csv-parse/sync'
import ExcelJS from 'exceljs'

import { AppError } from './errors.js'

/**
 * Reads CSV and Excel into the same shape, so the import pipeline never has to
 * know which one it got. Everything comes out as trimmed strings: parsing into
 * real types is the job of the shared validation rules, which run identically
 * in the browser preview and on the server.
 */
export interface TabularFile {
  headers: string[]
  rows: string[][]
}

const CSV_MIMES = ['text/csv', 'application/csv', 'text/plain']
const EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]

export function isSupportedUpload(fileName: string, mime: string): boolean {
  const lower = fileName.toLowerCase()
  return (
    CSV_MIMES.includes(mime) ||
    EXCEL_MIMES.includes(mime) ||
    lower.endsWith('.csv') ||
    lower.endsWith('.xlsx')
  )
}

export async function parseTabular(
  buffer: Buffer,
  fileName: string,
  mime: string,
  maxRows: number,
): Promise<TabularFile> {
  const lower = fileName.toLowerCase()
  const file =
    lower.endsWith('.xlsx') || EXCEL_MIMES.includes(mime)
      ? await parseExcel(buffer)
      : parseDelimited(buffer)

  if (file.headers.length === 0 || file.rows.length === 0) {
    throw AppError.validation([{ path: 'file', messageKey: 'imports.errors.emptyFile' }])
  }
  if (file.rows.length > maxRows) {
    throw AppError.validation([{ path: 'file', messageKey: 'imports.errors.tooManyRows' }])
  }

  return file
}

function parseDelimited(buffer: Buffer): TabularFile {
  // Strip the UTF-8 BOM Excel writes at the start of exported CSV files.
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  // Spanish and Catalan exports from Excel use `;`; everything else uses `,`.
  const delimiter = detectDelimiter(text)

  const records = parseCsv(text, {
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][]

  const [headers = [], ...rows] = records
  return {
    headers: headers.map((header) => header.trim()),
    rows: rows.filter((row) => row.some((cell) => cell.trim().length > 0)),
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const semicolons = (firstLine.match(/;/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  const tabs = (firstLine.match(/\t/g) ?? []).length

  if (tabs > semicolons && tabs > commas) return '\t'
  return semicolons > commas ? ';' : ','
}

/**
 * ExcelJS ships its own (older) Node typings, so its `Buffer` is nominally a
 * different type from ours. Borrowing the parameter type from its signature
 * keeps the bridge in one place instead of spreading casts around.
 */
type ExcelJsBuffer = Parameters<ExcelJS.Xlsx['load']>[0]

async function parseExcel(buffer: Buffer): Promise<TabularFile> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJsBuffer)

  const sheet = workbook.worksheets[0]
  if (!sheet) return { headers: [], rows: [] }

  const matrix: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cells[columnNumber - 1] = cellText(cell.value)
    })
    matrix.push([...cells].map((cell) => cell ?? ''))
  })

  const [headers = [], ...rows] = matrix
  return {
    headers: headers.map((header) => header.trim()),
    rows: rows.filter((row) => row.some((cell) => cell.trim().length > 0)),
  }
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value) return String(value.result ?? '')
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('')
    }
    return ''
  }
  return String(value)
}
