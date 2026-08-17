import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// tsc does not emit .json files. The i18n catalogs are the single source of
// truth for the three languages (R1), so they ship with the build.
const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '..', 'src', 'i18n', 'locales')
const to = join(here, '..', 'dist', 'i18n', 'locales')

await mkdir(to, { recursive: true })
await cp(from, to, { recursive: true })
console.log(`copied i18n catalogs → ${to}`)
