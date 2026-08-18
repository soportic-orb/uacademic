/**
 * The rules that govern documents: which one wins, when it stops counting,
 * how it is cut into pieces, and how those pieces are found again.
 *
 * All of it is pure (R7). The API stores files and talks to the model; what
 * decides *which* text a normative answer may rest on lives here, with tests,
 * because "the assistant quoted the 2024 plan at me" is not a bug anybody
 * should have to discover in production.
 */

export type DocumentScope = 'university' | 'center' | 'degree' | 'subject'

export const DOCUMENT_SCOPES: readonly DocumentScope[] = [
  'university',
  'center',
  'degree',
  'subject',
]

export type DocumentType =
  'regulation' | 'teaching_plan' | 'agreement' | 'guide' | 'minutes' | 'other'

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'regulation',
  'teaching_plan',
  'agreement',
  'guide',
  'minutes',
  'other',
]

/**
 * Who the document is for. `ai_only` means exactly that: the assistant reads
 * it, no repository entry, no teacher browsing it. `center` also publishes it
 * to the people it concerns.
 */
export type DocumentAudience = 'ai_only' | 'center'

export type DocumentStatus = 'uploaded' | 'processing' | 'indexed' | 'failed' | 'archived'

export interface DocumentRef {
  id: string
  title: string
  scope: DocumentScope
  scopeId: string | null
  type: DocumentType
  academicYearId: string | null
  validFrom: Date | null
  validTo: Date | null
}

/* ─────────────────────────── precedence ─────────────────────────── */

/**
 * The more specific the scope, the louder it speaks: a subject's own teaching
 * plan overrides the degree's memorandum, which overrides the center's
 * criteria, which overrides the university's framework.
 */
export function scopeRank(scope: DocumentScope): number {
  return { university: 1, center: 2, degree: 3, subject: 4 }[scope]
}

/**
 * Documents in the order the assistant must weigh them: most specific first,
 * and among equals the one that came into force most recently.
 */
export function byPrecedence<T extends DocumentRef>(documents: readonly T[]): T[] {
  return [...documents].sort((a, b) => {
    const rank = scopeRank(b.scope) - scopeRank(a.scope)
    if (rank !== 0) return rank

    const from = (b.validFrom?.getTime() ?? 0) - (a.validFrom?.getTime() ?? 0)
    if (from !== 0) return from

    return a.title.localeCompare(b.title)
  })
}

export interface PrecedenceNote {
  winnerId: string
  loserId: string
  /** i18n key under `documents.precedence.`. */
  messageKey: string
  params: Record<string, string | number>
}

/**
 * Where two documents of different weight cover the same ground, this is what
 * the assistant is told to say out loud. It never resolves a contradiction
 * silently: it names both documents and which one prevails, and the reader
 * decides whether the older one was supposed to be withdrawn.
 */
export function precedenceNotes<T extends DocumentRef>(documents: readonly T[]): PrecedenceNote[] {
  const ordered = byPrecedence(documents)
  const notes: PrecedenceNote[] = []

  for (let index = 1; index < ordered.length; index += 1) {
    const winner = ordered[0]!
    const loser = ordered[index]!
    if (
      winner.scope === loser.scope &&
      winner.validFrom?.getTime() === loser.validFrom?.getTime()
    ) {
      continue
    }

    notes.push({
      winnerId: winner.id,
      loserId: loser.id,
      messageKey:
        winner.scope === loser.scope
          ? 'documents.precedence.newer'
          : 'documents.precedence.moreSpecific',
      params: { winner: winner.title, loser: loser.title, scope: winner.scope },
    })
  }

  return notes
}

/* ─────────────────────────── validity ─────────────────────────── */

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Whether a document counts on a given date.
 *
 * This is the rule that keeps a 2024-25 teaching plan out of a 2026-27
 * decision. An open end date means "still in force"; an open start means it
 * always was.
 */
export function isInForce(document: DocumentRef, onDate: Date = new Date()): boolean {
  const day = startOfDay(onDate)

  if (document.validFrom && day < startOfDay(document.validFrom)) return false
  if (document.validTo && day > startOfDay(document.validTo)) return false
  return true
}

/**
 * Expired means its end date has passed — not merely "not in force today".
 * Next year's regulation, filed in August, is not expired: it has not started.
 * Calling that expiry would paint the newest document in the library red.
 */
export function isExpired(document: DocumentRef, onDate: Date = new Date()): boolean {
  if (!document.validTo) return false
  return startOfDay(onDate) > startOfDay(document.validTo)
}

