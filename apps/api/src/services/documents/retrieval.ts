/**
 * Finding the passage an answer may rest on.
 *
 * Two searches, always both. The vector half answers "how much may I reduce
 * someone's load"; the full-text half answers "article 14", "240 hores",
 * "professorat associat" — the exact strings a normative question is actually
 * made of, and the ones semantic search quietly misses. Reciprocal rank fusion
 * merges the two orders without pretending their scores are comparable.
 *
 * The vectors live in memory, per center, behind a small LRU. At the real
 * scale of this product — two to twenty thousand fragments in a center — a
 * brute-force cosine pass is microseconds, and a vector database would be one
 * more thing to install on a shared host for no gain (CLAUDE.md §2).
 */
import {
  type Citation,
  type DocumentRef,
  type ScoredChunk,
  cosineSimilarity,
  reciprocalRankFusion,
  selectRelevant,
} from '@uacademic/shared'

import type { PrismaClient } from '../../lib/prisma.js'
import { embeddingProvider, fromBlob } from './embeddings.js'

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  title: string
  content: string
  headingPath: string | null
  pageFrom: number | null
  pageTo: number | null
  score: number
}

interface CachedVector {
  chunkId: string
  documentId: string
  vector: Float32Array
}

interface CacheEntry {
  centerId: string
  model: string
  vectors: CachedVector[]
  loadedAt: number
}

/** Small on purpose: one entry per center, and a center is a whole tenant. */
const CACHE_LIMIT = 8
const CACHE_TTL_MS = 10 * 60_000

const cache = new Map<string, CacheEntry>()

export function invalidateVectorCache(centerId?: string): void {
  if (centerId) cache.delete(centerId)
  else cache.clear()
}

async function vectorsFor(client: PrismaClient, centerId: string): Promise<CacheEntry> {
  const cached = cache.get(centerId)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    // Touching it moves it to the end: plain LRU on a Map's insertion order.
    cache.delete(centerId)
    cache.set(centerId, cached)
    return cached
  }

  const rows = await client.documentChunk.findMany({
    where: { centerId, embedding: { not: null }, document: { status: 'indexed' } },
    select: { id: true, documentId: true, embedding: true, embeddingModel: true },
    take: 50_000,
  })

  const entry: CacheEntry = {
    centerId,
    model: rows[0]?.embeddingModel ?? 'none',
    vectors: rows
      .filter((row) => row.embedding)
      .map((row) => ({
        chunkId: row.id,
        documentId: row.documentId,
        vector: fromBlob(row.embedding as Uint8Array),
      })),
    loadedAt: Date.now(),
  }

  cache.set(centerId, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }

  return entry
}

export interface SearchInput {
  client: PrismaClient
  centerId: string
  query: string
  /** Documents already narrowed by tenant, year, validity and precedence. */
  documents: readonly DocumentRef[]
  limit?: number
}

export interface SearchResult {
  chunks: RetrievedChunk[]
  /** Which halves actually contributed, for the honest answer to "how?". */
  usedVector: boolean
  usedFullText: boolean
  model: string
}

/**
 * The hybrid search.
 *
 * `documents` is the allow-list: it has already been filtered by tenant, by
 * academic year and by what is in force, and nothing outside it can be
 * returned. A retrieval that could reach another center's regulations would be
 * a tenancy breach dressed as a feature.
 */
export async function searchDocuments(input: SearchInput): Promise<SearchResult> {
  const limit = input.limit ?? 12
  const allowed = new Set(input.documents.map((document) => document.id))
  if (allowed.size === 0) {
    return { chunks: [], usedVector: false, usedFullText: false, model: 'none' }
  }

  const [vectorRanking, fullTextRanking] = await Promise.all([
    vectorSearch(input, allowed, limit * 3),
    fullTextSearch(input, allowed, limit * 3),
  ])

  const fused = reciprocalRankFusion([vectorRanking.ranking, fullTextRanking], { limit })
  if (fused.length === 0) {
    return {
      chunks: [],
      usedVector: vectorRanking.ranking.length > 0,
      usedFullText: fullTextRanking.length > 0,
      model: vectorRanking.model,
    }
  }

  const rows = await input.client.documentChunk.findMany({
    where: { id: { in: fused.map((entry) => entry.chunkId) }, centerId: input.centerId },
    include: { document: { select: { id: true, title: true } } },
  })

  const byId = new Map(rows.map((row) => [row.id, row]))

  return {
    chunks: fused.flatMap((entry) => {
      const row = byId.get(entry.chunkId)
      if (!row) return []

      return [
        {
          chunkId: row.id,
          documentId: row.documentId,
          title: row.document.title,
          content: row.content,
          headingPath: row.headingPath,
          pageFrom: row.pageFrom,
          pageTo: row.pageTo,
          score: entry.score,
        },
      ]
    }),
    usedVector: vectorRanking.ranking.length > 0,
    usedFullText: fullTextRanking.length > 0,
    model: vectorRanking.model,
  }
}

