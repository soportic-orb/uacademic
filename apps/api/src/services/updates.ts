/**
 * Updating the installation, from the platform panel.
 *
 * The order of operations is the whole design, and it is the order a careful
 * operator would follow by hand:
 *
 *   1. Ask GitHub what the latest release is (private repo, PAT, server-side).
 *   2. Download the artefact and **verify its checksum** before anything is
 *      unpacked. An artefact that does not match is not installed, and the
 *      attempt is recorded.
 *   3. Back up the database. This is the last cheap moment.
 *   4. Unpack into `releases/<version>`, link the shared state.
 *   5. Run migrations, switch the `current` symlink, reload PM2.
 *   6. Health check. If it does not come back, put the symlink where it was
 *      and reload again.
 *
 * Migrations have to be backward compatible within a version — add a column,
 * fill it, use it; never drop in the same deployment — because between the
 * migration and the reload the previous code is still serving requests against
 * the new schema, and after a rollback it is serving them again.
 *
 * Every attempt lands in `app_versions`, successful or not: "what is running
 * and how did it get here" is not a question that should need a shell.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PrismaClient } from '@uacademic/db'

import { env } from '../config/env.js'
import { writeAuditLog } from '../lib/audit.js'
import { createBackup } from './backup.js'

export interface ReleaseInfo {
  version: string
  changelog: string
  publishedAt: string
  downloadUrl: string
  checksumUrl: string | null
}

export interface UpdateStatus {
  configured: boolean
  currentVersion: string | null
  available: ReleaseInfo | null
  /** True when the release on GitHub is not the one running here. */
  updateAvailable: boolean
  history: {
    version: string
    status: string
    appliedAt: string | null
    changelog: string | null
  }[]
}

interface GitHubRelease {
  tag_name: string
  name: string | null
  body: string | null
  published_at: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; url: string; browser_download_url: string }[]
}

export function updatesConfigured(): boolean {
  return Boolean(env().GITHUB_OTA_TOKEN)
}

function headers(accept: string): Record<string, string> {
  return {
    accept,
    authorization: `Bearer ${env().GITHUB_OTA_TOKEN ?? ''}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'uacademic-updater',
  }
}

/** The newest published release of the private repository, if there is one. */
export async function latestRelease(): Promise<ReleaseInfo | null> {
  const configuration = env()
  if (!configuration.GITHUB_OTA_TOKEN) return null

  const response = await fetch(
    `https://api.github.com/repos/${configuration.GITHUB_OTA_REPO}/releases/latest`,
    { headers: headers('application/vnd.github+json') },
  )
  if (!response.ok) return null

  const release = (await response.json()) as GitHubRelease
  if (release.draft) return null

  const artifact = release.assets.find((asset) => asset.name.endsWith('.tar.gz'))
  if (!artifact) return null

  const checksum = release.assets.find((asset) => asset.name.endsWith('.sha256'))

  return {
    version: release.tag_name.replace(/^v/, ''),
    changelog: release.body ?? '',
    publishedAt: release.published_at,
    // The API URL rather than the browser one: a private repository's asset
    // needs the token, and `browser_download_url` redirects without it.
    downloadUrl: artifact.url,
    checksumUrl: checksum?.url ?? null,
  }
}

/** What this installation is running, as recorded when it was installed. */
export async function currentVersion(client: PrismaClient): Promise<string | null> {
  const applied = await client.appVersion.findFirst({
    where: { status: 'applied' },
    orderBy: { appliedAt: 'desc' },
  })
  return applied?.version ?? null
}

