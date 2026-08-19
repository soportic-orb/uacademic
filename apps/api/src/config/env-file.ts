/**
 * Finding the configuration file.
 *
 * `dotenv/config` reads `./.env` relative to the working directory, which on a
 * deployed host is `<current>/apps/api` — while the file the operator wrote (and
 * the one `release.sh` links) sits at the root of the release, pointing at
 * `shared/.env`. That mismatch is the kind of thing that only shows up in
 * production, so the path is resolved explicitly here and used by everything:
 * the configuration loader, and the installer that writes the file in the first
 * place.
 *
 * Order of preference:
 *
 *   1. `UACADEMIC_ENV_FILE`, when an operator says exactly where it is
 *   2. `<UACADEMIC_DEPLOY_ROOT>/shared/.env`, the deployed layout
 *   3. the nearest `shared/.env` or `.env` walking up from the working
 *      directory — the deployed layout even when nobody named it, and what a
 *      developer expects in a monorepo
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { config as loadDotenv } from 'dotenv'

const MAX_LEVELS = 5

/** The file this installation reads its configuration from. */
export function envFilePath(source: NodeJS.ProcessEnv = process.env): string {
  if (source.UACADEMIC_ENV_FILE) return resolve(source.UACADEMIC_ENV_FILE)

  if (source.UACADEMIC_DEPLOY_ROOT) {
    return join(resolve(source.UACADEMIC_DEPLOY_ROOT), 'shared', '.env')
  }

  let directory = process.cwd()
  for (let level = 0; level < MAX_LEVELS; level += 1) {
    // `shared/.env` first: on a deployed host that is the real one, and the
    // walk is what finds it when nobody set the deploy root — a cron entry,
    // say, whose working directory is somebody's home. Looking only for a
    // bare `.env` is how the worker came up with no database configured.
    const deployed = join(directory, 'shared', '.env')
    if (existsSync(deployed)) return deployed

    const candidate = join(directory, '.env')
    if (existsSync(candidate)) return candidate

    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  return join(process.cwd(), '.env')
}

/**
 * Loads it, if it is there. Never overrides what the process was already
 * given: PM2 and the shell win over a file, which is what makes a one-off
 * `UACADEMIC_LOG_LEVEL=debug pm2 restart` work.
 */
export function loadEnvFile(source: NodeJS.ProcessEnv = process.env): string | null {
  const path = envFilePath(source)
  if (!existsSync(path)) return null

  loadDotenv({ path, override: false, quiet: true })
  return path
}