async function vectorSearch(
  input: SearchInput,
  allowed: Set<string>,
  limit: number,
): Promise<{ ranking: ScoredChunk[]; model: string }> {
  const entry = await vectorsFor(input.client, input.centerId)
  if (entry.vectors.length === 0) return { ranking: [], model: entry.model }

  const provider = await embeddingProvider()
  const [queryVector] = await provider.embed([input.query])
  if (!queryVector) return { ranking: [], model: entry.model }

  const ranking = entry.vectors
    .filter((vector) => allowed.has(vector.documentId))
    // A stored vector from another model is not comparable with this query's.
    .filter((vector) => vector.vector.length === queryVector.length)
    .map((vector) => ({
      chunkId: vector.chunkId,
      score: cosineSimilarity(queryVector, vector.vector),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return { ranking, model: entry.model }
}

/**
 * MySQL's own full-text index, in boolean mode so a quoted phrase and a bare
 * number both work. It is the half that finds "article 14".
 */
async function fullTextSearch(
  input: SearchInput,
  allowed: Set<string>,
  limit: number,
): Promise<ScoredChunk[]> {
  const terms = booleanQuery(input.query)
  if (!terms) return []

  const rows = await input.client.documentChunk.findMany({
    where: {
      centerId: input.centerId,
      documentId: { in: [...allowed] },
      content: { search: terms },
    },
    select: { id: true },
    take: limit,
  })

  // Prisma returns full-text matches in relevance order; the rank is what RRF
  // needs, and the raw score would not be comparable with a cosine anyway.
  return rows.map((row, index) => ({ chunkId: row.id, score: 1 / (index + 1) }))
}

/** Words and numbers only: the operators MySQL would choke on are dropped. */
export function booleanQuery(query: string): string {
  const words = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3)
    .slice(0, 12)

  return words.join(' ')
}

/** The citation a retrieved fragment supports. */
export function citationOf(chunk: RetrievedChunk): Citation {
  return {
    documentId: chunk.documentId,
    title: chunk.title,
    page: chunk.pageFrom,
    section: chunk.headingPath,
    chunkId: chunk.chunkId,
  }
}

/**
 * The documents this question may draw on: this center's, this year's, in
 * force today, narrowed to the subject in hand and ordered by precedence.
 */
export async function relevantDocuments(input: {
  client: PrismaClient
  centerId: string
  academicYearId: string | null
  subjectId?: string | null
  degreeIds?: readonly string[]
}): Promise<(DocumentRef & { tokenCount: number | null })[]> {
  const rows = await input.client.document.findMany({
    where: { centerId: input.centerId, status: 'indexed' },
    select: {
      id: true,
      title: true,
      scope: true,
      scopeId: true,
      type: true,
      academicYearId: true,
      validFrom: true,
      validTo: true,
      tokenCount: true,
    },
    take: 500,
  })

  const scoped = rows.map((row) => ({
    ...row,
    scope: row.scope as DocumentRef['scope'],
    type: row.type as DocumentRef['type'],
  }))

  return selectRelevant(scoped, {
    academicYearId: input.academicYearId,
    // A subject-scoped document is only relevant to its own subject; wider
    // scopes carry no scopeId and pass through.
    ...(input.subjectId || input.degreeIds
      ? { scopeIds: [...(input.subjectId ? [input.subjectId] : []), ...(input.degreeIds ?? [])] }
      : {}),
  })
}
