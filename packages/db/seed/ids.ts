/**
 * Deterministic UUIDv7 values for the demo data.
 *
 * The seed must be re-runnable: fixed ids turn every write into an upsert
 * instead of a duplicate. The layout still respects the v7 shape (version and
 * variant nibbles), so these ids sort like the ones Prisma generates.
 */
const TIMESTAMP_HEX = '0198f0d28f2a'

export type EntityKind =
  | 'university'
  | 'tenant'
  | 'center'
  | 'academicYear'
  | 'user'
  | 'role'
  | 'degree'
  | 'subject'
  | 'group'
  | 'profile'
  | 'reduction'
  | 'skill'
  | 'availability'
  | 'space'
  | 'scheduleVersion'
  | 'session'
  | 'assignment'
  | 'document'
  | 'settingsVersion'
  | 'provenance'

const ENTITY_CODES: Record<EntityKind, number> = {
  university: 1,
  tenant: 2,
  center: 3,
  academicYear: 4,
  user: 5,
  role: 6,
  degree: 7,
  subject: 8,
  group: 9,
  profile: 10,
  reduction: 11,
  skill: 12,
  availability: 13,
  space: 14,
  scheduleVersion: 15,
  session: 16,
  assignment: 17,
  document: 18,
  settingsVersion: 19,
  provenance: 20,
}

export function seedId(kind: EntityKind, index: number): string {
  const node = (ENTITY_CODES[kind] * 100_000_000 + index).toString(16).padStart(12, '0')
  return [
    TIMESTAMP_HEX.slice(0, 8),
    TIMESTAMP_HEX.slice(8, 12),
    '7000',
    '8000',
    node,
  ].join('-')
}
