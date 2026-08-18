/**
 * Reading a regulation into a configuration, end to end.
 *
 * The tests that matter here are the ones about restraint: that nothing is
 * written without a person, that an invented citation never reaches the
 * screen, that a contradiction is presented rather than settled, and that the
 * chain parameter → article → page survives long enough to explain a blocked
 * assignment months later.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import { defaultCenterSettings } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildJobHandlers } from '../src/jobs/handlers.js'
import { setAnthropicClient } from '../src/modules/ai/client.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

const REGULATION = [
  'Criteris d’ordenacio docent 2026-2027',
  '',
  'Article 14.2. La dedicacio docent del professorat a temps complet no excedira de 240 hores',
  'lectives anuals, salvo en el caso de los cargos academicos, que se regiran por el articulo 14.3.',
  '',
  'Article 6.4. La carrega docent assignada no pot superar el 110 % de la carrega contractada.',
  '',
  'Article 21. Cap sessio podra superar les 3 hores lectives consecutives.',
].join('\n')

/** Replays one scripted tool call per block and records what it was asked. */
class StubAnthropic {
  answers: Record<string, unknown[]> = {}
  requests: { system: string; messages: unknown[]; tool_choice?: unknown }[] = []
  failBlocks = new Set<string>()

  messages = {
    create: async (params: {
      system: string
      messages: { content: { type: string; text: string; cache_control?: unknown }[] }[]
      tool_choice?: unknown
    }) => {
      this.requests.push({
        system: params.system,
        messages: params.messages,
        tool_choice: params.tool_choice,
      })

      const brief = params.messages[0]?.content?.at(-1)?.text ?? ''
      const block = /Block ([A-H])\./.exec(brief)?.[1] ?? '?'
      if (this.failBlocks.has(block)) throw new Error(`model unavailable for ${block}`)

      return {
        content: [
          {
            type: 'tool_use',
            name: 'record_parameters',
            input: { proposals: this.answers[block] ?? [] },
          },
        ],
        usage: { input_tokens: 1_200, output_tokens: 300 },
      }
    },
  }
}

