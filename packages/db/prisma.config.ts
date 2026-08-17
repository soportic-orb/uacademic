import 'dotenv/config'

import { defineConfig, env } from 'prisma/config'

/**
 * Prisma 7 keeps the connection URL out of `schema.prisma` (R10: no secrets in
 * the repo, and nothing that looks like one either). The CLI reads it here and
 * the runtime client gets it through the driver adapter in `src/client.ts`.
 */
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    // Migrations need a scratch database to detect drift. On a shared host
    // this is usually a second schema on the same MySQL instance.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? undefined,
  },
  migrations: {
    path: './prisma/migrations',
    seed: 'tsx seed/index.ts',
  },
})
