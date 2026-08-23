/**
 * Which models the tenant filter covers.
 *
 * The generic CRUD factory never writes `center_id` itself: it calls
 * `create({ data })` on the scoped client and relies on the extension to put
 * the center in. A model with a `center_id` column that is missing from the
 * list therefore fails every insert — the column is `NOT NULL` — and, worse,
 * serves every center's rows on read.
 *
 * That is exactly what happened to the academic calendar: creating an entry
 * answered "something went wrong", and listing them was never filtered at all.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { TENANT_SCOPED_MODELS } from '../src/lib/tenant-scope.js'

const schema = readFileSync(
  fileURLToPath(new URL('../../../packages/db/prisma/schema.prisma', import.meta.url)),
  'utf8',
)

function modelsWithCenterColumn(): string[] {
  return [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)]
    .filter(([, , body]) => /^\s*centerId\s/m.test(body ?? ''))
    .map(([, name]) => name as string)
}

/**
 * Models that carry a center but are deliberately outside the filter, each
 * because it is reached by a path that names the center itself. Adding a name
 * here is a decision; leaving one out by accident is the bug above.
 */
const DELIBERATELY_UNSCOPED = new Set([
  // Written with an explicit center and read by the person they belong to.
  'Notification',
  'CalendarTombstone',
  // Written with an explicit center by their own services.
  'SettingExtractionRun',
  'AiConversation',
  'AiProposal',
  // Reached through the conversation it was dropped into, which is already
  // scoped to one center and one person.
  'AiAttachment',
  // The support chat: written with the center the person was in, read by them
  // and — deliberately, and only by the role that crosses centers — by the
  // platform administrator, who has to see what everybody is asking.
  'SupportConversation',
  'ImportBatch',
  'ImportRow',
  // INSERT-only, and read by the audit screen with its own center filter (R4).
  'AuditLog',
])

describe('the reach of the tenant filter', () => {
  it('covers every model that carries a center, or says why not', () => {
    const uncovered = modelsWithCenterColumn().filter(
      (model) => !TENANT_SCOPED_MODELS.includes(model) && !DELIBERATELY_UNSCOPED.has(model),
    )

    expect(uncovered).toEqual([])
  })

  it('includes the academic calendar, which the CRUD factory writes blind', () => {
    expect(TENANT_SCOPED_MODELS).toContain('AcademicCalendarEntry')
  })

  it('lists nothing that has no center to be scoped by', () => {
    const withCenter = new Set(modelsWithCenterColumn())
    expect(TENANT_SCOPED_MODELS.filter((model) => !withCenter.has(model))).toEqual([])
  })
})
