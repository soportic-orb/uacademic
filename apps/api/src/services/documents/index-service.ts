/**
 * From an uploaded file to something the assistant can cite.
 *
 * `uploaded → processing → indexed`, or `failed` with a reason written for a
 * person: "this PDF is a scan and has no text to read", not a stack trace. The
 * status is what the manager screen shows, and it is the only place the
 * pipeline reports progress, so there is one truth about where a document is.
 */
import { chunkPages, parseCenterSettings } from '@uacademic/shared'
import type { TextPage } from '@uacademic/shared'

import { toJson } from '../../lib/json.js'
import type { PrismaClient } from '../../lib/prisma.js'
import { embeddingProvider, toBlob } from './embeddings.js'
import { ExtractionError, extractText } from './extract.js'
import { ocrPdf } from './ocr.js'
import { readDocument } from './storage.js'

export interface IndexResult {
  status: 'indexed' | 'failed' | 'needs_ocr'
  chunks: number
  tokens: number
  pageCount: number
  method: string
  errorKey?: string
}

/**
 * Indexes one document.
 *
 * `useOcr` is never assumed: a scanned PDF stops with `needs_ocr` and waits
 * for somebody to agree to the cost. That is the whole reason this returns a
 * status instead of throwing.
 */
export async function indexDocument(
  client: PrismaClient,
  documentId: string,
  options: { useOcr?: boolean } = {},
): Promise<IndexResult> {
  const document = await client.document.findUnique({ where: { id: documentId } })
  if (!document) throw new Error(`Document ${documentId} not found`)

  const center = await client.center.findUnique({ where: { id: document.centerId } })
  const settings = parseCenterSettings(center?.settingsJson).documents

  await client.document.update({
    where: { id: document.id },
    data: { status: 'processing', errorKey: null, errorDetail: null },
  })

  try {
    const bytes = await readDocument(document.centerId, document.id)
    const extracted = await extractText(bytes, document.mime, document.title)

    let pages: TextPage[] = extracted.pages
    let method: string = extracted.method

    if (extracted.needsOcr) {
      if (!options.useOcr) {
        await client.document.update({
          where: { id: document.id },
          data: {
            status: 'failed',
            errorKey: 'needsOcr',
            errorDetail: null,
            pageCount: extracted.pageCount,
          },
        })
        return {
          status: 'needs_ocr',
          chunks: 0,
          tokens: 0,
          pageCount: extracted.pageCount,
          method,
          errorKey: 'needsOcr',
        }
      }

      if (!settings.allowVisionOcr) {
        return fail(client, document.id, 'ocrDisabled', null, extracted.pageCount)
      }
      if (extracted.pageCount > settings.visionOcrMaxPages) {
        return fail(client, document.id, 'ocrTooLong', null, extracted.pageCount)
      }

      const ocr = await ocrPdf(bytes)
      pages = ocr.pages
      method = 'vision'
    }

    const chunks = chunkPages(pages, {
      maxTokens: settings.chunkTokens,
      overlapTokens: settings.chunkOverlapTokens,
    })

    if (chunks.length === 0)
      return fail(client, document.id, 'emptyDocument', null, extracted.pageCount)

    const provider = await embeddingProvider()
    const vectors = await provider.embed(chunks.map((chunk) => chunk.content))

    // Re-indexing replaces: a document has one current set of fragments, and
    // half-old ones would be quoted as if they were current.
    await client.documentChunk.deleteMany({ where: { documentId: document.id } })

    for (const [index, chunk] of chunks.entries()) {
      const vector = vectors[index]

      await client.documentChunk.create({
        data: {
          documentId: document.id,
          centerId: document.centerId,
          ordinal: chunk.ordinal,
          headingPath: chunk.headingPath,
          pageFrom: chunk.pageFrom,
          pageTo: chunk.pageTo,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          ...(vector ? { embedding: toBlob(vector), embeddingModel: provider.id } : {}),
        },
      })
    }

    const tokens = chunks.reduce((total, chunk) => total + chunk.tokenCount, 0)

    await client.document.update({
      where: { id: document.id },
      data: {
        status: 'indexed',
        errorKey: null,
        errorDetail: null,
        pageCount: extracted.pageCount,
        chunkCount: chunks.length,
        tokenCount: tokens,
        extractedWith: method,
        processedAt: new Date(),
      },
    })

    return {
      status: 'indexed',
      chunks: chunks.length,
      tokens,
      pageCount: extracted.pageCount,
      method,
    }
  } catch (error) {
    const key = error instanceof ExtractionError ? error.messageKey : 'processingFailed'
    return fail(
      client,
      document.id,
      key,
      error instanceof Error ? error.message : String(error),
      null,
    )
  }
}

async function fail(
  client: PrismaClient,
  documentId: string,
  errorKey: string,
  detail: string | null,
  pageCount: number | null,
): Promise<IndexResult> {
  await client.document.update({
    where: { id: documentId },
    data: {
      status: 'failed',
      errorKey,
      // The detail is for an administrator reading the record, never the
      // message a coordinator is shown: that one comes from the i18n key.
      errorDetail: detail?.slice(0, 2_000) ?? null,
      ...(pageCount === null ? {} : { pageCount }),
    },
  })

  return {
    status: 'failed',
    chunks: 0,
    tokens: 0,
    pageCount: pageCount ?? 0,
    method: 'none',
    errorKey,
  }
}

/** Storage a center is using, for the quota check on the next upload. */
export async function usedStorageBytes(client: PrismaClient, centerId: string): Promise<number> {
  const totals = await client.document.aggregate({
    where: { centerId, status: { not: 'archived' } },
    _sum: { sizeBytes: true },
  })

  return Number(totals._sum.sizeBytes ?? 0)
}

export function documentSummary(document: {
  id: string
  title: string
  scope: string
  scopeId: string | null
  type: string
  status: string
  errorKey: string | null
  language: string
  visibility: string
  academicYearId: string | null
  validFrom: Date | null
  validTo: Date | null
  sizeBytes: bigint
  mime: string
  pageCount: number | null
  chunkCount: number | null
  tokenCount: number | null
  extractedWith: string | null
  createdAt: Date
  processedAt: Date | null
}) {
  return {
    id: document.id,
    title: document.title,
    scope: document.scope,
    scopeId: document.scopeId,
    type: document.type,
    status: document.status,
    errorKey: document.errorKey,
    language: document.language,
    visibility: document.visibility,
    academicYearId: document.academicYearId,
    validFrom: document.validFrom?.toISOString().slice(0, 10) ?? null,
    validTo: document.validTo?.toISOString().slice(0, 10) ?? null,
    sizeBytes: Number(document.sizeBytes),
    mime: document.mime,
    pageCount: document.pageCount,
    chunkCount: document.chunkCount,
    tokenCount: document.tokenCount,
    extractedWith: document.extractedWith,
    createdAt: document.createdAt.toISOString(),
    processedAt: document.processedAt?.toISOString() ?? null,
  }
}

export function toJsonValue(value: unknown) {
  return toJson(value)
}