export async function updateStatus(client: PrismaClient): Promise<UpdateStatus> {
  const [installed, available, history] = await Promise.all([
    currentVersion(client),
    latestRelease().catch(() => null),
    client.appVersion.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ])

  return {
    configured: updatesConfigured(),
    currentVersion: installed,
    available,
    updateAvailable: Boolean(available && available.version !== installed),
    history: history.map((entry) => ({
      version: entry.version,
      status: entry.status,
      appliedAt: entry.appliedAt?.toISOString() ?? null,
      changelog: entry.changelog,
    })),
  }
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: headers('application/octet-stream') })
  if (!response.ok) throw new Error(`download failed with ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function expectedChecksum(url: string | null): Promise<string | null> {
  if (!url) return null
  const response = await fetch(url, { headers: headers('application/octet-stream') })
  if (!response.ok) return null
  return (await response.text()).trim().split(/\s+/)[0] ?? null
}

/** Runs a command and captures what it said, for the record. */
function run(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env })
    const output: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const text = Buffer.concat(output).toString()
      if (code === 0) resolve(text)
      else reject(new Error(`${command} exited with ${code}: ${text.slice(-500)}`))
    })
  })
}

async function healthy(url: string, attempts = 15): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
      if (response.ok) return true
    } catch {
      // Not up yet, or not up at all. Both look the same from here.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  return false
}

export interface ApplyOptions {
  /** Test seam: the steps that touch the host, so the flow can be exercised. */
  hooks?: {
    download?: (url: string) => Promise<Buffer>
    checksum?: (url: string | null) => Promise<string | null>
    extract?: (archive: string, destination: string) => Promise<void>
    migrate?: (release: string) => Promise<void>
    reload?: () => Promise<void>
    health?: (url: string) => Promise<boolean>
    backup?: () => Promise<{ file: string }>
  }
}

export interface ApplyResult {
  version: string
  status: 'applied' | 'failed' | 'rolled_back'
  backupFile?: string
  error?: string
}

/**
 * Installs a release. Returns rather than throws: the panel needs to say what
 * happened, and "it failed and we are back on the previous version" is a
 * result, not an exception.
 */
export async function applyUpdate(
  client: PrismaClient,
  input: { release: ReleaseInfo; userId: string; ip?: string | null },
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const configuration = env()
  const hooks = options.hooks ?? {}
  const root = configuration.DEPLOY_ROOT
  const releaseDir = join(root, 'releases', input.release.version)
  const currentLink = join(root, 'current')

  const record = await client.appVersion.upsert({
    where: { version: input.release.version },
    create: {
      version: input.release.version,
      changelog: input.release.changelog,
      releasedAt: new Date(input.release.publishedAt),
      status: 'applying',
      appliedBy: input.userId,
    },
    update: { status: 'applying', appliedBy: input.userId },
  })

  const fail = async (error: unknown, status: 'failed' | 'rolled_back'): Promise<ApplyResult> => {
    const message = error instanceof Error ? error.message : String(error)

    await client.appVersion.update({ where: { id: record.id }, data: { status } })
    await writeAuditLog(client, {
      centerId: null,
      userId: input.userId,
      entity: 'app_version',
      entityId: record.id,
      action: status,
      before: null,
      after: { version: input.release.version, error: message },
      source: 'user',
      ip: input.ip ?? null,
    })

    return { version: input.release.version, status, error: message }
  }

  let previous: string | null = null
  let backupFile: string | undefined

  try {
    // 1. Fetch, and verify before trusting.
    const archive = await (hooks.download ?? download)(input.release.downloadUrl)
    const expected = await (hooks.checksum ?? expectedChecksum)(input.release.checksumUrl)
    const actual = createHash('sha256').update(archive).digest('hex')

    if (expected && expected !== actual) {
      throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`)
    }

    // 2. The database, before a migration can touch it.
    const backup = await (hooks.backup ?? createBackup)()
    backupFile = backup.file

    // 3. Unpack.
    const archivePath = join(tmpdir(), `uacademic-${input.release.version}.tar.gz`)
    await writeFile(archivePath, archive)
    await mkdir(releaseDir, { recursive: true })

    if (hooks.extract) {
      await hooks.extract(archivePath, releaseDir)
    } else {
      await run('tar', ['-xzf', archivePath, '-C', releaseDir, '--strip-components=1'])
    }
    await rm(archivePath, { force: true })

    // 4. The state that outlives a release.
    await symlink(join(root, 'shared', '.env'), join(releaseDir, '.env')).catch(() => undefined)

    // 5. Migrate, then switch, then reload.
    if (hooks.migrate) await hooks.migrate(releaseDir)
    else await run('pnpm', ['--filter', '@uacademic/db', 'migrate:deploy'], releaseDir)

    previous = await readlink(currentLink).catch(() => null)
    await unlink(currentLink).catch(() => undefined)
    await symlink(releaseDir, currentLink)

    if (hooks.reload) await hooks.reload()
    else await run('pm2', ['reload', configuration.PM2_APP_NAME, '--update-env'])

    // 6. Does it answer?
    const ok = await (hooks.health ?? healthy)(configuration.HEALTH_CHECK_URL)

    if (!ok) {
      if (previous) {
        await unlink(currentLink).catch(() => undefined)
        await symlink(previous, currentLink)
        if (hooks.reload) await hooks.reload()
        else await run('pm2', ['reload', configuration.PM2_APP_NAME, '--update-env'])
      }

      const result = await fail(
        new Error('health check failed after switching; rolled back'),
        previous ? 'rolled_back' : 'failed',
      )
      return backupFile ? { ...result, backupFile } : result
    }

    await client.appVersion.update({
      where: { id: record.id },
      data: { status: 'applied', appliedAt: new Date(), appliedBy: input.userId },
    })

    await writeAuditLog(client, {
      centerId: null,
      userId: input.userId,
      entity: 'app_version',
      entityId: record.id,
      action: 'apply',
      before: { version: await currentVersion(client) },
      after: { version: input.release.version, backup: backupFile },
      source: 'user',
      ip: input.ip ?? null,
    })

    return backupFile
      ? { version: input.release.version, status: 'applied', backupFile }
      : { version: input.release.version, status: 'applied' }
  } catch (error) {
    // Anything that threw before the switch leaves the installation untouched.
    const result = await fail(error, previous ? 'rolled_back' : 'failed')
    return backupFile ? { ...result, backupFile } : result
  }
}
