/**
 * Database backups.
 *
 * Two callers, one implementation: a nightly job, and the update procedure —
 * which takes one *before* running migrations, because that is the only moment
 * a rollback is still cheap.
 *
 * `mysqldump` is spawned rather than reimplemented: it is on every Plesk and
 * CloudPanel host, it understands the server it is talking to better than we
 * ever will, and a backup nobody can restore with standard tools is not a
 * backup. The output is gzipped as it is produced, so a large database never
 * has to fit anywhere twice.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

import { env } from '../config/env.js'

export interface BackupResult {
  file: string
  bytes: number
  pruned: string[]
}

interface Connection {
  host: string
  port: string
  user: string
  password: string
  database: string
}

/** The pieces `mysqldump` wants, out of the URL Prisma is given. */
export function parseDatabaseUrl(url: string): Connection {
  const parsed = new URL(url)

  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port || '3306',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  }
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

/**
 * Writes one backup and prunes what has aged out.
 *
 * The password goes through the environment, never on the command line: an
 * argument is visible to every process on a shared host.
 */
export async function createBackup(now: Date = new Date()): Promise<BackupResult> {
  const configuration = env()
  const connection = parseDatabaseUrl(configuration.DATABASE_URL)

  await mkdir(configuration.BACKUP_DIR, { recursive: true })
  const file = join(configuration.BACKUP_DIR, `${connection.database}-${timestamp(now)}.sql.gz`)

  const dump = spawn(
    configuration.MYSQLDUMP_PATH,
    [
      `--host=${connection.host}`,
      `--port=${connection.port}`,
      `--user=${connection.user}`,
      '--single-transaction',
      '--quick',
      '--routines',
      '--events',
      '--default-character-set=utf8mb4',
      connection.database,
    ],
    { env: { ...process.env, MYSQL_PWD: connection.password } },
  )

  const errors: Buffer[] = []
  dump.stderr.on('data', (chunk: Buffer) => errors.push(chunk))

  const exited = new Promise<void>((resolve, reject) => {
    dump.on('error', reject)
    dump.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`mysqldump exited with ${code}: ${Buffer.concat(errors).toString()}`))
    })
  })

  await pipeline(dump.stdout, createGzip({ level: 6 }), createWriteStream(file))
  await exited

  const written = await stat(file)
  const pruned = await pruneBackups(
    configuration.BACKUP_DIR,
    configuration.BACKUP_RETENTION_DAYS,
    now,
  )

  return { file, bytes: written.size, pruned }
}

/** Retention: a disk that fills up is its own kind of outage. */
export async function pruneBackups(
  directory: string,
  retentionDays: number,
  now: Date = new Date(),
): Promise<string[]> {
  if (retentionDays <= 0) return []

  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  const entries = await readdir(directory).catch(() => [] as string[])
  const pruned: string[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.sql.gz')) continue

    const path = join(directory, entry)
    const info = await stat(path).catch(() => null)
    if (!info || info.mtimeMs >= cutoff) continue

    await unlink(path).catch(() => undefined)
    pruned.push(entry)
  }

  return pruned
}
