/**
 * Reading a scanned PDF, when there is nothing to parse.
 *
 * The pages are handed to the model as a PDF document block and it reads them
 * with its vision — which is what "rasterise and use Claude's vision" amounts
 * to, minus a native image toolchain we would have to install on a shared
 * Plesk host (CLAUDE.md §2). Same result, one moving part instead of three.
 *
 * It costs money per page, so nothing here runs by itself: the estimate is
 * shown to the person, they say yes, and only then is this called. The
 * document records that it was read this way.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { TextPage } from '@uacademic/shared'

import { anthropic, assistantAvailable, assistantModel } from '../../modules/ai/client.js'
import { ExtractionError } from './extract.js'

/**
 * Roughly what a page costs to read, in tokens, so the UI can warn before
 * anybody spends it. A scanned page is around 1.5k input tokens plus what the
 * transcription itself produces.
 */
export const OCR_TOKENS_PER_PAGE = 2_500

export interface OcrEstimate {
  pages: number
  estimatedTokens: number
  /** True when the document is longer than the center allows for OCR. */
  tooLong: boolean
}

export function estimateOcr(pageCount: number, maxPages: number): OcrEstimate {
  return {
    pages: pageCount,
    estimatedTokens: pageCount * OCR_TOKENS_PER_PAGE,
    tooLong: pageCount > maxPages,
  }
}

export interface OcrResult {
  pages: TextPage[]
  tokensIn: number
  tokensOut: number
}

/**
 * Transcribes a scanned PDF.
 *
 * The prompt asks for the text as it stands — headings kept, tables as tables,
 * nothing summarised — because everything downstream (chunking, citation, the
 * precedence rules) depends on the document still being the document.
 */
export async function ocrPdf(
  bytes: Uint8Array,
  options: { maxTokens?: number } = {},
): Promise<OcrResult> {
  if (!assistantAvailable()) {
    throw new ExtractionError('ocrUnavailable', 'No Anthropic key configured for OCR')
  }

  const message = await anthropic().messages.create({
    model: assistantModel(),
    max_tokens: options.maxTokens ?? 16_000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: Buffer.from(bytes).toString('base64'),
            },
          },
          {
            type: 'text',
            text: [
              'Transcribe this document exactly as it stands.',
              'Keep the headings, the numbering of articles and sections, and any tables (as markdown tables).',
              'Do not summarise, do not comment, do not translate.',
              'Start each page with a line of the form "<!-- page: N -->".',
            ].join('\n'),
          },
        ],
      },
    ],
  })

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

  if (text.trim().length === 0) {
    throw new ExtractionError('ocrEmpty', 'The model returned no text for this document')
  }

  return {
    pages: splitPages(text),
    tokensIn: message.usage.input_tokens,
    tokensOut: message.usage.output_tokens,
  }
}

/** Splits the transcription back into pages on the markers we asked for. */
export function splitPages(text: string): TextPage[] {
  const marker = /<!--\s*page:\s*(\d+)\s*-->/g
  const pages: TextPage[] = []

  let match = marker.exec(text)
  if (!match) return [{ page: 1, text }]

  while (match) {
    const page = Number(match[1])
    const start = match.index + match[0].length
    const next = marker.exec(text)
    pages.push({ page, text: text.slice(start, next ? next.index : undefined).trim() })
    match = next
  }

  return pages.filter((page) => page.text.length > 0)
}
