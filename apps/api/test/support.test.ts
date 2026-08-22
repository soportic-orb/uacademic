/**
 * Cady, the support assistant.
 *
 * What matters is that she is open to everybody, that she reads nothing but
 * the help material, that a person sees their own conversations and nobody
 * else's, and that what she could not answer ends up somewhere the platform
 * administrator will find it.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setAnthropicClient } from '../src/modules/ai/client.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

/** Replays one scripted answer and records the prompt it was given. */
class StubAnthropic {
  reply = 'Ves a Menú → Planificació.\n[[covered]]'
  requests: { system: string; messages: { role: string; content: string }[] }[] = []
  failWith: Error | null = null

  messages = {
    stream: (params: { system: string; messages: { role: string; content: string }[] }) => {
      if (this.failWith) throw this.failWith
      this.requests.push({ system: params.system, messages: params.messages })

      const listeners: ((delta: string) => void)[] = []
      const reply = this.reply

      return {
        on(event: string, handler: (delta: string) => void) {
          if (event === 'text') listeners.push(handler)
          return this
        },
        async finalMessage() {
          // In pieces, as the API sends it: the marker must not surface even
          // for the instant it is half-written.
          for (let index = 0; index < reply.length; index += 7) {
            const chunk = reply.slice(index, index + 7)
            for (const listener of listeners) listener(chunk)
          }
          return { usage: { input_tokens: 900, output_tokens: 120 } }
        },
      }
    },
  }
}

