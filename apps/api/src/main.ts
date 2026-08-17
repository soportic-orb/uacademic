import { disconnectPrisma } from '@uacademic/db'

import { buildApp } from './app.js'
import { env } from './config/env.js'

const configuration = env()

const app = await buildApp({ env: configuration })

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await disconnectPrisma()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ host: configuration.HOST, port: configuration.PORT })
} catch (error) {
  app.log.error({ err: error }, 'failed to start')
  process.exit(1)
}
