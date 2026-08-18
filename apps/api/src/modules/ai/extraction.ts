/**
 * Reading a regulation into a configuration proposal.
 *
 * Three decisions shape this file, and all three come from what the feature is
 * actually for — being able to walk back from a rule to the article behind it:
 *
 * **The document goes in whole.** Not retrieved in fragments. A table of
 * categories only means something next to the paragraph that introduces it,
 * and "240" in isolation is a number without a subject. The document is the
 * first content block with a cache breakpoint, so the eight blocks that follow
 * read the same bytes and are billed for them once.
 *
 * **One call per block.** A and B and C separately, each its own job, each
 * retriable. A single call covering forty parameters is worse at all of them,
 * and a failure halfway through loses everything.
 *
 * **The output is forced through a tool schema** and then validated again with
 * Zod on arrival. Whatever does not validate is dropped in silence — a
 * half-parsed proposal in front of somebody about to press "accept" is worse
 * than no proposal at all.
 */
import type { PrismaClient } from '@uacademic/db'
import {
  type CenterSettings,
  type ExtractionBlock,
  type ReviewResult,
  SETTING_PARAMS,
  paramsOfBlock,
  reviewProposals,
} from '@uacademic/shared'
import type Anthropic from '@anthropic-ai/sdk'

import { anthropic, assistantAvailable, assistantModel } from './client.js'

const TOOL_NAME = 'record_parameters'

/**
 * What the model is allowed to say. `proposed_value` accepts anything JSON so
 * a collection (the categories, the reductions) can come back whole; the shape
 * is checked against the settings schema afterwards, not here.
 */
function extractionTool(block: ExtractionBlock): Anthropic.Tool {
  const keys = paramsOfBlock(block).map((param) => param.key)

  return {
    name: TOOL_NAME,
    description:
      'Record one entry per parameter of this block. Use null for proposed_value ' +
      'when the document does not state it, and never guess a plausible number.',
    input_schema: {
      type: 'object',
      properties: {
        proposals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', enum: keys },
              proposed_value: {
                description:
                  'The value exactly as the document states it, in the unit given. ' +
                  'null when the document does not state it.',
              },
              unit: { type: 'string' },
              citation: {
                type: 'object',
                properties: {
                  page: { type: 'integer' },
                  section: {
                    type: 'string',
                    description: 'Article or section number, as the document names it.',
                  },
                  quote: {
                    type: 'string',
                    description:
                      'The literal sentence from the document, copied verbatim. ' +
                      'Never paraphrased, never reconstructed.',
                  },
                },
                required: ['quote'],
              },
              reasoning: { type: 'string' },
              exception_note: {
                type: 'string',
                description:
                  'The text of any exception attached to the rule ("except when…"), ' +
                  'copied from the document.',
              },
            },
            required: ['key', 'proposed_value'],
          },
        },
      },
      required: ['proposals'],
    },
  }
}

const RULES = [
  'You are reading one center’s teaching regulation to fill in its configuration.',
  '',
  'Absolute rules:',
  '1. Every value you propose must be supported by a literal quote copied from the',
  '   document. Copy the sentence exactly as written — do not paraphrase, do not',
  '   translate it, do not tidy it up. The quote is checked against the document',
  '   and a proposal whose quote is not found there is thrown away.',
  '2. If the document does not state a parameter, return it with proposed_value',
  '   null and say why in reasoning. Never infer a plausible figure from custom,',
  '   from another article, or from what universities usually do. A wrong number',
  '   that looks right is the worst possible outcome of this task.',
  '3. If two articles give different values for the same parameter, return both as',
  '   separate entries with their own quotes. Do not choose between them.',
  '4. If a rule carries an exception ("except in the case of…"), copy that text',
  '   into exception_note, even when it cannot be expressed as a number.',
  '5. Give the page number the quote appears on, and the article or section as the',
  '   document names it.',
  '',
  'Use the exact parameter keys given to you. Values are in the units stated: do',
  'not convert credits to hours or hours to percentages yourself.',
].join('\n')

