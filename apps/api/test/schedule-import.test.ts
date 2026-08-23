/**
 * Reading a timetable out of a document somebody was sent.
 *
 * The whole safeguard is that the model never supplies an identifier. It
 * repeats what the document says — "MAT101 T1", "Marta Puig", "Aula 1.1" — and
 * the server matches that against this center, refusing whatever it cannot
 * match so the assistant has to ask rather than guess. A plausible-looking
 * invention must never become a class.
 *
 * Driven through the real path: the assistant is asked, a scripted model calls
 * the tool, and the proposal comes back on the stream exactly as the panel
 * would receive it.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { AiProposal } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setAnthropicClient } from '../src/modules/ai/client.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

interface StubTurn {
  content: unknown[]
  stop_reason: 'end_turn' | 'tool_use'
}

/** Replays scripted turns, so a tool call can be driven without a network. */
class StubAnthropic {
  turns: StubTurn[] = []
  requests: { system: string; messages: unknown[] }[] = []

  messages = {
    stream: (params: { system: string; messages: unknown[] }) => {
      this.requests.push({ system: params.system, messages: params.messages })
      const turn = this.turns.shift() ?? { content: [], stop_reason: 'end_turn' as const }

      return {
        on() {
          return this
        },
        async finalMessage() {
          return {
            content: turn.content,
            stop_reason: turn.stop_reason,
            usage: { input_tokens: 100, output_tokens: 20 },
          }
        },
      }
    },
  }
}

