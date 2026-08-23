/**
 * A document handed to the assistant mid-conversation.
 *
 * A coordinator is sent next term's timetable as a spreadsheet, or a Word
 * table, or a PDF from another department, and has to type it into the planner
 * by hand. This is the other half of that: the file is read once, its text is
 * kept with the conversation, and the assistant works from it — asking about
 * anything it cannot map, and finally producing a proposal a person confirms
 * (R5). Nothing here writes to a timetable.
 *
 * The file itself is not stored. What is kept is the text, which is what the
 * model reads and what a person could be shown if they asked why a row was
 * mapped the way it was. The library of the center's own documents is a
 * different thing entirely — scoped, cited and permanent — and this must not
 * end up in it.
 */
import type { PrismaClient } from '@uacademic/db'
import type { MultipartFile } from '@fastify/multipart'

import { AppError } from '../../lib/errors.js'
import { ExtractionError, extractText } from '../../services/documents/extract.js'

/** What a timetable can plausibly need, and no more. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/**
 * The ceiling on what reaches the prompt.
 *
 * A term's timetable is a few thousand characters; a two-hundred-page PDF
 * somebody attached by mistake is not something to pay for and not something
 * the model would read usefully anyway. Truncating says so in the text rather
 * than silently sending half a document.
 */
const MAX_ATTACHMENT_CHARS = 120_000

const ACCEPTED = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]

export interface StoredAttachment {
  id: string
  fileName: string
  mime: string
  pageCount: number
  characters: number
}

export async function attachDocument(
  client: PrismaClient,
  input: { conversationId: string; centerId: string; file: MultipartFile },
): Promise<StoredAttachment> {
  const { file } = input

  if (!ACCEPTED.some((mime) => file.mimetype === mime)) {
    throw AppError.validation([{ path: 'file', messageKey: 'assistant.attachments.unsupported' }])
  }

  const bytes = await file.toBuffer().catch(() => null)
  if (!bytes || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw AppError.validation([{ path: 'file', messageKey: 'assistant.attachments.tooLarge' }])
  }

  let text: string
  let pageCount: number

  try {
    const extracted = await extractText(new Uint8Array(bytes), file.mimetype, file.filename)
    // Page markers survive: "the Tuesday column on sheet 2" is a thing a
    // coordinator says, and the model can only answer it if the text says
    // which sheet or page each block came from.
    text = extracted.pages
      .map((page) => `--- ${pageLabel(file.mimetype, page.page)} ---\n${page.text}`)
      .join('\n\n')
    pageCount = extracted.pageCount
  } catch (error) {
    if (error instanceof ExtractionError) {
      throw AppError.validation([
        { path: 'file', messageKey: `assistant.attachments.${error.messageKey}` },
      ])
    }
    throw error
  }

  if (text.trim().length === 0) {
    // A scan with no text layer. Saying so is far better than attaching an
    // empty document and letting the assistant answer about nothing.
    throw AppError.validation([{ path: 'file', messageKey: 'assistant.attachments.noText' }])
  }

  const truncated = text.length > MAX_ATTACHMENT_CHARS
  const stored = truncated ? `${text.slice(0, MAX_ATTACHMENT_CHARS)}\n\n[…]` : text

  const created = await client.aiAttachment.create({
    data: {
      conversationId: input.conversationId,
      centerId: input.centerId,
      fileName: file.filename.slice(0, 255),
      mime: file.mimetype,
      text: stored,
      pageCount,
    },
  })

  return {
    id: created.id,
    fileName: created.fileName,
    mime: created.mime,
    pageCount: created.pageCount,
    characters: stored.length,
  }
}

function pageLabel(mime: string, page: number): string {
  return mime.includes('spreadsheetml') ? `sheet ${page}` : `page ${page}`
}

/** Everything attached to this conversation, as one block for the prompt. */
export async function attachmentBlock(
  client: PrismaClient,
  conversationId: string,
): Promise<string> {
  const rows = await client.aiAttachment.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 5,
  })

  if (rows.length === 0) return ''

  return [
    '--- ATTACHED DOCUMENTS ---',
    'The person attached these to this conversation. They are working material, not the center’s data: nothing in them is true of this platform until you have matched it to something the read tools return.',
    ...rows.map((row) => `\n## ${row.fileName}\n${row.text}`),
    '--- END OF ATTACHED DOCUMENTS ---',
  ].join('\n')
}

export async function listAttachments(
  client: PrismaClient,
  conversationId: string,
): Promise<StoredAttachment[]> {
  const rows = await client.aiAttachment.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fileName: true, mime: true, pageCount: true, text: true },
  })

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    mime: row.mime,
    pageCount: row.pageCount,
    characters: row.text.length,
  }))
}
