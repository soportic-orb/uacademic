/**
 * Turning an uploaded file into pages of text.
 *
 * The case worth a test on its own: the bytes arrive from `readFile`, which
 * returns a `Buffer`, and a `Buffer` *is* a `Uint8Array` as far as TypeScript
 * is concerned — so nothing in the type system notices, while pdf.js refuses
 * it by name and every PDF an installation was given failed as "corrupted".
 */
import { describe, expect, it } from 'vitest'

import { extractText } from '../src/services/documents/extract.js'

/** The smallest PDF that still carries a text layer, built by hand. */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

const SENTENCE =
  'Les reduccions per carrec academic es descompten de la capacitat contractada del professorat'

describe('reading a PDF', () => {
  it('reads one handed over as a Buffer, which is what comes off the disk', async () => {
    const result = await extractText(minimalPdf(SENTENCE), 'application/pdf', 'normativa.pdf')

    expect(result.pages[0]?.text).toContain('reduccions per carrec academic')
    expect(result.pageCount).toBe(1)
    expect(result.method).toBe('text_layer')
    // A page with words on it is not a scan, and must not be sent for OCR.
    expect(result.needsOcr).toBe(false)
  })

  it('reads one handed over as a plain Uint8Array just the same', async () => {
    const bytes = new Uint8Array(minimalPdf(SENTENCE))
    const result = await extractText(bytes, 'application/pdf', 'normativa.pdf')

    expect(result.pages[0]?.text).toContain('reduccions per carrec academic')
  })

  it('says a PDF with no words is a scan, rather than failing over it', async () => {
    // Nothing to read: the honest answer is "this needs OCR", not an error.
    const result = await extractText(minimalPdf('.'), 'application/pdf', 'escaneig.pdf')

    expect(result.needsOcr).toBe(true)
    expect(result.method).toBe('text_layer')
  })

  it('refuses what it has no extractor for, by name', async () => {
    await expect(
      extractText(Buffer.from([0, 1, 2]), 'application/x-rar', 'thing.rar'),
    ).rejects.toMatchObject({ messageKey: 'unsupportedType' })
  })
})
