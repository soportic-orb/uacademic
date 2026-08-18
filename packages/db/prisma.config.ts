import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { config as loadDotenv } from 'dotenv'
import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 keeps the connection URL out of `schema.prisma` (R10: no secrets in
 * the repo, and nothing that looks like one either). The CLI reads it here and
 * the runtime client gets it through the driver adapter in `src/client.ts`.
 *
 * Both names carry the application prefix: on a shared host a bare
 * `DATABASE_URL` may well be a neighbour's, and a migration is not something to
 * run against the wrong database.
 *
 * Two things this file has to get right on a real server:
 *
 * **Where the configuration lives.** `dotenv/config` would read
 * `packages/db/.env`, which is nobody's configuration file. A deployed host
 * keeps it at `shared/.env` and a developer keeps it at the repo root, so the
 * path is resolved rather than assumed.
 *
 * **That `generate` needs no database.** The build runs before the platform is
 * configured — that is the whole premise of the installer — so a missing URL
 * cannot be an error at load time. It resolves to empty, `generate` works, and
 * the migration commands fail with the driver's own message if it is still
 * empty by the time they run.
 */
function loadEnvFile(): void {
  const explicit = process.env.UACADEMIC_ENV_FILE
  if (explicit && existsSync(explicit)) {
    loadDotenv({ path: resolve(explicit), override: false, quiet: true })
    return
  }

  if (process.env.UACADEMIC_DEPLOY_ROOT) {
    const deployed = join(resolve(process.env.UACADEMIC_DEPLOY_ROOT), 'shared', '.env')
    if (existsSync(deployed)) {
      loadDotenv({ path: deployed, override: false, quiet: true })
      return
    }
  }

  let directory = process.cwd()
  for (let level = 0; level < 5; level += 1) {
    const candidate = join(directory, '.env')
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false, quiet: true })
      return
    }

    const parent = dirname(directory)
    if (parent === directory) return
    directory = parent
  }
}

loadEnvFile()

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.UACADEMIC_DATABASE_URL ?? '',
    // Migrations need a scratch database to detect drift. On a shared host
    // this is usually a second schema on the same MySQL instance.
    shadowDatabaseUrl: process.env.UACADEMIC_SHADOW_DATABASE_URL ?? undefined,
  },
  migrations: {
    path: './prisma/migrations',
    seed: 'tsx seed/index.ts',
  },
})
