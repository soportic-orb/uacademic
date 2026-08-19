/**
 * Turning a file into pages of text.
 *
 * One function per format, and one honest failure mode: a PDF that carries no
 * text layer is a *scan*, and no amount of parsing will get words out of it.
 * That case is reported as such — `needsOcr` — so the person is asked whether
 * to spend money reading it with the model's vision, rather than being handed
 * an empty document and no explanation.
 */
import type { TextPage } from '@uacademic/shared'

export type ExtractionMethod = 'text_layer' | 'vision' | 'plain'

export interface ExtractionResult {
  pages: TextPage[]
  pageCount: number
  method: ExtractionMethod
  /** True when the file is a PDF with no usable text layer. */
  needsOcr: boolean
}

export class ExtractionError extends Error {
  constructor(
    /** i18n key under `documents.errors.`, shown to the person as-is. */
    readonly messageKey: string,
    message: string,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

/** Below this, a PDF page is a picture of a page rather than a page. */
const MIN_CHARS_PER_PAGE = 40

/**
 * A `Uint8Array` that is not a `Buffer`.
 *
 * pdf.js refuses a Node `Buffer` by name, and it is right to: `Buffer.slice`
 * shares memory where `Uint8Array.slice` copies, so a parser that slices would
 * quietly corrupt whatever else holds that memory. Nothing in the type system
 * catches this — a `Buffer` *is* a `Uint8Array` as far as TypeScript is
 * concerned — and the file arrives from `readFile`, which returns a `Buffer`.
 *
 * Copied rather than re-viewed: pdf.js may detach the buffer it is given, and
 * a small file's `Buffer` can be a window onto Node's shared pool, where
 * detaching would take unrelated data with it.
 */
function asPlainBytes(bytes: Uint8Array): Uint8Array {
  return Buffer.isBuffer(bytes) ? new Uint8Array(bytes) : bytes
}

export async function extractText(
  bytes: Uint8Array,
  mime: string,
  fileName = '',
): Promise<ExtractionResult> {
  if (mime === 'application/pdf') return extractPdf(bytes)

  if (mime.includes('wordprocessingml')) return extractDocx(bytes)
  if (mime.includes('spreadsheetml')) return extractXlsx(bytes)

  if (mime.startsWith('text/') || fileName.endsWith('.md') || fileName.endsWith('.txt')) {
    const text = new TextDecoder('utf-8').decode(bytes)
    return {
      pages: [{ page: 1, text }],
      pageCount: 1,
      method: 'plain',
      needsOcr: false,
    }
  }

  throw new ExtractionError('unsupportedType', `No extractor for ${mime}`)
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  // Loaded outside the guard below on purpose. A parser that will not load is
  // a broken installation, not a broken file, and reporting it as "this PDF
  // may be corrupted" sends somebody to re-scan a document that was fine.
  const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf')

  try {
    const pdf = await getDocumentProxy(asPlainBytes(bytes))
    const result = await extractPdfText(pdf, { mergePages: false })
    const pageTexts = Array.isArray(result.text) ? result.text : [String(result.text)]

    const pages: TextPage[] = pageTexts.map((text, index) => ({
      page: index + 1,
      text: text ?? '',
    }))

    const characters = pages.reduce((total, page) => total + page.text.trim().length, 0)
    const needsOcr = pages.length > 0 && characters / pages.length < MIN_CHARS_PER_PAGE

    return {
      pages,
      pageCount: result.totalPages ?? pages.length,
      method: 'text_layer',
      needsOcr,
    }
  } catch (error) {
    throw new ExtractionError(
      'corruptFile',
      error instanceof Error ? error.message : 'PDF could not be read',
    )
  }
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractionResult> {
  const mammoth = await import('mammoth')

  try {
    // Markdown rather than raw text: the headings survive, and the chunker
    // uses them to keep an article with its own title.
    // Markdown keeps the headings; mammoth exposes it on the default export.
    const convert = mammoth as unknown as {
      default?: { convertToMarkdown?: typeof mammoth.convertToHtml }
      convertToMarkdown?: typeof mammoth.convertToHtml
    }
    const toMarkdown = convert.convertToMarkdown ?? convert.default?.convertToMarkdown
    const result = toMarkdown
      ? await toMarkdown({ buffer: Buffer.from(bytes) })
      : await mammoth.extractRawText({ buffer: Buffer.from(bytes) })

    return {
      pages: [{ page: 1, text: result.value }],
      pageCount: 1,
      method: 'text_layer',
      needsOcr: result.value.trim().length === 0,
    }
  } catch (error) {
    throw new ExtractionError(
      'corruptFile',
      error instanceof Error ? error.message : 'DOCX could not be read',
    )
  }
}

async function extractXlsx(bytes: Uint8Array): Promise<ExtractionResult> {
  const xlsx = await import('xlsx')

  try {
    const workbook = xlsx.read(bytes, { type: 'array' })

    // One "page" per sheet, with its name as a heading: a citation can then
    // say which sheet a number came from.
    const pages: TextPage[] = workbook.SheetNames.map((name, index) => {
      const sheet = workbook.Sheets[name]
      const csv = sheet ? xlsx.utils.sheet_to_csv(sheet, { blankrows: false }) : ''
      return { page: index + 1, text: `# ${name}\n\n${csv}` }
    })

    return {
      pages,
      pageCount: pages.length,
      method: 'text_layer',
      needsOcr: pages.every((page) => page.text.trim().length < MIN_CHARS_PER_PAGE),
    }
  } catch (error) {
    throw new ExtractionError(
      'corruptFile',
      error instanceof Error ? error.message : 'XLSX could not be read',
    )
  }
}
