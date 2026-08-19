/**
 * Pictures: a person's own photograph and a university's logo.
 *
 * What is worth pinning here is not that an upload works but who can see one
 * afterwards — a photograph is personal data, and the route that serves it is
 * the only thing standing between one center's faces and another's (R2).
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  FOREIGN,
  SEED,
  createTestApp,
  ensureForeignCenter,
  hasDatabase,
  seedCenterId,
} from './helpers.js'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function multipart(content: Buffer, filename = 'face.png', mime = 'image/png') {
  const boundary = '----uacademicmedia'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)

  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

describe.skipIf(!hasDatabase)('profile photographs and logos', () => {
  let app: FastifyInstance
  let centerId: string
  const prisma = getPrismaClient()

  beforeAll(async () => {
    process.env.UACADEMIC_UPLOAD_DIR = './var/test-uploads'
    app = await createTestApp()
    centerId = await seedCenterId()
    await ensureForeignCenter()
  })

  afterAll(async () => {
    await prisma.user.update({
      where: { email: SEED.teacherEmail },
      data: { avatarUrl: null },
    })
    await app.close()
    await disconnectPrisma()
  })

  const asTeacher = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  it('stores the photograph and answers with a URL that changes with it', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { ...asTeacher(), ...multipart(PNG).headers },
      payload: multipart(PNG).payload,
    })

    expect(first.statusCode).toBe(200)
    const { avatarUrl } = first.json()
    expect(avatarUrl).toMatch(/^\/api\/v1\/users\/[0-9a-f-]+\/avatar\?v=[0-9a-f]{12}$/)

    const other = Buffer.concat([PNG, Buffer.from([1, 2, 3])])
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { ...asTeacher(), ...multipart(other).headers },
      payload: multipart(other).payload,
    })

    // A different picture is a different URL, which is what stops a browser
    // showing yesterday's face out of its cache.
    expect(second.json().avatarUrl).not.toBe(avatarUrl)
  })

  it('serves it back with the type read from the bytes', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: SEED.teacherEmail } })

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${user.id}/avatar`,
      headers: asTeacher(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
  })

  it('refuses a file that is not an image, whatever it calls itself', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
    const body = multipart(svg, 'face.png', 'image/png')

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { ...asTeacher(), ...body.headers },
      payload: body.payload,
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.details[0].messageKey).toBe('images.errors.unsupportedType')
  })

  it('refuses a picture too big to be a portrait, without buffering it', async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
    const body = multipart(huge)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { ...asTeacher(), ...body.headers },
      payload: body.payload,
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.details[0].messageKey).toBe('images.errors.tooLarge')
  })

  it('hides a face from somebody who shares no center with it', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: SEED.teacherEmail } })

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${user.id}/avatar`,
      headers: { 'x-mock-user': FOREIGN.userEmail, 'x-center-id': FOREIGN.centerId },
    })

    expect(response.statusCode).toBe(404)
  })

  it('takes the photograph away when asked, column and file together', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/avatar',
      headers: asTeacher(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().avatarUrl).toBeNull()

    const user = await prisma.user.findUniqueOrThrow({ where: { email: SEED.teacherEmail } })
    expect(user.avatarUrl).toBeNull()

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${user.id}/avatar`,
      headers: asTeacher(),
    })
    expect(fetched.statusCode).toBe(404)
  })

  it('lets the platform administrator put a logo on a university', async () => {
    const university = await prisma.university.findFirstOrThrow()
    const body = multipart(PNG, 'logo.png')

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/universities/${university.id}/logo`,
      headers: { 'x-mock-user': SEED.superadminEmail, ...body.headers },
      payload: body.payload,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().logoUrl).toContain(`/api/v1/universities/${university.id}/logo`)

    const stored = await prisma.university.findUniqueOrThrow({ where: { id: university.id } })
    expect(stored.logoUrl).toBe(response.json().logoUrl)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/universities/${university.id}/logo`,
      headers: { 'x-mock-user': SEED.superadminEmail },
    })
    expect(removed.statusCode).toBe(200)
  })

  it('does not let a center administrator brand a university', async () => {
    const university = await prisma.university.findFirstOrThrow()
    const body = multipart(PNG, 'logo.png')

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/universities/${university.id}/logo`,
      headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId, ...body.headers },
      payload: body.payload,
    })

    expect(response.statusCode).toBe(403)
  })
})
