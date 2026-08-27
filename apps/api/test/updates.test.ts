/**
 * Over-the-air updates.
 *
 * The steps that touch the host — download, tar, migrate, pm2 — are stubbed;
 * what is tested is the procedure, which is where the risk lives: an artefact
 * whose checksum does not match must never be unpacked, a backup must exist
 * before a migration runs, and a version that does not answer afterwards must
 * put the symlink back.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { mkdtemp, mkdir, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { loadEnv, setEnv } from '../src/config/env.js'
import { applyUpdate } from '../src/services/updates.js'
import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

const ARTEFACT = Buffer.from('a release, as bytes')
/** sha256 of the buffer above, computed the same way the service does. */
const CHECKSUM = (await import('node:crypto')).createHash('sha256').update(ARTEFACT).digest('hex')

const RELEASE = {
  version: '2026.09.01-7',
  changelog: '- Something worth installing',
  publishedAt: '2026-09-01T08:00:00.000Z',
  downloadUrl: 'https://api.github.com/repos/example/uacademic/releases/assets/1',
  checksumUrl: 'https://api.github.com/repos/example/uacademic/releases/assets/2',
}

describe.skipIf(!hasDatabase)('installing a release', () => {
  let app: FastifyInstance
  let centerId: string
  let userId: string
  let root: string
  const prisma = getPrismaClient()

  const steps: string[] = []

  /** Everything the host would do, recorded instead of done. */
  const hooks = (overrides: Record<string, unknown> = {}) => ({
    download: async () => {
      steps.push('download')
      return ARTEFACT
    },
    checksum: async () => CHECKSUM,
    backup: async () => {
      steps.push('backup')
      return { file: join(root, 'backups', 'pre-update.sql.gz') }
    },
    extract: async (_archive: string, destination: string) => {
      steps.push('extract')
      await mkdir(destination, { recursive: true })
    },
    install: async () => {
      steps.push('install')
    },
    migrate: async () => {
      steps.push('migrate')
    },
    reload: async () => {
      steps.push('reload')
    },
    health: async () => {
      steps.push('health')
      return true
    },
    ...overrides,
  })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()
    userId = (await prisma.user.findFirstOrThrow({ where: { email: SEED.superadminEmail } })).id

    root = await mkdtemp(join(tmpdir(), 'uacademic-deploy-'))
    await mkdir(join(root, 'releases', 'previous'), { recursive: true })
    await mkdir(join(root, 'shared'), { recursive: true })
    await writeFile(join(root, 'shared', '.env'), 'NODE_ENV=production\n')
    await symlink(join(root, 'releases', 'previous'), join(root, 'current'))

    setEnv(
      loadEnv({
        ...process.env,
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'silent',
        UACADEMIC_AUTH_MODE: 'mock',
        UACADEMIC_DEPLOY_ROOT: root,
        UACADEMIC_GITHUB_OTA_TOKEN: 'test-token',
      }),
    )
  })

  afterAll(async () => {
    await prisma.appVersion.deleteMany({ where: { version: RELEASE.version } })
    await app.close()
    await disconnectPrisma()
  })

  afterEach(async () => {
    steps.length = 0
    await prisma.appVersion.deleteMany({ where: { version: RELEASE.version } })
  })

  describe('who may press the button', () => {
    it('is the superadmin, and only them', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/version',
        headers: { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId },
      })

      expect(response.statusCode).toBe(403)
    })

    it('sees what is installed and what is on offer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/version',
        headers: { 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ configured: true })
      expect(Array.isArray(response.json().history)).toBe(true)
    })
  })

  describe('what it reports about itself', () => {
    it('says what is running and where from, not only what it once installed', async () => {
      // An installation deployed by hand has no row in `app_versions`, so the
      // panel used to call it "unknown". And a process left running from an
      // old release directory looks healthy from every other angle — the path
      // is the only thing that gives it away.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/version',
        headers: { 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.runningVersion).toBeTruthy()
      expect(body.releasePath).toContain('uacademic')
      expect(Date.parse(body.checkedAt)).not.toBeNaN()
    })
  })

  describe('before it touches anything', () => {
    it('refuses when moving the symlink would not change what runs', async () => {
      // This suite's `root` has no `current` pointing at the running code, so
      // an update here would deploy perfectly and be answered by the old
      // process — a success nobody could tell from a no-op.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/update',
        headers: { 'x-mock-user': SEED.superadminEmail, 'x-center-id': centerId },
        payload: {},
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.messageKey).toBe('platform.errors.notLinked')
    })
  })

  describe('the procedure', () => {
    it('verifies, backs up, installs, migrates, switches and checks — in that order', async () => {
      const result = await applyUpdate(prisma, { release: RELEASE, userId }, { hooks: hooks() })

      expect(result.status).toBe('applied')
      // `install` is not decoration: the artefact ships built output and
      // manifests but no node_modules, so without it the migration that
      // follows has no Prisma CLI to run and the release no runtime to boot.
      expect(steps).toEqual([
        'download',
        'backup',
        'extract',
        'install',
        'migrate',
        'reload',
        'health',
      ])

      // The symlink now points at the new release…
      expect(await readlink(join(root, 'current'))).toBe(join(root, 'releases', RELEASE.version))
      // …and the installation knows what it is running.
      const recorded = await prisma.appVersion.findFirstOrThrow({
        where: { version: RELEASE.version },
      })
      expect(recorded.status).toBe('applied')
      expect(recorded.appliedAt).not.toBeNull()
    })

    /*
      What PM2 brings back after a reboot is the list it last saved. An update
      that changed what runs and never saved it comes back as the version
      before — and if nothing ever saved it, as nothing at all, which is the
      502 somebody finds the next morning.
    */
    it('saves the process list after reloading, so a reboot brings this release back', async () => {
      const calls = join(root, 'pm2-calls.txt')
      const fakePm2 = join(root, 'pm2')
      await writeFile(fakePm2, `#!/bin/sh\necho "$@" >> ${calls}\n`, { mode: 0o755 })

      const configuration = (pm2: string) =>
        setEnv(
          loadEnv({
            ...process.env,
            NODE_ENV: 'test',
            UACADEMIC_LOG_LEVEL: 'silent',
            UACADEMIC_AUTH_MODE: 'mock',
            UACADEMIC_DEPLOY_ROOT: root,
            UACADEMIC_GITHUB_OTA_TOKEN: 'test-token',
            UACADEMIC_PM2_PATH: pm2,
          }),
        )

      configuration(fakePm2)

      try {
        // Everything is stubbed except the reload, which is the point here.
        const { reload: _reload, ...rest } = hooks()
        await applyUpdate(prisma, { release: RELEASE, userId }, { hooks: rest })

        const recorded = (await readFile(calls, 'utf8')).trim().split('\n')
        expect(recorded[0]).toContain('reload')
        expect(recorded.at(-1)).toBe('save')
      } finally {
        configuration('pm2')
      }
    })

    it('puts the symlink back when a step after the switch throws', async () => {
      // The reload is that step, and it threw for real: `pm2 reload` restarts
      // the process running the update, so the child died with it. What made
      // it dangerous was the bookkeeping — "rolled_back" recorded while
      // `current` stayed on the new release, so the installation quietly ran
      // code the panel said it had rejected.
      await applyUpdate(prisma, { release: RELEASE, userId }, { hooks: hooks() })
      const applied = await readlink(join(root, 'current'))

      const next = { ...RELEASE, version: '2026.09.02-8' }
      const result = await applyUpdate(
        prisma,
        { release: next, userId },
        {
          hooks: hooks({
            reload: async () => {
              throw new Error('pm2 exited with null')
            },
          }),
        },
      )

      expect(result.status).toBe('rolled_back')
      expect(await readlink(join(root, 'current'))).toBe(applied)
    })

    it('refuses an artefact whose checksum does not match, before unpacking it', async () => {
      const result = await applyUpdate(
        prisma,
        { release: RELEASE, userId },
        { hooks: hooks({ checksum: async () => 'f'.repeat(64) }) },
      )

      expect(result.status).not.toBe('applied')
      expect(result.error).toContain('checksum mismatch')
      // Nothing was written: no backup, no extraction, no migration.
      expect(steps).toEqual(['download'])
    })

    it('backs the database up before the migration, never after', async () => {
      await applyUpdate(prisma, { release: RELEASE, userId }, { hooks: hooks() })

      expect(steps.indexOf('backup')).toBeLessThan(steps.indexOf('migrate'))
    })

    it('rolls back to the previous release when the new one does not answer', async () => {
      // A live installation is always running something: this one is running
      // the release before this attempt.
      await unlink(join(root, 'current')).catch(() => undefined)
      await symlink(join(root, 'releases', 'previous'), join(root, 'current'))

      const result = await applyUpdate(
        prisma,
        { release: RELEASE, userId },
        { hooks: hooks({ health: async () => false }) },
      )

      expect(result.status).toBe('rolled_back')
      expect(await readlink(join(root, 'current'))).toContain('previous')
      // Reloaded twice: into the new version, and back out of it.
      expect(steps.filter((step) => step === 'reload')).toHaveLength(2)

      const recorded = await prisma.appVersion.findFirstOrThrow({
        where: { version: RELEASE.version },
      })
      expect(recorded.status).toBe('rolled_back')
      expect(recorded.appliedAt).toBeNull()
    })

    it('writes down every attempt, successful or not', async () => {
      await applyUpdate(
        prisma,
        { release: RELEASE, userId },
        { hooks: hooks({ health: async () => false }) },
      )

      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'app_version' },
        orderBy: { createdAt: 'desc' },
      })

      expect(entry?.action).toBe('rolled_back')
      expect(JSON.stringify(entry?.afterJson)).toContain(RELEASE.version)
    })
  })
})
