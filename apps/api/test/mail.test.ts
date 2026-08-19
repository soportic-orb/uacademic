/**
 * Email, end to end against a real SMTP conversation.
 *
 * The point of these is the one thing an administrator could not find out
 * from the platform: whether mail actually leaves. A mailer that quietly logs
 * instead of sending is right in development and a lie in production, so the
 * difference has to be observable.
 */
import { createServer, type Server } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadEnv, setEnv } from '../src/config/env.js'
import { mailConfigured, resetMailer, sendMail } from '../src/services/mailer.js'

/** A one-shot SMTP server: enough of the protocol to accept one message. */
function smtpSink(): Promise<{ server: Server; port: number; received: string[] }> {
  const received: string[] = []

  const server = createServer((socket) => {
    let stage = 'greeting'
    socket.write('220 probe ESMTP\r\n')

    socket.on('data', (chunk) => {
      const text = chunk.toString()
      received.push(text)

      for (const line of text.split('\r\n').filter(Boolean)) {
        if (stage === 'data') {
          if (line === '.') {
            stage = 'greeting'
            socket.write('250 queued\r\n')
          }
          continue
        }
        if (/^(EHLO|HELO)/i.test(line)) socket.write('250-probe\r\n250 OK\r\n')
        else if (/^DATA/i.test(line)) {
          stage = 'data'
          socket.write('354 go ahead\r\n')
        } else if (/^QUIT/i.test(line)) socket.write('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port, received })
    })
  })
}

describe('sending email', () => {
  let sink: Awaited<ReturnType<typeof smtpSink>>

  beforeAll(async () => {
    sink = await smtpSink()
  })

  afterAll(async () => {
    resetMailer()
    sink.server.close()
  })

  it('reports honestly that it cannot send when no server is configured', () => {
    setEnv(
      loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'mock',
        UACADEMIC_SMTP_HOST: '',
        UACADEMIC_SESSION_COOKIE_SECRET: 'mail-probe-secret-that-is-long-enough',
      }),
    )
    resetMailer()

    expect(mailConfigured()).toBe(false)
  })

  it('says nothing was delivered rather than pretending it was', async () => {
    const result = await sendMail({
      to: 'nobody@example.test',
      locale: 'ca',
      subject: 'Prova',
      blocks: [{ title: 'Prova', body: 'Cos' }],
    })

    // `simulated` is the whole distinction: the caller can tell an operator.
    expect(result).toEqual({ delivered: false, simulated: true })
  })

  it('actually talks to a mail server when there is one', async () => {
    setEnv(
      loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'mock',
        UACADEMIC_SMTP_HOST: '127.0.0.1',
        UACADEMIC_SMTP_PORT: String(sink.port),
        UACADEMIC_SMTP_SECURE: 'false',
        UACADEMIC_SMTP_FROM: 'UAcademic <no-reply@uacademic.test>',
        UACADEMIC_SESSION_COOKIE_SECRET: 'mail-probe-secret-that-is-long-enough',
      }),
    )
    resetMailer()

    expect(mailConfigured()).toBe(true)

    const result = await sendMail({
      to: 'aina@uacademic.test',
      locale: 'ca',
      subject: 'Ja tens accés',
      blocks: [{ title: 'Hola, Aina', body: 'Entra amb el compte de la teva universitat.' }],
    })

    expect(result).toEqual({ delivered: true, simulated: false })

    const conversation = sink.received.join('')
    expect(conversation).toContain('aina@uacademic.test')
    expect(conversation).toContain('no-reply@uacademic.test')
    // The body reached the wire, not just the envelope.
    expect(conversation).toMatch(/Entra amb el compte|Hola/)
  })
})