describe.skipIf(!hasDatabase)('importing a timetable from a document', () => {
  const prisma = getPrismaClient()
  const stub = new StubAnthropic()
  let app: FastifyInstance
  let centerId: string
  let versionId: string
  let group: { id: string; code: string; subjectCode: string }
  let teacherName: string
  let spaceName: string

  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    setAnthropicClient(stub as never)

    const row = await prisma.group.findFirstOrThrow({
      where: { centerId },
      include: { subject: { select: { code: true } } },
    })
    group = { id: row.id, code: row.code, subjectCode: row.subject.code }

    const teacher = await prisma.teacherProfile.findFirstOrThrow({
      where: { centerId },
      include: { user: { select: { firstName: true, lastName: true } } },
    })
    teacherName = `${teacher.user.firstName} ${teacher.user.lastName}`
    spaceName = (await prisma.space.findFirstOrThrow({ where: { centerId } })).name

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/planner/versions',
      headers: asCoordinator(),
      payload: { name: 'Importació des de document' },
    })
    versionId = created.json().id
  })

  afterAll(async () => {
    setAnthropicClient(undefined)
    await prisma.aiProposal.deleteMany({ where: { centerId } })
    await prisma.aiMessage.deleteMany({ where: { conversation: { centerId } } })
    await prisma.aiConversation.deleteMany({ where: { centerId } })
    await prisma.aiInteraction.deleteMany({ where: { centerId } })
    await prisma.scheduleVersion.deleteMany({ where: { id: versionId } })
    await app.close()
    await disconnectPrisma()
  })

  beforeEach(() => {
    stub.turns = []
    stub.requests = []
  })

  afterEach(async () => {
    await prisma.classSession.deleteMany({ where: { scheduleVersionId: versionId } })
  })

  /** Scripts one `import_schedule` call and returns the proposal it produced. */
  const propose = async (rows: unknown[]): Promise<AiProposal> => {
    stub.turns = [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'call-1', name: 'import_schedule', input: { rows, versionId } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fet.' }] },
    ]

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      headers: asCoordinator(),
      payload: { question: 'Importa aquest horari' },
    })

    const frame = response.body
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; proposal?: AiProposal })
      .find((event) => event.type === 'proposal')

    expect(frame?.proposal).toBeDefined()
    return frame!.proposal as AiProposal
  }

  it('matches a group written the way a document writes it', async () => {
    const proposal = await propose([
      {
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '10:00',
        group: `${group.subjectCode} ${group.code}`,
      },
    ])

    expect(proposal.changes).toHaveLength(1)
    expect(proposal.violations).toHaveLength(0)
    expect(proposal.changes[0]?.after).toMatchObject({ groupId: group.id, date: '2026-09-14' })
    // Nothing exists yet: this is what confirming would create.
    expect(proposal.changes[0]?.entityId).toBeNull()
  })

  it('matches a name however it was punctuated or accented', async () => {
    const proposal = await propose([
      {
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '10:00',
        group: `${group.subjectCode} ${group.code}`,
        teacher: teacherName.toUpperCase(),
        space: spaceName.replace(/[.\s]/g, '-'),
      },
    ])

    expect(proposal.violations).toHaveLength(0)
    expect(proposal.changes[0]?.after).toMatchObject({ groupId: group.id })
  })

  it('refuses a group it does not know, naming the row', async () => {
    const proposal = await propose([
      { date: '2026-09-14', startTime: '09:00', endTime: '10:00', group: 'Grup fantasma' },
    ])

    expect(proposal.changes).toHaveLength(0)
    expect(proposal.violations[0]).toMatchObject({
      messageKey: 'assistant.import.unknownGroup',
      params: { row: 1, value: 'Grup fantasma' },
    })
  })

  it('asks which subject a bare group code belongs to', async () => {
    // "T1" is the first group of seven different subjects. Picking one would
    // be answering the coordinator's question for them.
    const proposal = await propose([
      { date: '2026-09-14', startTime: '09:00', endTime: '10:00', group: group.code },
    ])

    expect(proposal.changes).toHaveLength(0)
    expect(proposal.violations[0]).toMatchObject({
      messageKey: 'assistant.import.ambiguousGroup',
      params: { row: 1, value: group.code },
    })
  })

  it('refuses a teacher it does not know rather than leaving the class unstaffed', async () => {
    const proposal = await propose([
      {
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '10:00',
        group: `${group.subjectCode} ${group.code}`,
        teacher: 'Algú que no hi treballa',
      },
    ])

    expect(proposal.changes).toHaveLength(0)
    expect(proposal.violations[0]?.messageKey).toBe('assistant.import.unknownTeacher')
  })

  it('refuses a date that is not one', async () => {
    const proposal = await propose([
      {
        date: '2026-13-45',
        startTime: '09:00',
        endTime: '10:00',
        group: `${group.subjectCode} ${group.code}`,
      },
    ])

    expect(proposal.violations[0]?.messageKey).toBe('assistant.import.badDate')
  })

  it('reports a document that books the same teacher twice at once', async () => {
    const row = {
      date: '2026-09-14',
      startTime: '09:00',
      endTime: '10:00',
      group: `${group.subjectCode} ${group.code}`,
      teacher: teacherName,
    }
    const proposal = await propose([row, { ...row }])

    // Both map, and the second clashes with the first: a document that
    // contradicts itself is worth arguing with rather than importing.
    expect(proposal.changes).toHaveLength(2)
    const second = proposal.changes[1]?.after as { conflicts?: string[] }
    expect(second.conflicts?.length).toBeGreaterThan(0)
  })

  it('writes nothing at all by itself (R5)', async () => {
    await propose([
      {
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '10:00',
        group: `${group.subjectCode} ${group.code}`,
      },
    ])

    expect(await prisma.classSession.count({ where: { scheduleVersionId: versionId } })).toBe(0)
  })

  it('creates the classes once a person confirms it', async () => {
    await propose([
      {
        date: '2026-09-14',
        startTime: '09:00',
        endTime: '10:00',
        group: `${group.subjectCode} ${group.code}`,
        topic: 'Presentació',
      },
    ])

    const pending = await prisma.aiProposal.findFirstOrThrow({
      where: { centerId, tool: 'import_schedule', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/proposals/${pending.id}/confirm`,
      headers: asCoordinator(),
    })

    expect(confirmed.statusCode).toBe(200)

    const written = await prisma.classSession.findMany({
      where: { scheduleVersionId: versionId },
    })
    expect(written).toHaveLength(1)
    // Placed on its day, once, like every other class in this planner.
    expect(written[0]).toMatchObject({ weekday: 1, recurrence: 'once', topic: 'Presentació' })
    expect(written[0]?.dateFrom.toISOString().slice(0, 10)).toBe('2026-09-14')

    // R4: read by the assistant, confirmed by a person, and recorded as such.
    const entry = await prisma.auditLog.findFirst({
      where: { entity: 'class_session', entityId: written[0]?.id },
    })
    expect(entry?.source).toBe('ai')
  })
})
