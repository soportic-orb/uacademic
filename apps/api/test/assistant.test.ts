/**
 * The assistant, end to end, without ever calling Anthropic.
 *
 * The model is stubbed: what is under test is everything around it — the tools
 * running scoped to one center, the proposals that never write, the
 * confirmation that does and is audited as `ai`, the budget, and the promise
 * that a failing API leaves the rest of the platform alone.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { setAnthropicClient } from '../src/modules/ai/client.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

interface StubTurn {
  content: unknown[]
  stop_reason: 'end_turn' | 'tool_use'
}

/**
 * A stand-in for `client.messages.stream()`: it replays scripted turns and
 * records what it was asked, so the tests can assert on the prompt and on the
 * tool list without a network.
 */
class StubAnthropic {
  turns: StubTurn[] = []
  requests: { system: string; tools: { name: string }[]; messages: unknown[] }[] = []
  failWith: Error | null = null

  messages = {
    stream: (params: { system: string; tools: { name: string }[]; messages: unknown[] }) => {
      if (this.failWith) throw this.failWith
      this.requests.push({ system: params.system, tools: params.tools, messages: params.messages })

      const turn = this.turns.shift() ?? { content: [], stop_reason: 'end_turn' as const }
      const listeners: ((delta: string) => void)[] = []

      return {
        on(event: string, handler: (delta: string) => void) {
          if (event === 'text') listeners.push(handler)
          return this
        },
        async finalMessage() {
          for (const block of turn.content) {
            const typed = block as { type: string; text?: string }
            if (typed.type === 'text' && typed.text) {
              for (const listener of listeners) listener(typed.text)
            }
          }

          return {
            content: turn.content,
            stop_reason: turn.stop_reason,
            usage: { input_tokens: 1_200, output_tokens: 300 },
          }
        },
      }
    },
  }
}