/** Documents whose validity runs out within `days`, so the UI can warn early. */
export function expiresWithin(
  document: DocumentRef,
  days: number,
  onDate: Date = new Date(),
): boolean {
  if (!document.validTo || isExpired(document, onDate)) return false
  const limit = startOfDay(onDate) + days * 86_400_000
  return startOfDay(document.validTo) <= limit
}

export interface DocumentFilter {
  scope?: DocumentScope | undefined
  scopeIds?: readonly string[] | undefined
  academicYearId?: string | null | undefined
  onDate?: Date | undefined
  /** Drop anything out of force. On by default: that is the whole point. */
  inForceOnly?: boolean | undefined
}

/**
 * The documents that may inform an answer about this subject, this year.
 *
 * Tenant scoping is not here on purpose — it happens in the query, against a
 * client that cannot see another center (R2). This is the second filter, not
 * the first.
 */
export function selectRelevant<T extends DocumentRef>(
  documents: readonly T[],
  filter: DocumentFilter = {},
): T[] {
  const onDate = filter.onDate ?? new Date()

  return byPrecedence(
    documents.filter((document) => {
      if (filter.inForceOnly !== false && !isInForce(document, onDate)) return false

      if (
        filter.academicYearId !== undefined &&
        filter.academicYearId !== null &&
        document.academicYearId !== null &&
        document.academicYearId !== filter.academicYearId
      ) {
        return false
      }

      if (filter.scope && document.scope !== filter.scope) return false

      // A subject-scoped document only speaks about its own subject; a center
      // one speaks about everything under it.
      if (filter.scopeIds && document.scopeId && !filter.scopeIds.includes(document.scopeId)) {
        return false
      }

      return true
    }),
  )
}

/* ─────────────────────────── chunking ─────────────────────────── */

export interface TextPage {
  page: number
  text: string
}

export interface Chunk {
  ordinal: number
  content: string
  tokenCount: number
  /** `1. Dedicacio docent > 1.2 Reduccions`, when the document has headings. */
  headingPath: string | null
  pageFrom: number | null
  pageTo: number | null
}

export interface ChunkOptions {
  maxTokens?: number
  /** Tokens repeated from the previous chunk, so a rule split in two survives. */
  overlapTokens?: number
}

/**
 * Rough token count.
 *
 * Deliberately an estimate: the exact number depends on the model's tokenizer,
 * and everything here — chunk size, the injection budget — is a threshold with
 * slack in it. Four characters per token is close enough for Catalan, Spanish
 * and English prose, and it costs nothing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4)
}

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\s+(\p{Lu}[^\n]{2,80})$/u

interface HeadingMatch {
  level: number
  title: string
}

function headingOf(line: string): HeadingMatch | null {
  const markdown = MARKDOWN_HEADING.exec(line)
  if (markdown) return { level: markdown[1]!.length, title: markdown[2]!.trim() }

  const numbered = NUMBERED_HEADING.exec(line)
  if (numbered) {
    return {
      level: numbered[1]!.split('.').length,
      title: `${numbered[1]} ${numbered[2]}`.trim(),
    }
  }

  return null
}

/**
 * Cuts a document into pieces a model can be given, without cutting a rule in
 * half.
 *
 * Headings are boundaries: an article, a section, a table's caption stay with
 * what they introduce, and every chunk carries the path of headings above it
 * so a citation can say *where* in the document it came from. Consecutive
 * chunks overlap, because the sentence that matters is always the one on the
 * page break.
 */