describe.skipIf(!hasDatabase)('the support assistant', () => {
  const prisma = getPrismaClient()
  const stub = new StubAnthropic()
  let app: FastifyInstance
  let centerId: string

  // Marta coordinates as well as teaches; Sergi only teaches. Which one is
  // asking decides which guide Cady is given, so the suite uses both.
  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })
  const asSuperadmin = () => ({ 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId })

  const events = (body: string) =>
    body
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>)

  const ask = async (
    question: string,
    headers = asTeacher(),
    payload: Record<string, unknown> = {},
  ) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/ask',
      headers,
      payload: { question, ...payload },
    })
    return { response, events: events(response.body) }
  }

  const setEnabled = (enabled: boolean) =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/support/settings',
      headers: asSuperadmin(),
      payload: { enabled },
    })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    setAnthropicClient(stub as never)
  })

  afterAll(async () => {
    setAnthropicClient(undefined)
    await prisma.supportConversation.deleteMany({})
    await prisma.supportArticle.deleteMany({})
    await prisma.platformSetting.deleteMany({ where: { key: 'support' } })
    await app.close()
    await disconnectPrisma()
  })

  beforeEach(async () => {
    stub.reply = 'Ves a Menú → Planificació.\n[[covered]]'
    stub.requests = []
    stub.failWith = null
    await setEnabled(true)
  })

  afterEach(async () => {
    await prisma.supportConversation.deleteMany({})
  })

  describe('being switched on', () => {
    it('is off until somebody turns it on, and says so rather than half-working', async () => {
      await setEnabled(false)

      const status = await app.inject({
        method: 'GET',
        url: '/api/v1/support/status',
        headers: asTeacher(),
      })
      expect(status.json().available).toBe(false)

      const { response } = await ask('Com faig servir el planificador?')
      expect(response.statusCode).toBe(503)
    })

    it('is the platform administrator’s switch and nobody else’s', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/support/settings',
        headers: asTeacher(),
        payload: { enabled: false },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('answering', () => {
    it('answers a lecturer, who has no access to the coordination assistant', async () => {
      const { response, events: frames } = await ask('On veig les meves classes?', asTeacher())

      expect(response.statusCode).toBe(200)
      expect(frames.at(-1)).toMatchObject({ type: 'done', covered: true })

      const text = frames
        .filter((frame) => frame.type === 'text')
        .map((frame) => frame.text)
        .join('')
      expect(text).toBe('Ves a Menú → Planificació.')
    })

    it('never lets the coverage marker reach the reader, whole or in pieces', async () => {
      const { events: frames } = await ask('On veig les meves classes?')

      const streamed = frames
        .filter((frame) => frame.type === 'text')
        .map((frame) => frame.text)
        .join('')
      expect(streamed).not.toContain('[[')
      expect(streamed).not.toContain('covered')
    })

    it('is given the guide for the role that is asking, and nothing beyond it', async () => {
      await ask('Com configuro el centre?', asTeacher())
      await ask('Com configuro el centre?', asCoordinator())

      const [lecturer, coordinator] = stub.requests
      expect(lecturer!.system).toContain('You are Cady')
      expect(lecturer!.system).toContain('/availability')
      // A lecturer is not told how to open an academic year or plan a term:
      // those are screens they cannot open, and a wrong turn is not help.
      expect(lecturer!.system).not.toContain('/admin/academic-years')
      expect(coordinator!.system).toContain('/planning')
    })

    it('is told which screen the person is standing on', async () => {
      await ask('Per què surt buit?', asTeacher(), { path: '/my-load' })

      const system = stub.requests[0]!.system
      expect(system).toContain('Right now they are looking at "My load" (/my-load)')
      // And what that screen needs before it has anything to show, which is
      // the actual answer to "why is this empty".
      expect(system).toContain('teaching contract for the active year')
    })

    it('reads a screen addressed by id, not only the fixed paths', async () => {
      await ask('Què és això?', asTeacher(), {
        path: '/teachers/0198f0d2-8f2a-7000-8000-00000000000a',
      })

      expect(stub.requests[0]!.system).toContain('lecturer’s card')
    })

    it('manages without one, for a client that does not send it', async () => {
      const { response } = await ask('Hola')

      expect(response.statusCode).toBe(200)
      expect(stub.requests[0]!.system).not.toContain('Right now they are looking at')
    })

    it('knows how the product works, not only the steps of the guide', async () => {
      await ask('Com funciona la càrrega docent?', asTeacher())

      const system = stub.requests[0]!.system
      expect(system).toContain('How UAcademic works')
      expect(system).toContain('traffic light')
    })

    it('carries no tools at all: she can read nothing and change nothing', async () => {
      await ask('Esborra les meves classes')

      expect(stub.requests[0]).not.toHaveProperty('tools')
    })

    it('remembers the conversation, so a follow-up means something', async () => {
      const first = await ask('On veig les meves classes?')
      const conversationId = (first.events.at(-1) as { conversationId: string }).conversationId

      await ask('I la disponibilitat?', asTeacher(), { conversationId })

      const messages = stub.requests[1]!.messages
      expect(messages).toHaveLength(3)
      expect(messages[0]).toMatchObject({ role: 'user', content: 'On veig les meves classes?' })
      expect(messages[2]).toMatchObject({ role: 'user', content: 'I la disponibilitat?' })
    })

    it('degrades to a message rather than a stack trace when the model fails', async () => {
      stub.failWith = new Error('upstream is down')

      const { events: frames } = await ask('On veig les meves classes?')

      expect(frames.at(-1)).toMatchObject({ type: 'error', messageKey: 'support.errors.failed' })
    })
  })

  describe('what she could not answer', () => {
    it('records it, without telling the reader off about it', async () => {
      stub.reply = 'Això no ho tinc a la meva ajuda.\n[[uncovered]]'

      const { events: frames } = await ask('Com facturo les hores extres?')
      expect(frames.at(-1)).toMatchObject({ covered: false })

      const stored = await prisma.supportMessage.findFirst({
        where: { role: 'assistant' },
        orderBy: { createdAt: 'desc' },
      })
      expect(stored?.covered).toBe(false)
      expect(stored?.content).toBe('Això no ho tinc a la meva ajuda.')
    })

    it('is what the platform administrator can list on its own', async () => {
      stub.reply = 'No ho sé.\n[[uncovered]]'
      await ask('Com facturo les hores extres?')

      stub.reply = 'Ves a Menú → Planificació.\n[[covered]]'
      await ask('On veig les meves classes?')

      const all = await app.inject({
        method: 'GET',
        url: '/api/v1/support/admin/conversations',
        headers: asSuperadmin(),
      })
      const gaps = await app.inject({
        method: 'GET',
        url: '/api/v1/support/admin/conversations?uncoveredOnly=true',
        headers: asSuperadmin(),
      })

      expect(all.json().items).toHaveLength(2)
      expect(gaps.json().items).toHaveLength(1)
      expect(gaps.json().items[0].title).toBe('Com facturo les hores extres?')
    })
  })

  describe('who may read what', () => {
    it('gives somebody their own conversations and not a colleague’s', async () => {
      await ask('On veig les meves classes?', asTeacher())
      const other = await ask('I jo, on les veig?', asCoordinator())
      const otherId = (other.events.at(-1) as { conversationId: string }).conversationId

      const mine = await app.inject({
        method: 'GET',
        url: '/api/v1/support/conversations',
        headers: asTeacher(),
      })
      expect(mine.json().items).toHaveLength(1)
      expect(mine.json().items[0].title).toBe('On veig les meves classes?')

      const theirs = await app.inject({
        method: 'GET',
        url: `/api/v1/support/conversations/${otherId}`,
        headers: asTeacher(),
      })
      expect(theirs.statusCode).toBe(404)
    })

    it('does not let a lecturer read everybody’s', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/support/admin/conversations',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(403)
    })

    it('takes the reader’s verdict on their own answer only', async () => {
      const { events: frames } = await ask('On veig les meves classes?')
      const messageId = (frames.at(-1) as { messageId: string }).messageId

      const mine = await app.inject({
        method: 'POST',
        url: `/api/v1/support/messages/${messageId}/feedback`,
        headers: asTeacher(),
        payload: { helpful: false },
      })
      expect(mine.statusCode).toBe(200)

      const theirs = await app.inject({
        method: 'POST',
        url: `/api/v1/support/messages/${messageId}/feedback`,
        headers: asCoordinator(),
        payload: { helpful: true },
      })
      expect(theirs.statusCode).toBe(404)
    })
  })

  describe('the help material', () => {
    afterEach(async () => {
      await prisma.supportArticle.deleteMany({})
    })

    const write = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/support/articles',
        headers: asSuperadmin(),
        payload,
      })

    const article = (overrides: Record<string, unknown> = {}) => ({
      slug: 'password',
      // Losing a password is everybody's problem, not one role's.
      roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'],
      content: {
        ca: { title: 'Contrasenya', body: 'Demana una invitació nova.' },
        es: { title: 'Contraseña', body: 'Pide una invitación nueva.' },
        en: { title: 'Password', body: 'Ask for a fresh invitation.' },
      },
      ...overrides,
    })

    it('reaches the prompt once it is written', async () => {
      expect((await write(article())).statusCode).toBe(200)

      await ask('He perdut la contrasenya')

      expect(stub.requests[0]!.system).toContain('Demana una invitació nova.')
    })

    it('refuses one that is missing a language, because a third of the platform reads it', async () => {
      const response = await write({
        ...article(),
        content: { ca: { title: 'Contrasenya', body: 'Demana-ne una altra.' } },
      })

      expect(response.statusCode).toBe(422)
    })

    it('refuses a second article with the same identifier', async () => {
      await write(article())
      const again = await write(article())

      expect(again.statusCode).toBe(409)
    })

    it('is not something a center administrator writes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/support/articles',
        headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
        payload: article(),
      })

      expect(response.statusCode).toBe(403)
    })

    it('stops reaching the prompt once it is switched off', async () => {
      const created = await write(article())
      const id = created.json().id as string

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/support/articles/${id}`,
        headers: asSuperadmin(),
        payload: { enabled: false },
      })

      await ask('He perdut la contrasenya')
      expect(stub.requests[0]!.system).not.toContain('Demana una invitació nova.')
    })
  })
})