describe.skipIf(!hasDatabase)('the coordination assistant', () => {
  let app: FastifyInstance
  let centerId: string
  let userId: string
  let sessionId: string
  const prisma = getPrismaClient()
  const stub = new StubAnthropic()

  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  /** Reads the SSE body the ask endpoint streams back. */
  const events = (body: string) =>
    body
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>)

  const ask = async (question: string, payload: Record<string, unknown> = {}) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      headers: asCoordinator(),
      payload: { question, ...payload },
    })
    return { response, events: events(response.body) }
  }

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    userId = (await prisma.user.findFirst({ where: { email: SEED.teacherEmail } }))!.id
    sessionId = (
      await prisma.classSession.findFirstOrThrow({
        where: { centerId, scheduleVersion: { status: 'published' } },
        orderBy: { weekday: 'asc' },
      })
    ).id

    setAnthropicClient(stub as never)
  })

  afterAll(async () => {
    setAnthropicClient(undefined)
    await prisma.aiProposal.deleteMany({ where: { centerId } })
    await prisma.aiMessage.deleteMany({ where: { conversation: { centerId } } })
    await prisma.aiConversation.deleteMany({ where: { centerId } })
    await prisma.aiInteraction.deleteMany({ where: { centerId } })
    await app.close()
    await disconnectPrisma()
  })

  afterEach(async () => {
    stub.turns = []
    stub.requests = []
    stub.failWith = null
    await prisma.aiInteraction.deleteMany({ where: { centerId } })
  })

  describe('who may use it', () => {
    it('is coordination’s tool, not everybody’s', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/status',
        headers: asTeacher(),
      })
      expect(response.statusCode).toBe(403)
    })

    it('reports the model, the budget and whether it can answer at all', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/status',
        headers: asCoordinator(),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().budget.level).toBe('ok')
      expect(response.json().model).toBeTruthy()
    })
  })

  describe('reading', () => {
    it('answers a question about hours by running the read tool itself', async () => {
      stub.turns = [
        {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'get_teacher_workload',
              input: { teacherName: 'Marta' },
            },
          ],
          stop_reason: 'tool_use',
        },
        {
          content: [{ type: 'text', text: 'Li queden 40 hores lliures aquest semestre.' }],
          stop_reason: 'end_turn',
        },
      ]

      const { response, events: frames } = await ask(
        'Quantes hores lliures li queden a Marta aquest semestre?',
      )

      expect(response.statusCode).toBe(200)
      expect(frames.some((frame) => frame.type === 'tool' && frame.kind === 'read')).toBe(true)
      expect(frames.some((frame) => frame.type === 'text')).toBe(true)
      expect(frames.at(-1)?.type).toBe('done')

      // The tool result went back to the model as data, not as prose.
      const followup = stub.requests[1]!
      const toolResult = JSON.stringify(followup.messages)
      expect(toolResult).toContain('contractedHours')
      expect(toolResult).toContain('ratioPercent')
    })

    it('sends names and hours, and no personal data at all', async () => {
      stub.turns = [
        {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'get_teacher_availability',
              input: { teacherName: 'Marta' },
            },
          ],
          stop_reason: 'tool_use',
        },
        { content: [{ type: 'text', text: 'Fet.' }], stop_reason: 'end_turn' },
      ]

      await ask('Quina disponibilitat té Marta?')

      const sent = JSON.stringify(stub.requests[1]!.messages).toLowerCase()
      for (const forbidden of ['dni', 'phone', 'address', 'medicalreason', 'birthdate']) {
        expect(sent).not.toContain(`"${forbidden}"`)
      }
      // The exception's free-text reason is a place somebody writes why they
      // were ill: it must not travel either.
      expect(sent).not.toContain('"reason"')
    })

    it('explains why a placement is impossible, using the engine', async () => {
      stub.turns = [
        {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'list_conflicts',
              input: { sessionId, weekday: 2, startTime: '10:00', endTime: '12:00' },
            },
          ],
          stop_reason: 'tool_use',
        },
        {
          content: [{ type: 'text', text: 'Perquè xoca amb una altra classe.' }],
          stop_reason: 'end_turn',
        },
      ]

      await ask('Per què no puc posar aquesta classe dimarts a les 10?')

      // The tool result travels as a JSON string inside the message, so the
      // quotes are escaped once more by this serialisation.
      const result = JSON.stringify(stub.requests[1]!.messages)
      expect(result).toContain('scope')
      expect(result).toContain('placement')
      expect(result).toContain('allowed')
    })

    it('carries the center and the subject into the system prompt', async () => {
      const subject = await prisma.subject.findFirstOrThrow({ where: { centerId } })
      stub.turns = [{ content: [{ type: 'text', text: 'Hola.' }], stop_reason: 'end_turn' }]

      await ask('Hola', { subjectId: subject.id })

      const system = stub.requests[0]!.system
      expect(system).toContain(subject.code)
      expect(system).toContain('PROPOSAL')
    })
  })

  describe('proposing', () => {
    it('never writes: a write tool produces a pending proposal', async () => {
      const session = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })

      stub.turns = [
        {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'move_session',
              input: { sessionId, weekday: 4 },
            },
          ],
          stop_reason: 'tool_use',
        },
        { content: [{ type: 'text', text: 'Te la proposo aquí.' }], stop_reason: 'end_turn' },
      ]

      const { events: frames } = await ask('Mou aquesta classe a dijous')

      const proposalFrame = frames.find((frame) => frame.type === 'proposal')
      expect(proposalFrame).toBeTruthy()

      const stored = await prisma.aiProposal.findFirstOrThrow({
        where: { id: proposalFrame!.proposalId as string },
      })
      expect(stored.status).toBe('pending')

      // The timetable has not moved.
      const after = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(after.weekday).toBe(session.weekday)
      expect(after.startTime).toBe(session.startTime)
    })

    it('applies it only when a person confirms, and records it as the assistant', async () => {
      const before = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })
      const free = await freeWeekday(before)

      stub.turns = [
        {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'move_session',
              input: { sessionId, weekday: free },
            },
          ],
          stop_reason: 'tool_use',
        },
        { content: [{ type: 'text', text: 'Proposta preparada.' }], stop_reason: 'end_turn' },
      ]

      const { events: frames } = await ask('Mou-la')
      const proposalId = frames.find((frame) => frame.type === 'proposal')!.proposalId as string

      const confirm = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/proposals/${proposalId}/confirm`,
        headers: asCoordinator(),
      })

      expect(confirm.statusCode).toBe(200)
      expect(confirm.json().applied).toBe(1)

      const moved = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(moved.weekday).toBe(free)

      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'class_session', entityId: sessionId },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit?.source).toBe('ai')

      // Confirming twice must not apply twice.
      const again = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/proposals/${proposalId}/confirm`,
        headers: asCoordinator(),
      })
      expect(again.statusCode).toBe(409)

      await prisma.classSession.update({
        where: { id: sessionId },
        data: { weekday: before.weekday, startTime: before.startTime, endTime: before.endTime },
      })
    })

    it('refuses to apply a proposal that breaks a hard constraint', async () => {
      const session = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })
      const clash = await prisma.classSession.findFirst({
        where: {
          centerId,
          scheduleVersion: { status: 'published' },
          teacherProfileId: session.teacherProfileId,
          NOT: { id: session.id },
        },
      })
      if (!clash) return

      stub.turns = [
        {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'move_session',
              input: {
                sessionId,
                weekday: clash.weekday,
                startTime: clash.startTime,
                endTime: clash.endTime,
              },
            },
          ],
          stop_reason: 'tool_use',
        },
        { content: [{ type: 'text', text: 'Ho he provat.' }], stop_reason: 'end_turn' },
      ]

      const { events: frames } = await ask('Posa-la sobre l’altra classe')
      const frame = frames.find((entry) => entry.type === 'proposal')!
      const preview = frame.proposal as { violations: unknown[] }
      expect(preview.violations.length).toBeGreaterThan(0)

      const confirm = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/proposals/${frame.proposalId as string}/confirm`,
        headers: asCoordinator(),
      })
      expect(confirm.statusCode).toBe(409)
    })

    it('lets a coordinator throw a proposal away', async () => {
      stub.turns = [
        {
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'move_session',
              input: { sessionId, weekday: 5 },
            },
          ],
          stop_reason: 'tool_use',
        },
        { content: [{ type: 'text', text: 'Aquí la tens.' }], stop_reason: 'end_turn' },
      ]

      const { events: frames } = await ask('Prova-ho')
      const proposalId = frames.find((frame) => frame.type === 'proposal')!.proposalId as string

      const rejected = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/proposals/${proposalId}/reject`,
        headers: asCoordinator(),
      })

      expect(rejected.statusCode).toBe(200)
      expect((await prisma.aiProposal.findFirstOrThrow({ where: { id: proposalId } })).status).toBe(
        'rejected',
      )
    })
  })

  describe('accounting', () => {
    it('records every question with what it cost', async () => {
      stub.turns = [{ content: [{ type: 'text', text: 'Resposta.' }], stop_reason: 'end_turn' }]

      await ask('Una pregunta qualsevol')

      const interaction = await prisma.aiInteraction.findFirstOrThrow({
        where: { centerId, userId },
        orderBy: { createdAt: 'desc' },
      })
      expect(interaction.tokensIn).toBe(1_200)
      expect(interaction.tokensOut).toBe(300)
    })

    it('stops answering once the center’s monthly budget is spent', async () => {
      const center = await prisma.center.findUniqueOrThrow({ where: { id: centerId } })
      const settings = (center.settingsJson ?? {}) as Record<string, unknown>

      await prisma.center.update({
        where: { id: centerId },
        data: {
          settingsJson: { ...settings, ai: { monthlyTokenBudget: 1_000 } } as never,
        },
      })
      await prisma.aiInteraction.create({
        data: { centerId, userId, prompt: 'x', tokensIn: 900, tokensOut: 200 },
      })

      stub.turns = [{ content: [{ type: 'text', text: 'no' }], stop_reason: 'end_turn' }]
      const { events: frames } = await ask('I ara?')

      expect(frames.some((frame) => frame.messageKey === 'assistant.errors.budgetExceeded')).toBe(
        true,
      )

      const status = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/status',
        headers: asCoordinator(),
      })
      expect(status.json().budget.level).toBe('exceeded')

      await prisma.center.update({
        where: { id: centerId },
        data: { settingsJson: settings as never },
      })
    })
  })

  describe('when Anthropic is down', () => {
    it('degrades the panel and leaves everything else working', async () => {
      stub.failWith = new Error('connection refused')
      stub.turns = []

      const { response, events: frames } = await ask('Alguna cosa')

      expect(response.statusCode).toBe(200)
      expect(frames.some((frame) => frame.messageKey === 'assistant.errors.failed')).toBe(true)

      // The platform is untouched: the planner still answers.
      const planner = await app.inject({
        method: 'GET',
        url: '/api/v1/planner/versions',
        headers: asCoordinator(),
      })
      expect(planner.statusCode).toBe(200)
    })
  })

  describe('the conversation', () => {
    it('keeps a history per subject and replays it as context', async () => {
      const subject = await prisma.subject.findFirstOrThrow({ where: { centerId } })

      stub.turns = [{ content: [{ type: 'text', text: 'Primera.' }], stop_reason: 'end_turn' }]
      const first = await ask('Primera pregunta', { subjectId: subject.id })
      const conversationId = first.events.at(-1)!.conversationId as string

      stub.turns = [{ content: [{ type: 'text', text: 'Segona.' }], stop_reason: 'end_turn' }]
      await ask('I la segona?', { conversationId, subjectId: subject.id })

      // The second request carried the first exchange.
      const replayed = JSON.stringify(stub.requests.at(-1)!.messages)
      expect(replayed).toContain('Primera pregunta')
      expect(replayed).toContain('Primera.')

      const listed = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/conversations?subjectId=${subject.id}`,
        headers: asCoordinator(),
      })
      expect(listed.json().items.length).toBeGreaterThan(0)

      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/conversations/${conversationId}`,
        headers: asCoordinator(),
      })
      expect(detail.json().messages).toHaveLength(4)
    })
  })

  /**
   * A weekday where the teacher, the room and the group are all free at this
   * session's own hour — anything less and the engine refuses the move, which
   * is the engine being right rather than the test being interesting.
   */
  async function freeWeekday(session: {
    id: string
    weekday: number
    teacherProfileId: string | null
    spaceId: string | null
    groupId: string
    startTime: string
    endTime: string
  }) {
    const others = await prisma.classSession.findMany({
      where: {
        centerId,
        scheduleVersion: { status: 'published' },
        NOT: { id: session.id },
        OR: [
          { teacherProfileId: session.teacherProfileId },
          { spaceId: session.spaceId },
          { groupId: session.groupId },
        ],
      },
      select: { weekday: true, startTime: true, endTime: true },
    })

    const overlaps = (other: { startTime: string; endTime: string }) =>
      other.startTime < session.endTime && session.startTime < other.endTime

    const taken = new Set(others.filter(overlaps).map((entry) => entry.weekday))

    const free = [1, 2, 3, 4, 5].find(
      (weekday) => weekday !== session.weekday && !taken.has(weekday),
    )
    expect(free).toBeDefined()
    return free!
  }
})
