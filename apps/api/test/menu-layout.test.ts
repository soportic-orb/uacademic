/**
 * The order somebody keeps their own menu in.
 *
 * On the account rather than in the browser, so it follows them between the
 * office desktop and home — and carrying no permission whatsoever, which is
 * the thing worth pinning down: what a menu may contain is still decided by
 * the roles on every request (R3).
 */
import { Prisma, disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('a personal menu order', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let userId: string

  const headers = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })

  const read = () => app.inject({ method: 'GET', url: '/api/v1/me/menu', headers: headers() })

  const write = (entries: unknown[]) =>
    app.inject({ method: 'PUT', url: '/api/v1/me/menu', headers: headers(), payload: { entries } })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    userId = (await prisma.user.findFirstOrThrow({ where: { email: SEED.teacherEmail } })).id
  })

  afterAll(async () => {
    await app.close()
    await disconnectPrisma()
  })

  afterEach(async () => {
    // `Prisma.DbNull`, not `undefined`: on a nullable JSON column undefined
    // means "leave it alone", so the cleanup would quietly do nothing.
    await prisma.user.update({ where: { id: userId }, data: { menuLayoutJson: Prisma.DbNull } })
    await prisma.platformSetting.deleteMany({ where: { key: 'menuDefaults' } })
  })

  const setDefaults = (defaults: Record<string, unknown[]>) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/platform/menu-defaults',
      headers: { 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId },
      payload: { defaults },
    })

  it('is empty until somebody arranges one, which means the product’s own order', async () => {
    const response = await read()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ entries: [], personalised: false })
  })

  it('keeps what was written, separators and all', async () => {
    const entries = [
      { kind: 'item', key: 'messages' },
      { kind: 'separator', id: 'sep-1', label: 'Docència' },
      { kind: 'item', key: 'planning' },
    ]

    expect((await write(entries)).statusCode).toBe(200)
    expect((await read()).json()).toEqual({ entries, personalised: true })
  })

  it('is one person’s, not the center’s', async () => {
    await write([{ kind: 'item', key: 'messages' }])

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/me/menu',
      headers: { 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId },
    })

    expect(other.json()).toEqual({ entries: [], personalised: false })
  })

  it('refuses a separator with no id, which nothing could address', async () => {
    const response = await write([{ kind: 'separator', label: 'Docència' }])

    expect(response.statusCode).toBe(422)
  })

  it('refuses a label long enough to break the column it sits in', async () => {
    const response = await write([{ kind: 'separator', id: 'sep-1', label: 'x'.repeat(200) }])

    expect(response.statusCode).toBe(422)
  })

  it('falls back to the product’s order when the stored layout cannot be read', async () => {
    // Written by an older version, or by hand. Answering with an error would
    // leave somebody with no menu and no way to fix it from the interface.
    await prisma.user.update({
      where: { id: userId },
      data: { menuLayoutJson: { nonsense: true } },
    })

    const response = await read()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ entries: [], personalised: false })
  })

  describe('the menu each role starts with', () => {
    it('is what somebody who has arranged nothing is given', async () => {
      // This lecturer also coordinates, and the menu is drawn for the most
      // privileged role she holds here unless the request names another.
      await setDefaults({ COORDINATOR: [{ kind: 'item', key: 'messages' }] })

      const response = await read()

      expect(response.json().entries).toEqual([{ kind: 'item', key: 'messages' }])
      // Not theirs: they have not arranged anything, so there is nothing to
      // offer to put back.
      expect(response.json().personalised).toBe(false)
    })

    it('stops applying to somebody who has arranged their own', async () => {
      await setDefaults({ COORDINATOR: [{ kind: 'item', key: 'messages' }] })
      await write([{ kind: 'item', key: 'calendar' }])

      const response = await read()

      expect(response.json().entries).toEqual([{ kind: 'item', key: 'calendar' }])
      expect(response.json().personalised).toBe(true)
    })

    it('takes over again when they put their own back', async () => {
      await setDefaults({ COORDINATOR: [{ kind: 'item', key: 'messages' }] })
      await write([{ kind: 'item', key: 'calendar' }])
      await write([])

      expect((await read()).json().entries).toEqual([{ kind: 'item', key: 'messages' }])
    })

    it('is the one for the role the interface is drawing', async () => {
      await setDefaults({
        TEACHER: [{ kind: 'item', key: 'messages' }],
        COORDINATOR: [{ kind: 'item', key: 'planning' }],
      })

      // Somebody who coordinates and teaches switches between the two in the
      // header, and the menu has to follow — they are not the same menu.
      const teaching = await app.inject({
        method: 'GET',
        url: '/api/v1/me/menu?role=TEACHER',
        headers: headers(),
      })
      const coordinating = await app.inject({
        method: 'GET',
        url: '/api/v1/me/menu?role=COORDINATOR',
        headers: headers(),
      })

      expect(teaching.json().entries).toEqual([{ kind: 'item', key: 'messages' }])
      expect(coordinating.json().entries).toEqual([{ kind: 'item', key: 'planning' }])
    })

    it('is the platform administrator’s to set, and nobody else’s', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/platform/menu-defaults',
        headers: headers(),
        payload: { defaults: { TEACHER: [] } },
      })

      expect(response.statusCode).toBe(403)
    })

    it('is refused for a role that does not get one', async () => {
      // A platform administrator arranges their own; there is one of them,
      // and they are the person setting these.
      const response = await setDefaults({ SUPERADMIN: [{ kind: 'item', key: 'platform' }] })

      expect(response.statusCode).toBe(422)
    })

    describe('handing it to everybody who holds the role', () => {
      /*
        Only the menus these tests handed out: the roles they applied. A
        blanket update over the users table is both more than this test did
        and enough to disturb whatever runs next.
      */
      afterEach(async () => {
        await prisma.user.updateMany({
          where: { centerRoles: { some: { role: { in: ['TEACHER', 'CENTER_ADMIN'] } } } },
          data: { menuLayoutJson: Prisma.DbNull },
        })
      })

      const applyTo = (role: string, headers?: Record<string, string>) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/platform/menu-defaults/${role}/apply`,
          headers: headers ?? {
            'x-mock-user': SEED.superadminEmail,
            'x-center-id': centerId,
          },
          payload: {},
        })

      it('overwrites the order those people arranged, and counts them', async () => {
        /*
          The opposite of what a default does, on purpose: a center that has
          agreed on an order wants everybody on it, including the people who
          had arranged their own. So it is asked for separately and it says
          how many menus it rewrote.
        */
        await write([{ kind: 'item', key: 'messages' }])
        await setDefaults({ TEACHER: [{ kind: 'item', key: 'planning' }] })

        const response = await applyTo('TEACHER')

        expect(response.statusCode).toBe(200)
        expect(response.json().applied).toBeGreaterThan(0)
        // Their own arrangement is gone, replaced by the role's.
        expect((await read()).json()).toEqual({
          entries: [{ kind: 'item', key: 'planning' }],
          personalised: true,
        })

        const audit = await prisma.auditLog.findFirst({
          where: { entity: 'platform_settings', entityId: 'menuDefaults', action: 'apply' },
          orderBy: { createdAt: 'desc' },
        })
        expect((audit?.afterJson as { role?: string } | null)?.role).toBe('TEACHER')
      })

      it('leaves alone the people who do not hold the role', async () => {
        await write([{ kind: 'item', key: 'messages' }])
        await setDefaults({ CENTER_ADMIN: [{ kind: 'item', key: 'admin' }] })

        expect((await applyTo('CENTER_ADMIN')).statusCode).toBe(200)

        // This one is a lecturer: their own order is untouched.
        expect((await read()).json().entries).toEqual([{ kind: 'item', key: 'messages' }])
      })

      it('refuses when the role has no default to hand out', async () => {
        const response = await applyTo('TEACHER')

        expect(response.statusCode).toBe(409)
        expect(response.json().error.messageKey).toBe('settings.menu.defaults.errors.notSet')
      })

      it('is the platform administrator’s to do, and nobody else’s', async () => {
        await setDefaults({ TEACHER: [{ kind: 'item', key: 'planning' }] })

        expect((await applyTo('TEACHER', headers())).statusCode).toBe(403)
      })
    })

    it('leaves the product’s own order when nobody has set one', async () => {
      expect((await read()).json().entries).toEqual([])
    })
  })

  it('grants nothing: naming a screen does not open it', async () => {
    // The menu is a list of what to draw. What may be reached is decided by
    // the roles, on every request, whatever this says.
    await write([{ kind: 'item', key: 'platform' }])

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/locales',
      headers: headers(),
    })

    expect(forbidden.statusCode).toBe(403)
  })
})