export function chunkPages(pages: readonly TextPage[], options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? 800
  const overlapTokens = options.overlapTokens ?? Math.round(maxTokens * 0.12)

  interface Line {
    text: string
    page: number
    headingPath: string | null
  }

  const lines: Line[] = []
  const headings: string[] = []

  for (const page of pages) {
    for (const rawLine of page.text.split(/\r?\n/)) {
      const line = rawLine.trimEnd()
      const heading = headingOf(line.trim())

      if (heading) {
        headings.length = Math.max(0, heading.level - 1)
        headings.push(heading.title)
      }

      lines.push({
        text: line,
        page: page.page,
        headingPath: headings.length > 0 ? headings.join(' > ') : null,
      })
    }
  }

  const chunks: Chunk[] = []
  let current: Line[] = []
  let currentTokens = 0

  const flush = (keepOverlap = true) => {
    const content = current
      .map((line) => line.text)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (content.length === 0) {
      current = []
      currentTokens = 0
      return
    }

    chunks.push({
      ordinal: chunks.length,
      content,
      tokenCount: estimateTokens(content),
      headingPath: current[0]?.headingPath ?? null,
      pageFrom: current[0]?.page ?? null,
      pageTo: current.at(-1)?.page ?? null,
    })

    if (!keepOverlap) {
      current = []
      currentTokens = 0
      return
    }

    // The tail of this chunk opens the next one, so a rule split across the
    // boundary survives in both halves.
    const overlap: Line[] = []
    let overlapCount = 0
    for (let index = current.length - 1; index >= 0 && overlapCount < overlapTokens; index -= 1) {
      const line = current[index]!
      overlap.unshift(line)
      overlapCount += estimateTokens(line.text)
    }

    current = overlap
    currentTokens = overlapCount
  }

  for (const line of lines) {
    const tokens = estimateTokens(line.text)
    const opensSection =
      Boolean(headingOf(line.text.trim())) && current.some((entry) => entry.text.trim().length > 0)

    // A heading is a hard boundary: carrying the previous section's tail into
    // it would file one rule under another rule's title.
    if (opensSection) flush(false)
    else if (currentTokens + tokens > maxTokens) flush()

    current.push(line)
    currentTokens += tokens
  }

  const tail = current
    .map((line) => line.text)
    .join('\n')
    .trim()
  // What is left may be only the overlap, which already lives in the last
  // chunk; emitting it again would duplicate a rule rather than preserve it.
  if (tail.length > 0 && !chunks.at(-1)?.content.endsWith(tail)) flush()

  return chunks.map((chunk, ordinal) => ({ ...chunk, ordinal }))
}

/* ─────────────────────────── retrieval ─────────────────────────── */

export interface ScoredChunk {
  chunkId: string
  score: number
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] as number
    const right = b[index] as number
    dot += left * right
    normA += left * left
    normB += right * right
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Reciprocal rank fusion.
 *
 * The vector half and the full-text half disagree, and that is the point:
 * "article 14", "240 hours" and "profesorado asociado" are found by exact
 * matching, while "how much may I reduce someone's load" is found by meaning.
 * RRF merges the two orders without needing their scores to be comparable —
 * which they are not.
 */
export function reciprocalRankFusion(
  rankings: readonly (readonly ScoredChunk[])[],
  options: { k?: number; limit?: number } = {},
): ScoredChunk[] {
  const k = options.k ?? 60
  const totals = new Map<string, number>()

  for (const ranking of rankings) {
    ranking.forEach((entry, index) => {
      totals.set(entry.chunkId, (totals.get(entry.chunkId) ?? 0) + 1 / (k + index + 1))
    })
  }

  const fused = [...totals.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))

  return options.limit ? fused.slice(0, options.limit) : fused
}

/**
 * Whether the relevant documents fit in the context whole.
 *
 * Below the threshold, injecting everything beats retrieval every time: the
 * model sees the tables, the numbering and the order of the articles instead
 * of five fragments that happened to match. Retrieval is what happens when
 * that is no longer affordable, not the default.
 */
export function shouldInjectFully(totalTokens: number, budgetTokens = 150_000): boolean {
  return totalTokens <= budgetTokens
}

/* ─────────────────────────── citation ─────────────────────────── */

export interface Citation {
  documentId: string
  title: string
  /** Page in the original file, when the format has pages. */
  page: number | null
  /** Heading path, for formats that do not. */
  section: string | null
  chunkId: string | null
}

/** `Normativa POD 2026, p. 14` / `Guia docent, 3.2 Avaluacio`. */
export function formatCitation(citation: Citation): string {
  if (citation.page) return `${citation.title}, p. ${citation.page}`
  if (citation.section) return `${citation.title}, ${citation.section}`
  return citation.title
}

/** Deep link into the viewer, at the fragment the answer rests on. */
export function citationHref(citation: Citation): string {
  // The library screen selects through the query string, so a citation is the
  // same URL a reader would have produced by clicking — one canonical form.
  const query = new URLSearchParams({ doc: citation.documentId })
  if (citation.page) query.set('page', String(citation.page))
  if (citation.chunkId) query.set('chunk', citation.chunkId)

  return `/documents?${query.toString()}`
}

/* ─────────────────────────── files ─────────────────────────── */

export interface MimeCheck {
  mime: string | null
  extension: string | null
}

/**
 * What a file actually is, read from its first bytes.
 *
 * The extension is a claim by whoever uploaded it; the magic number is the
 * file. A `.pdf` that is really a zip full of scripts is exactly what this is
 * for, and it costs sixteen bytes to find out.
 */