describe.skipIf(!hasDatabase)('reading a regulation into the configuration', () => {
  let app: FastifyInstance
  let centerId: string
  let documentId: string
  /** The center as the suite found it: other suites read these settings. */
  let originalSettings: unknown
  let originalVersionId: string | null = null
  let versionsBefore: string[] = []
  const prisma = getPrismaClient()
  const stub = new StubAnthropic()
  const handlers = buildJobHandlers(prisma, pino({ level: 'silent' }))

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  /** Runs the queued extraction jobs, as the worker would. */
  const drain = async () => {
    const jobs = await prisma.job.findMany({ where: { type: 'settings.extract' } })
    for (const job of jobs) {
      await handlers['settings.extract']?.(job.payloadJson as never)
    }
    await prisma.job.deleteMany({ where: { type: 'settings.extract' } })
  }

  const startRun = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/extractions',
      headers: asAdmin(),
      payload: { documentId },
    })
    expect(response.statusCode).toBe(202)
    await drain()
    return response.json().runId as string
  }

  const view = async (runId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/settings/extractions/${runId}`,
      headers: asAdmin(),
    })
    return response.json()
  }

  const proposal = (overrides: Record<string, unknown> = {}) => ({
    key: 'capacity.maxTeachingHoursYear',
    proposed_value: 250,
    unit: 'hours/year',
    citation: {
      page: 7,
      section: 'Art. 14.2',
      quote: 'no excedira de 240 hores',
    },
    reasoning: 'General limit',
    ...overrides,
  })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    setAnthropicClient(stub as never)

    const center = await prisma.center.findUniqueOrThrow({ where: { id: centerId } })
    originalSettings = center.settingsJson
    originalVersionId = center.settingsVersionId
    versionsBefore = (
      await prisma.centerSettingsVersion.findMany({ where: { centerId }, select: { id: true } })
    ).map((row) => row.id)

    const document = await prisma.document.create({
      data: {
        centerId,
        scope: 'center',
        title: 'Criteris POD 2026-2027 (test)',
        type: 'regulation',
        language: 'ca',
        visibility: 'ai_only',
        filePath: 'test/criteris.pdf',
        mime: 'application/pdf',
        sizeBytes: BigInt(1_000),
        checksum: 'c'.repeat(64),
        status: 'indexed',
      },
    })
    documentId = document.id

    await prisma.documentChunk.create({
      data: {
        centerId,
        documentId,
        ordinal: 0,
        headingPath: 'Criteris',
        pageFrom: 7,
        pageTo: 7,
        content: REGULATION,
        tokenCount: 200,
      },
    })
  })

  afterAll(async () => {
    setAnthropicClient(undefined)
    await prisma.settingExtraction.deleteMany({ where: { centerId } })
    await prisma.settingExtractionRun.deleteMany({ where: { centerId } })

    // The configuration goes back to what it was: this suite rewrote it, and
    // the rest of the platform is tested against the seeded parameters.
    await prisma.settingProvenance.deleteMany({
      where: { centerId, settingsVersionId: { notIn: versionsBefore } },
    })
    await prisma.centerSettingsVersion.deleteMany({
      where: { centerId, id: { notIn: versionsBefore } },
    })
    await prisma.center.update({
      where: { id: centerId },
      data: { settingsJson: originalSettings as never, settingsVersionId: originalVersionId },
    })
    await prisma.documentChunk.deleteMany({ where: { documentId } })
    await prisma.document.delete({ where: { id: documentId } }).catch(() => null)
    await app.close()
    await disconnectPrisma()
  })

  beforeEach(() => {
    stub.answers = { A: [proposal()] }
    stub.failBlocks = new Set()
  })

  afterEach(async () => {
    stub.requests = []
    await prisma.settingExtraction.deleteMany({ where: { centerId } })
    await prisma.settingExtractionRun.deleteMany({ where: { centerId } })
    await prisma.job.deleteMany({ where: { type: 'settings.extract' } })
    await prisma.aiInteraction.deleteMany({ where: { centerId } })
  })

  describe('who may ask for it', () => {
    it('is the center administration’s, not a teacher’s', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/extractions',
        headers: asTeacher(),
        payload: { documentId },
      })

      expect(response.statusCode).toBe(403)
    })

    it('refuses a document that has not been indexed yet', async () => {
      const pending = await prisma.document.create({
        data: {
          centerId,
          scope: 'center',
          title: 'Encara sense indexar',
          type: 'regulation',
          language: 'ca',
          visibility: 'ai_only',
          filePath: 'test/pending.pdf',
          mime: 'application/pdf',
          sizeBytes: BigInt(10),
          checksum: 'd'.repeat(64),
          status: 'uploaded',
        },
      })

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/extractions',
        headers: asAdmin(),
        payload: { documentId: pending.id },
      })

      expect(response.statusCode).toBe(422)
      await prisma.document.delete({ where: { id: pending.id } })
    })
  })

  describe('how the document is read', () => {
    it('sends it whole, with a cache breakpoint, and forces the tool', async () => {
      await startRun()

      const request = stub.requests[0]
      const content = (
        request?.messages[0] as { content: { text: string; cache_control?: unknown }[] }
      ).content

      expect(content[0]?.text).toContain('no excedira de 240 hores')
      expect(content[0]?.cache_control).toEqual({ type: 'ephemeral' })
      expect(request?.tool_choice).toEqual({ type: 'tool', name: 'record_parameters' })
      // One call per block: eight of them, reading the same cached prefix.
      expect(stub.requests).toHaveLength(8)
    })

    it('tells the model to return null rather than invent a plausible figure', async () => {
      await startRun()

      expect(stub.requests[0]?.system).toContain('Never infer a plausible figure')
      expect(stub.requests[0]?.system).toContain('Copy the sentence exactly as written')
    })

    it('records what the reading cost, like every other use of the model', async () => {
      await startRun()

      const interactions = await prisma.aiInteraction.findMany({ where: { centerId } })
      expect(interactions.length).toBeGreaterThan(0)
      expect(interactions[0]?.tokensIn).toBe(1_200)
    })
  })

  describe('what survives to the screen', () => {
    it('keeps a proposal whose quote is in the document, with its citation', async () => {
      const runId = await startRun()
      const rows = (await view(runId)).rows as Record<string, unknown>[]

      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')
      expect(row?.proposedValue).toBe(250)
      expect(row?.status).toBe('pending')
      expect(row?.confidence).toBe('high')
      expect(row?.citation).toMatchObject({ page: 7, section: 'Art. 14.2' })
    })

    it('throws away a citation the document does not contain', async () => {
      stub.answers = {
        A: [
          proposal({
            proposed_value: 300,
            citation: { page: 7, section: 'Art. 14.2', quote: 'no excedira de 300 hores' },
          }),
        ],
      }

      const runId = await startRun()
      const rows = (await view(runId)).rows as Record<string, unknown>[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')

      // It comes back as unanswered, never as a number somebody might accept.
      expect(row?.status).toBe('not_found')
      expect(row?.proposedValue).toBeNull()
    })

    it('lists what the document does not say instead of quietly skipping it', async () => {
      const runId = await startRun()
      const rows = (await view(runId)).rows as Record<string, unknown>[]

      const notFound = rows.filter((entry) => entry.status === 'not_found')
      expect(notFound.length).toBeGreaterThan(5)
      expect(notFound[0]?.reasoning).toContain('settings.extraction.notFound')
    })

    it('keeps the exception attached to the parameter', async () => {
      stub.answers = {
        A: [proposal({ exception_note: 'salvo en el caso de los cargos academicos' })],
      }

      const runId = await startRun()
      const rows = (await view(runId)).rows as Record<string, unknown>[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')

      expect(row?.exceptionNote).toContain('cargos academicos')
    })

    it('shows both readings when two articles disagree, and settles neither', async () => {
      stub.answers = {
        A: [
          proposal(),
          proposal({
            proposed_value: 180,
            citation: {
              page: 7,
              section: 'Art. 21',
              quote: 'Cap sessio podra superar les 3 hores lectives consecutives',
            },
          }),
        ],
      }

      const runId = await startRun()
      const detail = await view(runId)

      expect(detail.conflicts).toContain('capacity.maxTeachingHoursYear')
      const rows = (detail.rows as Record<string, unknown>[]).filter(
        (entry) => entry.paramKey === 'capacity.maxTeachingHoursYear',
      )
      expect(rows).toHaveLength(2)
      expect(rows.every((entry) => entry.status === 'pending')).toBe(true)
    })

    it('reports a block that failed without taking the others down', async () => {
      stub.failBlocks = new Set(['B'])

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/extractions',
        headers: asAdmin(),
        payload: { documentId },
      })
      const runId = response.json().runId as string

      const jobs = await prisma.job.findMany({ where: { type: 'settings.extract' } })
      for (const job of jobs) {
        await handlers['settings.extract']?.(job.payloadJson as never).catch(() => null)
      }

      const detail = await view(runId)
      expect(detail.blocks.B.state).toBe('failed')
      expect(detail.blocks.A.state).toBe('ready')
    })
  })

  describe('confirming, one parameter at a time', () => {
    it('writes nothing until somebody applies the run', async () => {
      const read = async () =>
        (
          await app.inject({ method: 'GET', url: '/api/v1/centers/settings', headers: asAdmin() })
        ).json().settings.capacity.maxTeachingHoursYear

      const before = await read()
      const runId = await startRun()

      // Eight blocks read, proposals stored, and the configuration untouched.
      expect(await read()).toBe(before)
      const rows = (await view(runId)).rows as { status: string }[]
      expect(rows.some((row) => row.status === 'pending')).toBe(true)
    })

    it('applies what was accepted, into a new version, with its citation', async () => {
      const runId = await startRun()
      const rows = (await view(runId)).rows as { id: string; paramKey: string }[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/settings/extractions/${runId}/rows/${row?.id}`,
        headers: asAdmin(),
        payload: { status: 'accepted' },
      })

      const applied = await app.inject({
        method: 'POST',
        url: `/api/v1/settings/extractions/${runId}/apply`,
        headers: asAdmin(),
      })

      expect(applied.json().applied).toContain('capacity.maxTeachingHoursYear')

      const settings = await app.inject({
        method: 'GET',
        url: '/api/v1/centers/settings',
        headers: asAdmin(),
      })
      expect(settings.json().settings.capacity.maxTeachingHoursYear).toBe(250)

      // And the citation travelled with it.
      const provenance = (settings.json().provenance as { paramKey: string; quote: string }[]).find(
        (record) => record.paramKey === 'capacity.maxTeachingHoursYear',
      )
      expect(provenance?.quote).toContain('no excedira de 240 hores')
    })

    it('stores an edited value rather than the proposed one', async () => {
      const runId = await startRun()
      const rows = (await view(runId)).rows as { id: string; paramKey: string }[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/settings/extractions/${runId}/rows/${row?.id}`,
        headers: asAdmin(),
        payload: { status: 'edited', value: 200 },
      })
      await app.inject({
        method: 'POST',
        url: `/api/v1/settings/extractions/${runId}/apply`,
        headers: asAdmin(),
      })

      const settings = await app.inject({
        method: 'GET',
        url: '/api/v1/centers/settings',
        headers: asAdmin(),
      })
      expect(settings.json().settings.capacity.maxTeachingHoursYear).toBe(200)
    })

    it('leaves a rejected parameter exactly as it was', async () => {
      const runId = await startRun()
      const rows = (await view(runId)).rows as { id: string; paramKey: string }[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')
      const before = (
        await app.inject({ method: 'GET', url: '/api/v1/centers/settings', headers: asAdmin() })
      ).json().settings.capacity.maxTeachingHoursYear

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/settings/extractions/${runId}/rows/${row?.id}`,
        headers: asAdmin(),
        payload: { status: 'rejected' },
      })
      const applied = await app.inject({
        method: 'POST',
        url: `/api/v1/settings/extractions/${runId}/apply`,
        headers: asAdmin(),
      })

      expect(applied.json().rejected).toContain('capacity.maxTeachingHoursYear')
      const after = (
        await app.inject({ method: 'GET', url: '/api/v1/centers/settings', headers: asAdmin() })
      ).json().settings.capacity.maxTeachingHoursYear
      expect(after).toBe(before)
    })

    it('accepts every high-confidence row of a block at once, and nothing contradicted', async () => {
      stub.answers = {
        A: [
          proposal({
            key: 'capacity.creditToHours',
            proposed_value: 12,
            citation: {
              page: 7,
              section: 'Art. 6.4',
              quote: 'La carrega docent assignada no pot superar el 110 %',
            },
          }),
          proposal(),
          proposal({ proposed_value: 180 }),
        ],
      }

      const runId = await startRun()
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/settings/extractions/${runId}/accept-high`,
        headers: asAdmin(),
        payload: { block: 'A' },
      })

      // Only the uncontradicted one: the two readings of the annual ceiling
      // need a person to choose between them.
      expect(response.json().accepted).toBe(1)
      const rows = (await view(runId)).rows as Record<string, unknown>[]
      const accepted = rows.filter((entry) => entry.status === 'accepted')
      expect(accepted.map((entry) => entry.paramKey)).toEqual(['capacity.creditToHours'])
    })

    it('never overwrites a parameter somebody set by hand', async () => {
      // The administrator decided this one themselves, with no citation.
      const center = await prisma.center.findUniqueOrThrow({ where: { id: centerId } })
      const settings = center.settingsJson as Record<string, unknown>
      await prisma.center.update({
        where: { id: centerId },
        data: {
          settingsJson: {
            ...settings,
            capacity: { ...defaultCenterSettings.capacity, maxTeachingHoursYear: 210 },
          } as never,
          settingsVersionId: null,
        },
      })

      const runId = await startRun()
      const rows = (await view(runId)).rows as Record<string, unknown>[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')

      expect(row?.manualOverride).toBe(true)

      // And the bulk accept will not touch it either.
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/settings/extractions/${runId}/accept-high`,
        headers: asAdmin(),
        payload: { block: 'A' },
      })
      expect(response.json().accepted).toBe(0)
    })
  })

  describe('the walk back from a rule', () => {
    it('answers which article imposes a parameter, and where to read it', async () => {
      const runId = await startRun()
      const rows = (await view(runId)).rows as { id: string; paramKey: string }[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/settings/extractions/${runId}/rows/${row?.id}`,
        headers: asAdmin(),
        payload: { status: 'accepted' },
      })
      await app.inject({
        method: 'POST',
        url: `/api/v1/settings/extractions/${runId}/apply`,
        headers: asAdmin(),
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/settings/provenance/capacity.maxTeachingHoursYear',
        headers: asAdmin(),
      })

      const provenance = response.json()
      expect(provenance.value).toBe(250)
      expect(provenance.documentTitle).toContain('Criteris POD')
      expect(provenance.page).toBe(7)
      expect(provenance.section).toBe('Art. 14.2')
      // Precise enough for the viewer to open on the paragraph itself.
      expect(provenance.chunkId).toBeTruthy()
    })

    it('says plainly when a parameter has no regulation behind it', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/settings/provenance/schedule.slotMinutes',
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(404)
    })

    it('lets coordination follow the link too — it is who gets blocked', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/settings/provenance/capacity.maxTeachingHoursYear',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
    })
  })

  describe('the history of the configuration', () => {
    it('keeps every version, so last year’s rules can still be read', async () => {
      const runId = await startRun()
      const rows = (await view(runId)).rows as { id: string; paramKey: string }[]
      const row = rows.find((entry) => entry.paramKey === 'capacity.maxTeachingHoursYear')

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/settings/extractions/${runId}/rows/${row?.id}`,
        headers: asAdmin(),
        payload: { status: 'accepted' },
      })
      await app.inject({
        method: 'POST',
        url: `/api/v1/settings/extractions/${runId}/apply`,
        headers: asAdmin(),
      })

      const history = await app.inject({
        method: 'GET',
        url: '/api/v1/settings/versions',
        headers: asAdmin(),
      })

      const items = history.json().items as { id: string; source: string; current: boolean }[]
      expect(items.length).toBeGreaterThan(1)
      expect(items[0]?.source).toBe('ai_extraction')
      expect(items[0]?.current).toBe(true)

      // The oldest one is still readable, and says what has changed since.
      const older = items.at(-1) as { id: string }
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/settings/versions/${older.id}`,
        headers: asAdmin(),
      })
      expect(detail.statusCode).toBe(200)
      expect(
        (detail.json().changes as { key: string }[]).some(
          (change) => change.key === 'capacity.maxTeachingHoursYear',
        ),
      ).toBe(true)
    })
  })
})
