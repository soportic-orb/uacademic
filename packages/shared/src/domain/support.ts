/**
 * Cady, the support assistant.
 *
 * She answers questions about how UAcademic works — where a thing is done,
 * what has to happen before it can be, why a screen is empty — and she answers
 * them from written material, never from what a language model happens to
 * believe about academic software. That is the whole design: the corpus is
 * assembled here, it goes into the prompt whole, and the instruction is that
 * anything outside it is declined rather than guessed at.
 *
 * She is not the coordination assistant. That one reads the center's data and
 * proposes changes to the timetable, and is coordination's alone (R5); Cady
 * reads nothing, writes nothing, and is open to everybody.
 */
import { type AppLocale, catalogs } from '../i18n/index.js'
import type { Role } from '../schemas/common.js'
import { GUIDE_STEPS } from './guide.js'

export const CADY_MAX_QUESTION = 2_000

export interface SupportArticleContent {
  title: string
  body: string
}

export interface SupportArticleEntry {
  slug: string
  roles: readonly Role[]
  enabled: boolean
  /** All three languages, always (R1). */
  content: Record<AppLocale, SupportArticleContent>
}

export interface SupportCorpusInput {
  role: Role
  locale: AppLocale
  articles: readonly SupportArticleEntry[]
}

interface GuideText {
  title?: unknown
  body?: unknown
}

/** The guide, in one language, as prose rather than as i18n keys. */
function guideSection(role: Role, locale: AppLocale): string {
  const steps = (catalogs[locale] as unknown as { guide?: { steps?: Record<string, GuideText> } })
    .guide?.steps

  return GUIDE_STEPS.filter((step) => step.roles.includes(role))
    .map((step, index) => {
      const text = steps?.[step.key]
      const title = typeof text?.title === 'string' ? text.title : step.key
      const body = typeof text?.body === 'string' ? text.body : ''
      const where = step.to ? ` (${step.to})` : ''
      return `${index + 1}. ${title}${where}\n${body}`
    })
    .join('\n\n')
}

function articleSection(input: SupportCorpusInput): string {
  return input.articles
    .filter((article) => article.enabled && article.roles.includes(input.role))
    .map((article) => {
      const text = article.content[input.locale]
      return `## ${text.title}\n${text.body}`
    })
    .join('\n\n')
}

const SECTION_TITLES = {
  guide: { ca: 'Guia pas a pas', es: 'Guía paso a paso', en: 'Step-by-step guide' },
  articles: { ca: "Articles d'ajuda", es: 'Artículos de ayuda', en: 'Help articles' },
} as const

/**
 * Everything Cady may answer from, for one person.
 *
 * Filtered by role on purpose: telling a lecturer how to open an academic year
 * is not help, it is a wrong turn into a screen they cannot open.
 */
export function supportCorpus(input: SupportCorpusInput): string {
  const parts = [
    `# ${SECTION_TITLES.guide[input.locale]}\n\n${guideSection(input.role, input.locale)}`,
  ]

  const articles = articleSection(input)
  if (articles) parts.push(`# ${SECTION_TITLES.articles[input.locale]}\n\n${articles}`)

  return parts.join('\n\n')
}

const LANGUAGE_NAME: Record<AppLocale, string> = {
  ca: 'Catalan',
  es: 'Spanish',
  en: 'English',
}

const ROLE_DESCRIPTION: Record<Role, string> = {
  SUPERADMIN:
    'platform administrator — universities, centers, Microsoft Entra tenants, coordinator accounts, updates and metrics',
  CENTER_ADMIN:
    'administrator of one center — subjects, degrees, spaces, people, the academic calendar, imports and the center parameters',
  COORDINATOR:
    'coordinator of one or more subjects — assigns teaching staff, plans the timetable, approves class changes, and is the only role with the planning assistant',
  TEACHER:
    'lecturer — their own classes and subjects, their own load, their availability, class-change requests, messages and profile',
}

export interface CadyPromptInput {
  role: Role
  locale: AppLocale
  /** So she can address somebody by name rather than as "the user". */
  userName: string
  centerName: string | null
  corpus: string
}

/**
 * What Cady is told before she is told anything else.
 *
 * The marker at the end is not decoration: it is how the platform learns which
 * questions the help does not cover without asking anybody to report it. It is
 * stripped before the answer reaches a reader.
 */
export function cadySystemPrompt(input: CadyPromptInput): string {
  return [
    'You are Cady, the support assistant inside UAcademic — an academic-management platform universities use to match each lecturer’s contracted teaching capacity against the teaching load that has to be covered, respecting their availability.',
    '',
    `You are talking to ${input.userName}, whose role here is ${input.role}: ${ROLE_DESCRIPTION[input.role]}.${
      input.centerName ? ` They are working in ${input.centerName}.` : ''
    }`,
    '',
    `Answer in ${LANGUAGE_NAME[input.locale]}, always, whatever language the question is written in.`,
    '',
    'How to answer:',
    '- Be kind, plain and direct. Short sentences. No preamble, no apologising, no "great question".',
    '- Give the steps in order and name the screen, with the path when the material gives one.',
    '- When something has to happen first — a center with no academic year has no teaching load to show — say that first. It is usually the real answer.',
    '- Two or three sentences, or a short numbered list. Never a wall of text.',
    '',
    'What you must not do:',
    '- Do not invent. Everything you state about UAcademic must come from the material below. If it is not there, say plainly that you do not have it in your help material, and suggest asking the center administrator — or, for a platform-wide matter, the platform administrator.',
    '- Do not guess at screens, buttons, menus or fields the material does not name.',
    '- You cannot see this center’s data — no timetables, no people, no hours — and you cannot change anything. Asked to do something, explain where the person does it themselves.',
    '- Never ask for a password, and never repeat one.',
    '',
    'Finish every reply with a final line that is exactly [[covered]] if everything you said came from the material below, or exactly [[uncovered]] if you had to tell the person the material does not cover their question. Write nothing after that line.',
    '',
    '--- HELP MATERIAL ---',
    input.corpus,
    '--- END OF HELP MATERIAL ---',
  ].join('\n')
}

const COVERAGE = /\[\[(covered|uncovered)\]\]\s*$/i

/**
 * Splits the marker off the answer.
 *
 * A reply with no marker counts as covered: the marker is how a gap is
 * *found*, and a model that forgot to write one has not thereby reported that
 * the help is missing something.
 */
export function splitCoverage(answer: string): { text: string; covered: boolean } {
  const trimmed = answer.trimEnd()
  const match = COVERAGE.exec(trimmed)
  if (!match) return { text: answer.trim(), covered: true }

  return {
    text: trimmed.slice(0, match.index).trim(),
    covered: match[1]?.toLowerCase() === 'covered',
  }
}

/**
 * Hides the marker while the answer is still arriving.
 *
 * The text is streamed token by token, so the last thing on screen is
 * regularly half a marker: `[[cov`. Anything that could still become one is
 * held back until the next chunk says what it was.
 */
export function stripPartialMarker(text: string): string {
  return text.replace(
    /\n*\[{0,2}(?:c(?:o(?:v(?:e(?:r(?:e(?:d\]{0,2})?)?)?)?)?)?|u(?:n(?:c(?:o(?:v(?:e(?:r(?:e(?:d\]{0,2})?)?)?)?)?)?)?)?)?$/i,
    '',
  )
}

/** The first line of the question, as the conversation's name. */
export function supportTitle(question: string): string {
  const line = question.trim().split(/\r?\n/)[0] ?? ''
  if (!line) return 'Cady'
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}
