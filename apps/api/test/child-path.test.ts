/**
 * The `PATH` this process hands to the tools it runs.
 *
 * A real installation failed every update on `spawn sh ENOENT`: the process
 * manager's environment had no `/bin` in it, so `pnpm` — started by its own
 * absolute path, and therefore fine — could not run the migration through a
 * shell. The same environment resolved `node` to an old one sitting earlier in
 * it, and a release built for Node 22 migrated under Node 20.
 */
import { delimiter, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'

import { childEnv, childPath } from '../src/lib/child-path.js'

const parts = (value: string) => value.split(delimiter)

describe('the PATH a spawned tool gets', () => {
  it('finds the shell even when the process manager passed nothing usable', () => {
    // This is the environment that broke: one directory, for pnpm, and no /bin.
    const path = childPath([], { PATH: '/home/uacademic/.local/share/pnpm' })

    expect(parts(path)).toContain('/bin')
    expect(parts(path)).toContain('/usr/bin')
    // And what the operator did put there is still there.
    expect(parts(path)).toContain('/home/uacademic/.local/share/pnpm')
  })

  it('puts the Node running this process first, so a child agrees about what node is', () => {
    // An old Node earlier in the PATH is exactly how a release built for 22
    // ended up migrating under 20.
    const path = childPath([], { PATH: '/opt/node-20/bin' }, '/opt/node-22/bin/node')

    expect(parts(path)[0]).toBe('/opt/node-22/bin')
    expect(parts(path).indexOf('/opt/node-22/bin')).toBeLessThan(
      parts(path).indexOf('/opt/node-20/bin'),
    )
  })

  it('adds the neighbours of the tools the installation named by absolute path', () => {
    const path = childPath(['/home/uacademic/.local/share/pnpm/pnpm', '/usr/local/bin/pm2'], {
      PATH: '/usr/bin',
    })

    expect(parts(path)).toContain('/home/uacademic/.local/share/pnpm')
    expect(parts(path)).toContain('/usr/local/bin')
  })

  it('names each directory once, in the order it was first wanted', () => {
    const path = childPath(['/usr/bin/mysqldump'], { PATH: '/usr/bin:/bin:/usr/bin' })
    const found = parts(path).filter((entry) => entry === '/usr/bin')

    expect(found).toHaveLength(1)
  })

  it('works from an environment with no PATH at all', () => {
    const path = childPath([], {})

    expect(parts(path)).toContain('/bin')
    expect(parts(path)[0]).toBe(dirname(process.execPath))
  })

  it('carries the rest of the environment through untouched', () => {
    const environment = childEnv([], { PATH: '/usr/bin', UACADEMIC_DATABASE_URL: 'mysql://x' })

    expect(environment.UACADEMIC_DATABASE_URL).toBe('mysql://x')
    expect(parts(environment.PATH ?? '')).toContain('/bin')
  })
})
