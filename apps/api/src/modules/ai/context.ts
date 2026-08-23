/**
 * What the assistant is allowed to know.
 *
 * The context is built here, once per request, from the same scoped client the
 * HTTP routes use (R2), and it carries the caller's role (R3) — a coordinator
 * sees their center; nobody sees another one. What goes to the model is names,
 * internal identifiers, hours and slots. Never an identity document, a phone
 * number, an address, or anything about somebody's health.
 */
import type { CenterSettings, Role, ScheduleContext } from '@uacademic/shared'
import type { FastifyRequest } from 'fastify'

import { plannerContext } from '../planner/context.js'

export interface AiContext {
  centerId: string
  centerName: string
  academicYearId: string
  academicYearName: string
  db: Awaited<ReturnType<typeof plannerContext>>['db']
  settings: CenterSettings
  schedule: ScheduleContext
  roles: Role[]
  userId: string
  userName: string
  locale: string
  /** The subject the coordinator is working on, when the panel knows it. */
  subjectId: string | null
  subjectCode: string | null
}

export async function buildAiContext(
  request: FastifyRequest,
  input: { subjectId?: string | null } = {},
): Promise<AiContext> {
  const planner = await plannerContext(request)

  const roles = planner.user.memberships
    .filter((membership) => membership.centerId === planner.centerId)
    .map((membership) => membership.role)

  const [center, year, subject] = await Promise.all([
    planner.db.center.findFirst({ where: { id: planner.centerId } }),
    planner.db.academicYear.findFirst({ where: { id: planner.academicYearId } }),
    input.subjectId
      ? planner.db.subject.findFirst({
          where: { id: input.subjectId, academicYearId: planner.academicYearId },
          select: { id: true, code: true },
        })
      : Promise.resolve(null),
  ])

  return {
    centerId: planner.centerId,
    centerName: center?.name ?? '',
    academicYearId: planner.academicYearId,
    academicYearName: year?.name ?? '',
    db: planner.db,
    settings: planner.settings,
    schedule: planner.schedule,
    roles,
    userId: planner.user.userId,
    userName: `${planner.user.firstName} ${planner.user.lastName}`,
    locale: planner.user.locale,
    subjectId: subject?.id ?? null,
    subjectCode: subject?.code ?? null,
  }
}

/**
 * The system prompt.
 *
 * It states the two things the model cannot infer from the tools: that a write
 * tool is a *proposal* a person still has to confirm (R5), and that the answer
 * must be in the reader's language (R1). The rest is context — which center,
 * which year, which subject the coordinator is looking at.
 */
export function systemPrompt(context: AiContext): string {
  const language =
    context.locale === 'es' ? 'Spanish' : context.locale === 'en' ? 'English' : 'Catalan'

  return [
    'You are the coordination assistant inside UAcademic, an academic management platform for universities.',
    `You are helping ${context.userName}, whose role in this center is ${context.roles.join(', ') || 'COORDINATOR'}.`,
    `Center: ${context.centerName}. Academic year: ${context.academicYearName}.`,
    context.subjectCode
      ? `The coordinator is currently working on subject ${context.subjectCode}. Assume questions without an explicit subject refer to it.`
      : '',
    '',
    'How to work:',
    '- Read before you answer. The read tools are cheap and exact; do not guess hours, availability or conflicts.',
    '- Every write tool returns a PROPOSAL. It changes nothing. A human reviews the preview and confirms it, or does not. Never claim to have made a change.',
    '- When something is impossible, say which constraint blocks it and name the class or the person it clashes with, using the data the tools returned.',
    '- Hours are decimal hours. Weekdays are ISO: 1 = Monday. Times are HH:MM, 24-hour, center-local.',
    '- If a question is outside this center or this academic year, say you cannot see it rather than speculating.',
    '',
    '',
    'Reading a document somebody attached:',
    '- It is *their* material, not this center’s data. A group, a colleague or a room named in it is only real once a read tool has returned it — never assume the platform knows what the document calls something.',
    '- Ask before you propose. A column with no year on the dates, a room written two ways, "T1" that could be three subjects, a week you cannot place: ask. A wrong mapping is far worse than a question, and the person can answer in one line.',
    '- When every row maps with no doubt left, call `import_schedule` with the rows exactly as the document writes them, filling `subject` whenever the document says which subject a group belongs to. What it cannot match comes back named and numbered, and it says whether the text matched nothing or matched several things — take those back to the person rather than guessing.',
    '',
    `Answer in ${language}, plainly and briefly. Prefer short paragraphs and lists over tables.`,
  ]
    .filter(Boolean)
    .join('\n')
}
