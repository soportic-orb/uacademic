import { disconnectPrisma } from '@uacademic/db'

import { buildApp } from './app.js'
import { ENV_PREFIX, applyTimezone, env, ignoredLegacyNames } from './config/env.js'
import { loadEnvFile } from './config/env-file.js'
import { buildInstallerApp } from './modules/install/app.js'
import { ensureInstallToken, readState, tokenPath } from './services/install.js'

// The configuration file, wherever this installation keeps it — which on a
// deployed host is `shared/.env`, not `apps/api/.env`.
loadEnvFile()

// Read straight from the environment rather than through `env()`: in setup
// mode there is no configuration to parse yet, and the installer still writes
// timestamps.
applyTimezone(process.env[`${ENV_PREFIX}TIMEZONE`])

/**
 * A server with nothing configured is not a broken server: it is a server
 * waiting to be installed. Rather than refusing to boot — which on a fresh VPS
 * means an operator staring at a PM2 log — it comes up in setup mode, serves
 * the installer and prints the one-time token that authorises it.
 */
const state = await readState()

if (!state.installed) {
  const installer = await buildInstallerApp({ logLevel: process.env.UACADEMIC_LOG_LEVEL })
  const token = await ensureInstallToken()

  const host = process.env.UACADEMIC_HOST ?? '0.0.0.0'
  const port = Number(process.env.UACADEMIC_PORT ?? 3001)

  try {
    await installer.listen({ host, port })
  } catch (error) {
    // A port already taken, or one this account may not bind. Said plainly:
    // under a process manager the alternative is an unhandled rejection in a
    // log nobody reads, with the manager reporting the app as running.
    installer.log.error({ err: error, host, port }, 'the installer could not listen')
    process.exit(1)
  }

  installer.log.warn(
    { envFile: state.envFile, tokenFile: tokenPath() },
    'not installed yet — serving the installer at /install',
  )
  // Printed rather than logged as a structured field: an operator reads this
  // off the PM2 log once, types it into the browser, and it is spent.
  console.warn(`\n  Installation token: ${token}\n`)
} else {
  const configuration = env()
  const app = await buildApp({ env: configuration })

  // Names another application on this host has set, which we are not reading.
  // Only the names — never the values.
  const ignored = ignoredLegacyNames()
  if (ignored.length > 0) {
    app.log.info(
      { ignored, prefix: ENV_PREFIX },
      'ignoring environment variables that are not this application’s',
    )
  }

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
}
