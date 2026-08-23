/**
 * R2: strict multi-tenancy, enforced in the data layer.
 *
 * Instead of trusting every call site to remember `where: { centerId }`, the
 * Prisma client is wrapped: reads get the filter injected, writes get the
 * column set and verified, and anything this module does not recognise is
 * rejected. `test/tenant-scope.test.ts` drives these pure functions with no
 * database, and `test/tenant-isolation.test.ts` proves the same through HTTP.
 */
import { AppError } from './errors.js'

/** Models whose rows always belong to exactly one center. */
export const TENANT_SCOPED_MODELS: readonly string[] = [
  'AcademicYear',
  'AcademicCalendarEntry',
  'CalendarType',
  'UserCenterRole',
  'Degree',
  'Subject',
  'SubjectCoordinator',
  'Group',
  'TeacherProfile',
  'TeacherReduction',
  'TeacherSkill',
  'Availability',
  'AvailabilityException',
  'Space',
  'ScheduleVersion',
  'ClassSession',
  'SessionTeacher',
  'Assignment',
  'ChangeRequest',
  'Absence',
  'Conversation',
  'Message',
  'Document',
  'DocumentChunk',
  'CenterSettingsVersion',
  'SettingExtraction',
  'SettingProvenance',
  'AiInteraction',
]

/**
 * User-owned tables (notification preferences, push subscriptions, calendar
 * connections) and platform tables (universities, tenants, app versions, jobs)
 * are deliberately outside the tenant filter; they are always scoped by user
 * id or restricted to SUPERADMIN.
 */
const scopedModelSet = new Set(TENANT_SCOPED_MODELS.map((model) => model.toLowerCase()))

export function isTenantScoped(model: string | undefined): boolean {
  return typeof model === 'string' && scopedModelSet.has(model.toLowerCase())
}

const READ_MANY_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
])

/**
 * `update`, `delete` and `upsert` target a single row, and Prisma requires the
 * unique field to stay at the top level of `where` — nesting it inside an
 * `AND` is rejected. The center goes in beside it instead, which Prisma
 * accepts as an extra condition on the same row.
 */
const UNIQUE_WRITE_OPERATIONS = new Set(['update', 'delete'])

const UNIQUE_READ_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow'])

export class TenantViolationError extends Error {
  constructor(
    readonly model: string,
    readonly expectedCenterId: string,
    readonly receivedCenterId: string | undefined,
  ) {
    super(
      `Tenant violation on ${model}: expected center ${expectedCenterId}, got ${receivedCenterId ?? 'none'}`,
    )
    this.name = 'TenantViolationError'
  }
}

type Args = Record<string, unknown>

function mergeWhere(args: Args, centerId: string): Args {
  const where = args.where as Record<string, unknown> | undefined
  return { ...args, where: where ? { AND: [where, { centerId }] } : { centerId } }
}

/** Adds the center beside the unique key rather than around it. */
function extendUniqueWhere(args: Args, centerId: string): Args {
  const where = (args.where ?? {}) as Record<string, unknown>
  return { ...args, where: { ...where, centerId } }
}

function scopeData(model: string, data: unknown, centerId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => scopeData(model, row, centerId))
  }
  if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>
    const declared = row.centerId
    if (typeof declared === 'string' && declared !== centerId) {
      throw new TenantViolationError(model, centerId, declared)
    }
    return { ...row, centerId }
  }
  return data
}

export interface ScopedOperation {
  args: Args
  /**
   * `findUnique` only accepts unique fields in `where`, so the center is
   * checked on the row that comes back instead.
   */
  verifyResultCenter: boolean
}

export function applyTenantScope(
  model: string,
  operation: string,
  args: Args,
  centerId: string,
): ScopedOperation {
  if (UNIQUE_READ_OPERATIONS.has(operation)) {
    return { args, verifyResultCenter: true }
  }

  if (READ_MANY_OPERATIONS.has(operation)) {
    return { args: mergeWhere(args, centerId), verifyResultCenter: false }
  }

  if (UNIQUE_WRITE_OPERATIONS.has(operation)) {
    return { args: extendUniqueWhere(args, centerId), verifyResultCenter: false }
  }

  if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
    return {
      args: { ...args, data: scopeData(model, args.data, centerId) },
      verifyResultCenter: false,
    }
  }

  if (operation === 'upsert') {
    const scoped = extendUniqueWhere(args, centerId)
    return {
      args: { ...scoped, create: scopeData(model, args.create, centerId) },
      verifyResultCenter: false,
    }
  }

  // Fail closed: an operation nobody scoped is an operation nobody audited.
  throw new AppError(500, 'INTERNAL_ERROR', 'errors.generic', [
    { path: model, messageKey: `Unscoped operation "${operation}" on a tenant model` },
  ])
}

/** Drops rows that belong to another center. Used after `findUnique`. */
export function verifyResultCenter<T>(result: T, centerId: string): T | null {
  if (result === null || result === undefined) return null
  if (Array.isArray(result)) {
    return result.filter(
      (row) => (row as { centerId?: string } | null)?.centerId === centerId,
    ) as unknown as T
  }
  const row = result as { centerId?: string }
  if (typeof row.centerId === 'string' && row.centerId !== centerId) return null
  return result
}