export function sniffMime(bytes: Uint8Array): MimeCheck {
  const starts = (signature: readonly number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte)

  if (starts([0x25, 0x50, 0x44, 0x46])) return { mime: 'application/pdf', extension: 'pdf' }

  // Both DOCX and XLSX are zips; the caller disambiguates by looking inside.
  if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06])) {
    return { mime: 'application/zip', extension: 'zip' }
  }

  if (starts([0xd0, 0xcf, 0x11, 0xe0])) {
    return { mime: 'application/vnd.ms-office', extension: 'doc' }
  }

  const sample = bytes.slice(0, 512)
  // A control byte in the first half-kilobyte means it is not the text it
  // claims to be. Tabs, newlines and carriage returns are text.
  const binary = sample.some((byte) => byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b))
  if (!binary && sample.length > 0) return { mime: 'text/plain', extension: 'txt' }

  return { mime: null, extension: null }
}

export const ACCEPTED_DOCUMENT_MIMES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
]

export type UploadRejection =
  'unsupportedType' | 'mismatchedType' | 'tooLarge' | 'quotaExceeded' | 'duplicate'

export interface UploadCheckInput {
  declaredMime: string
  sniffed: MimeCheck
  sizeBytes: number
  maxBytes: number
  usedBytes: number
  quotaBytes: number
  /** Checksums already stored for this center. */
  existingChecksums?: readonly string[]
  checksum?: string
}

export interface UploadCheck {
  ok: boolean
  rejection?: UploadRejection
}

/**
 * Everything that must be true before a file is written to disk. Order
 * matters: what the file *is* comes before how big it is, and the duplicate
 * check comes last so an identical re-upload is reported as such rather than
 * as a quota problem.
 */
export function checkUpload(input: UploadCheckInput): UploadCheck {
  if (!ACCEPTED_DOCUMENT_MIMES.includes(input.declaredMime)) {
    return { ok: false, rejection: 'unsupportedType' }
  }

  if (input.sniffed.mime === null) return { ok: false, rejection: 'mismatchedType' }

  const zipBased =
    input.declaredMime.includes('openxmlformats') && input.sniffed.mime === 'application/zip'
  const textBased =
    (input.declaredMime === 'text/plain' || input.declaredMime === 'text/markdown') &&
    input.sniffed.mime === 'text/plain'
  const pdf = input.declaredMime === 'application/pdf' && input.sniffed.mime === 'application/pdf'

  if (!zipBased && !textBased && !pdf) return { ok: false, rejection: 'mismatchedType' }
  if (input.sizeBytes > input.maxBytes) return { ok: false, rejection: 'tooLarge' }
  if (input.usedBytes + input.sizeBytes > input.quotaBytes) {
    return { ok: false, rejection: 'quotaExceeded' }
  }

  if (input.checksum && input.existingChecksums?.includes(input.checksum)) {
    return { ok: false, rejection: 'duplicate' }
  }

  return { ok: true }
}

/* ─────────────────────────── permissions ─────────────────────────── */

export interface UploadPermissionInput {
  scope: DocumentScope
  roles: readonly string[]
  /** Subjects this person coordinates, for the subject scope. */
  coordinatedSubjectIds?: readonly string[]
  scopeId?: string | null
}

/**
 * Who may upload what.
 *
 * The framework belongs to the platform, the center's criteria to its
 * administration, and a subject's teaching plan to whoever actually
 * coordinates *that* subject — not to any coordinator.
 */
export function canUploadDocument(input: UploadPermissionInput): boolean {
  const has = (role: string) => input.roles.includes(role)

  if (has('SUPERADMIN')) return true

  switch (input.scope) {
    case 'university':
      return false
    case 'center':
    case 'degree':
      return has('CENTER_ADMIN')
    case 'subject':
      if (has('CENTER_ADMIN')) return true
      if (!has('COORDINATOR') || !input.scopeId) return false
      return (input.coordinatedSubjectIds ?? []).includes(input.scopeId)
  }
}

/** Whether a document may be listed for somebody browsing the repository. */
export function canReadDocument(input: {
  audience: DocumentAudience
  roles: readonly string[]
}): boolean {
  if (input.audience === 'center') return true
  // `ai_only` is not a repository entry: only whoever manages documents sees
  // it at all, and the assistant reads it on their behalf.
  return input.roles.some((role) => ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR'].includes(role))
}
