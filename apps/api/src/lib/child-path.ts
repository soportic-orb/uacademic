/**
 * The `PATH` this process hands to the tools it runs.
 *
 * The API is started by a process manager, and a process manager's environment
 * is not a login shell's. On a real installation that meant `pnpm` — spawned by
 * its absolute path, so it started fine — failing with `spawn sh ENOENT` the
 * moment it tried to run a script through a shell: `/bin` was not on the `PATH`
 * it had inherited. The same environment resolved `node` to an old version
 * sitting earlier in it, so a release built for Node 22 ran its migration under
 * Node 20.
 *
 * Both are the same mistake — trusting an inherited `PATH` for children that
 * must work — and both are fixed here rather than in a deployment note nobody
 * reads:
 *
 *   1. the directory of the Node running this process comes first, so a tool
 *      and the code that spawned it agree about what "node" means;
 *   2. then whatever the process inherited, which is where an operator's own
 *      choices live;
 *   3. then the standard system directories, so `sh`, `tar` and `mysqldump`
 *      are found on any Unix regardless of what the manager passed down.
 */
import { dirname } from 'node:path'
import { delimiter } from 'node:path'

/** Where a Unix keeps the tools every script assumes it can call. */
const SYSTEM_DIRECTORIES = [
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
]

/**
 * `PATH` for a child process, ours first and the system's last.
 *
 * `extra` is for the directories of tools the installation configured by
 * absolute path — pnpm, pm2, mysqldump — so that anything *they* spawn by name
 * finds its own neighbours.
 */
export function childPath(
  extra: readonly string[] = [],
  source: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string {
  const inherited = (source.PATH ?? '').split(delimiter).filter(Boolean)
  const tools = extra.filter(Boolean).map((tool) => dirname(tool))

  const directories = [dirname(execPath), ...tools, ...inherited, ...SYSTEM_DIRECTORIES]

  // First occurrence wins: the order above is the priority, and a directory
  // named twice would only make the variable longer.
  return [...new Set(directories)].join(delimiter)
}

/** The environment a child gets: this one, with a `PATH` that works. */
export function childEnv(
  extra: readonly string[] = [],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...source, PATH: childPath(extra, source) }
}
