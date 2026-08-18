/**
 * How the assistant is given the center's own documents.
 *
 * The strategy is hybrid, and the common case is the simple one: a teaching
 * plan is fifteen to thirty pages, so the whole thing goes into the context
 * with a cache breakpoint on it. The model then sees the numbering, the tables
 * and the order of the articles — not five fragments that happened to match —
 * and the second question about the same subject costs a tenth of the first.
 *
 * Only when the relevant documents no longer fit does retrieval take over:
 * hybrid search (vectors plus MySQL full text, fused with RRF) over the same
 * allow-list of documents, which is already filtered by tenant, academic year
 * and what is actually in force.
 *
 * Either way the rules the model is given are the same, and they are the point
 * of the phase: cite or say you do not know, and name a contradiction instead
 * of resolving it quietly.
 */
import type Anthropic from '@anthropic-ai/sdk'
import {
  type Citation,
  type DocumentRef,
  formatCitation,
  precedenceNotes,
  shouldInjectFully,
} from '@uacademic/shared'

import { prisma } from '../../lib/prisma.js'
import {
  citationOf,
  relevantDocuments,
  searchDocuments,
} from '../../services/documents/retrieval.js'
import type { AiContext } from './context.js'

export interface DocumentContext {
  /** Blocks to prepend to the conversation, cached where it pays to. */
  blocks: Anthropic.TextBlockParam[]
  /** What was actually consulted, for `documents_used_json` and the UI chips. */
  used: { documentId: string; title: string; scope: string; chunkIds: string[] }[]
  citations: Citation[]
  strategy: 'none' | 'injected' | 'retrieved'
  tokens: number
}

const EMPTY: DocumentContext = {
  blocks: [],
  used: [],
  citations: [],
  strategy: 'none',
  tokens: 0,
}

/**
 * The rules of using a document, given to the model with the documents.
 *
 * They are stated as flatly as possible: in a normative context an answer
 * without a source is worth nothing, and a model that guesses which of two
 * regulations wins is worse than one that says they disagree.
 */
export function documentRules(): string {
  return [
    'You have been given documents from this center. Rules for using them:',
    '- Every statement that rests on a document must name it and the page or section it came from, like this: [doc:<id>|<title>, p. <page>].',
    '- If the documents do not answer the question, say you cannot find it in them. Never infer a rule that is not written down.',
    '- Where two documents disagree, the more specific scope wins (subject > degree > center > university) and, at the same scope, the one most recently in force. Say out loud that they disagree and which one you are following. Do not resolve it silently.',
    '- Documents that are out of force are not given to you at all. If somebody asks about an old rule, say you only see what is currently in force.',
  ].join('\n')
}

/**
 * Builds the document half of the context for one question.
 *
 * `question` is only used when retrieval is needed — the injected path does
 * not need to guess what matters, which is exactly why it answers better.
 */
export async function buildDocumentContext(
  context: AiContext,
  question: string,
): Promise<DocumentContext> {
  const settings = context.settings.documents

  const documents = await relevantDocuments({
    client: prisma(),
    centerId: context.centerId,
    academicYearId: context.academicYearId,
    subjectId: context.subjectId,
  })

  if (documents.length === 0) return EMPTY

  const totalTokens = documents.reduce((total, document) => total + (document.tokenCount ?? 0), 0)

  return shouldInjectFully(totalTokens, settings.injectionTokenBudget)
    ? injectWhole(documents, totalTokens)
    : retrieve(context, documents, question, settings.retrievalChunks)
}