function blockBrief(block: ExtractionBlock): string {
  const params = paramsOfBlock(block)

  return [
    `Block ${block}. Look only for these parameters:`,
    '',
    ...params.map((param) => {
      const unit = param.unit ? ` — unit: ${param.unit}` : ''
      return `- ${param.key} (${param.kind})${unit}`
    }),
    '',
    'Return one entry per parameter above, including the ones the document does',
    'not answer (with proposed_value null).',
    collectionHint(params.map((param) => param.key)),
  ]
    .filter(Boolean)
    .join('\n')
}

/** Collections need their shape spelled out; the scalars speak for themselves. */
function collectionHint(keys: readonly string[]): string {
  if (keys.includes('categories')) {
    return [
      '',
      'For `categories`, propose the whole list at once, as an array of objects:',
      '{ "code": "associat-6-6", "label": "Associat 6+6", "baseCapacityHours": 180,',
      '  "maxTeachingHours": 180, "mapsTo": "adjunct" | null, "notes": string | null }.',
      'Keep the center’s own denominations; do not translate them into other names.',
    ].join('\n')
  }
  if (keys.includes('reductions')) {
    return [
      '',
      'For `reductions`, propose the whole catalogue at once, as an array of objects:',
      '{ "code": "coordinacio-titulacio", "label": "Coordinació de titulació",',
      '  "hours": 60 | null, "credits": number | null, "maxHours": number | null,',
      '  "stackable": boolean, "approvedBy": "department" | "faculty" | "coordination"',
      '  | "union" | "rectorate" | "other", "notes": string | null }.',
    ].join('\n')
  }
  if (keys.includes('academicCalendar.examPeriods')) {
    return [
      '',
      'Dates are YYYY-MM-DD. `academicCalendar.examPeriods` is an array of',
      '{ "label": string, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } and',
      '`academicCalendar.holidays` an array of { "label": string, "date": "YYYY-MM-DD" }.',
    ].join('\n')
  }
  return ''
}

export interface ExtractInput {
  block: ExtractionBlock
  documentId: string
  documentTitle: string
  documentText: string
  current: CenterSettings
  manualKeys: readonly string[]
  maxOutputTokens?: number
}

export interface ExtractResult extends ReviewResult {
  tokensIn: number
  tokensOut: number
}

export function extractionAvailable(): boolean {
  return assistantAvailable()
}

/**
 * One block, one call. Returns only what survived validation — the caller
 * never sees the model's raw answer, and neither does anybody else.
 */
export async function extractBlock(input: ExtractInput): Promise<ExtractResult> {
  const client = anthropic()

  const response = await client.messages.create({
    model: assistantModel(),
    max_tokens: input.maxOutputTokens ?? 8_000,
    system: RULES,
    tools: [extractionTool(input.block)],
    // The answer is the tool call. Nothing else is wanted, and prose here
    // would only be a place for an unsupported claim to hide.
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Document: ${input.documentTitle}\n\n${input.documentText}`,
            // The breakpoint: eight blocks read this same prefix.
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: blockBrief(input.block) },
        ],
      },
    ],
  })

  const call = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === TOOL_NAME,
  )

  const raw = Array.isArray((call?.input as { proposals?: unknown[] })?.proposals)
    ? ((call?.input as { proposals: unknown[] }).proposals ?? [])
    : []

  const review = reviewProposals(raw, {
    block: input.block,
    documentId: input.documentId,
    documentText: input.documentText,
    current: input.current,
    manualKeys: input.manualKeys,
  })

  return {
    ...review,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
  }
}

/** The document as it was indexed, which is what the quotes are checked against. */
export async function documentText(
  client: PrismaClient,
  documentId: string,
): Promise<{ title: string; text: string } | null> {
  const document = await client.document.findUnique({
    where: { id: documentId },
    select: { title: true },
  })
  if (!document) return null

  const chunks = await client.documentChunk.findMany({
    where: { documentId },
    select: { content: true },
    orderBy: { ordinal: 'asc' },
    take: 2_000,
  })

  return { title: document.title, text: chunks.map((chunk) => chunk.content).join('\n\n') }
}

/** Every parameter the catalogue knows, for the summary of what is left. */
export const ALL_PARAM_KEYS: readonly string[] = SETTING_PARAMS.map((param) => param.key)