/** Everything, in order of precedence, with a cache breakpoint at the end. */
async function injectWhole(
  documents: (DocumentRef & { tokenCount: number | null })[],
  totalTokens: number,
): Promise<DocumentContext> {
  const chunks = await prisma().documentChunk.findMany({
    where: { documentId: { in: documents.map((document) => document.id) } },
    select: {
      id: true,
      documentId: true,
      ordinal: true,
      content: true,
      headingPath: true,
      pageFrom: true,
    },
    orderBy: [{ documentId: 'asc' }, { ordinal: 'asc' }],
    take: 4_000,
  })

  const used: DocumentContext['used'] = []
  const citations: Citation[] = []
  const parts: string[] = []

  for (const document of documents) {
    const own = chunks.filter((chunk) => chunk.documentId === document.id)
    if (own.length === 0) continue

    used.push({
      documentId: document.id,
      title: document.title,
      scope: document.scope,
      chunkIds: own.map((chunk) => chunk.id),
    })

    parts.push(
      [
        `<document id="${document.id}" scope="${document.scope}" title="${escapeAttribute(document.title)}"` +
          ` valid_from="${document.validFrom?.toISOString().slice(0, 10) ?? ''}"` +
          ` valid_to="${document.validTo?.toISOString().slice(0, 10) ?? ''}">`,
        ...own.map((chunk) =>
          [
            `<fragment page="${chunk.pageFrom ?? ''}" section="${escapeAttribute(chunk.headingPath ?? '')}">`,
            chunk.content,
            '</fragment>',
          ].join('\n'),
        ),
        '</document>',
      ].join('\n'),
    )

    citations.push({
      documentId: document.id,
      title: document.title,
      page: own[0]?.pageFrom ?? null,
      section: own[0]?.headingPath ?? null,
      chunkId: own[0]?.id ?? null,
    })
  }

  if (parts.length === 0) return EMPTY

  const notes = precedenceNotes(documents)

  return {
    blocks: [
      {
        type: 'text',
        text: [
          documentRules(),
          notes.length > 0
            ? `Documents of different scope are present; if they disagree, ${describeNotes(documents)}.`
            : '',
          '',
          parts.join('\n\n'),
        ]
          .filter(Boolean)
          .join('\n'),
        // The documents are the stable prefix of every question about this
        // subject: caching them is what makes the second question cheap.
        cache_control: { type: 'ephemeral' },
      },
    ],
    used,
    citations,
    strategy: 'injected',
    tokens: totalTokens,
  }
}

/** Above the budget: search, and hand over only what was found. */
async function retrieve(
  context: AiContext,
  documents: DocumentRef[],
  question: string,
  limit: number,
): Promise<DocumentContext> {
  const result = await searchDocuments({
    client: prisma(),
    centerId: context.centerId,
    query: question,
    documents,
    limit,
  })

  if (result.chunks.length === 0) return EMPTY

  const used = new Map<string, DocumentContext['used'][number]>()
  for (const chunk of result.chunks) {
    const entry = used.get(chunk.documentId) ?? {
      documentId: chunk.documentId,
      title: chunk.title,
      scope: documents.find((document) => document.id === chunk.documentId)?.scope ?? 'center',
      chunkIds: [],
    }
    entry.chunkIds.push(chunk.chunkId)
    used.set(chunk.documentId, entry)
  }

  const text = result.chunks
    .map((chunk) =>
      [
        `<fragment doc="${chunk.documentId}" title="${escapeAttribute(chunk.title)}" page="${
          chunk.pageFrom ?? ''
        }" section="${escapeAttribute(chunk.headingPath ?? '')}">`,
        chunk.content,
        '</fragment>',
      ].join('\n'),
    )
    .join('\n\n')

  return {
    blocks: [
      {
        type: 'text',
        text: [
          documentRules(),
          'These are the fragments retrieved for this question. There may be more in the documents; if what you need is not here, say so rather than guessing.',
          '',
          text,
        ].join('\n'),
      },
    ],
    used: [...used.values()],
    citations: result.chunks.map(citationOf),
    strategy: 'retrieved',
    tokens: result.chunks.reduce((total, chunk) => total + Math.ceil(chunk.content.length / 4), 0),
  }
}

function describeNotes(documents: DocumentRef[]): string {
  const notes = precedenceNotes(documents)
  const first = notes[0]
  if (!first) return 'follow the most specific one'

  const winner = documents.find((document) => document.id === first.winnerId)
  return `follow ${winner ? formatCitation({ documentId: winner.id, title: winner.title, page: null, section: null, chunkId: null }) : 'the most specific one'} and say that they differ`
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "'").replace(/[<>]/g, '')
}

/**
 * The citations an answer actually made, parsed back out of it.
 *
 * The model is asked to write `[doc:<id>|<title>, p. 14]`; this turns that into
 * something the UI can render as a chip and a deep link into the viewer. A
 * citation naming a document that was not in the context is dropped: an
 * invented source is worse than none.
 */
export function extractCitations(answer: string, allowed: DocumentContext['used']): Citation[] {
  const pattern = /\[doc:([0-9a-fA-F-]{36})\|([^\]]+)\]/g
  const byId = new Map(allowed.map((entry) => [entry.documentId, entry]))
  const found = new Map<string, Citation>()

  for (const match of answer.matchAll(pattern)) {
    const documentId = match[1] as string
    const entry = byId.get(documentId)
    if (!entry) continue

    const label = (match[2] ?? '').trim()
    const page = /p\.\s*(\d+)/i.exec(label)?.[1]

    const key = `${documentId}:${page ?? label}`
    if (found.has(key)) continue

    found.set(key, {
      documentId,
      title: entry.title,
      page: page ? Number(page) : null,
      section: page ? null : label.replace(/^[^,]*,\s*/, '') || null,
      chunkId: entry.chunkIds[0] ?? null,
    })
  }

  return [...found.values()]
}
